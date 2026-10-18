// The assistant's tools on the real car (ADR-0007, M2.4): each validated call
// becomes OBD requests on the live session, and the answers come back as
// compact data for the model plus a one-line summary.
//
// - Live values (read_pids, sample_pids) share the link with the telemetry.
// - Diagnostic reads go with headers (ATH1) to know which ECU reported what;
//   that needs the link alone, so the telemetry pauses for about half a
//   second. While moving they go without headers and without the pause: the
//   adapter's state never changes while driving (ADR-0007 §5).
// - clear_dtcs (mode 04) only arrives here after the user confirmed it on
//   screen (agent loop + policy).
// - A refusal from the car (7F) becomes `rejected_by_car` with the reason.

import { PID_DEFINITIONS, type PidId } from '@/core/constants/pids';
import { nrcReason } from '@/core/constants/nrc';
import { AdapterResetError, CommandTimeoutError, ConnectionLostError, NoDataError } from '@/core/errors/obd.errors';
import {
  maskToPids,
  mergeMonitorStatus,
  parseDtcs,
  parseFreezeFrameDtc,
  parseFreezeFrameValue,
  parseMonitorStatus,
  parseVin,
  type Dtc,
  type DtcService,
} from '@/core/utils/obdDiagnostics';
import { answersTo, readMessages, type EcuMessage } from '@/core/utils/obdFrames';
import { parsePidBytes, parsePidResponse } from '@/core/utils/obdParser';
import { pidNumberFor } from '@/core/utils/supportedPids';
import { isCan } from '@/data/adapters/elm-protocol';
import type { DtcKind, ToolCall, ToolErrorCode, ToolOutcome } from '@/domain/assistant/tools';
import type { VehicleToolsPort } from '@/domain/ports/vehicle-tools.port';
import type { ObdSession } from './obd-session';
import { quiet } from './stn';

// What a trouble code means, when a source for it exists (the knowledge-base
// milestone); until then codes go out with their class only.
export interface DtcDescriber {
  describe(code: string): string | null;
}

export interface VehicleToolDeps {
  readonly describer?: DtcDescriber;
  // Driving: diagnostic reads skip headers and never pause the telemetry.
  readonly moving?: () => boolean;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

const DIAG_TIMEOUT_MS = 6000;
const CLEAR_TIMEOUT_MS = 10_000;
const SAMPLE_INTERVAL_MS = 250;
const FREEZE_FRAME_PIDS_MAX = 12;

const SERVICE: Record<DtcKind, DtcService> = { stored: 0x03, pending: 0x07, permanent: 0x0a };
const KIND_LABEL: Record<DtcKind, string> = { stored: 'guardados', pending: 'pendientes', permanent: 'permanentes' };

class Rejected extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}
class Cancelled extends Error {}

type Send = (command: string, timeoutMs?: number) => Promise<EcuMessage[]>;

export class VehicleToolAdapter implements VehicleToolsPort {
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(
    private readonly session: () => ObdSession | null,
    private readonly deps: VehicleToolDeps = {},
  ) {
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = deps.now ?? (() => Date.now());
  }

  // Every mode-01 PID the car announced that the app knows how to read.
  supportedPids(): readonly PidId[] {
    const info = this.session()?.sessionInfo;
    if (!info) return [];
    if (info.supportedPidNumbers.length === 0) return info.supportedPids;
    const numbers = new Set(info.supportedPidNumbers);
    return (Object.keys(PID_DEFINITIONS) as PidId[]).filter((p) => {
      const n = pidNumberFor(p);
      return n != null && numbers.has(n);
    });
  }

  async execute(call: ToolCall, signal: AbortSignal): Promise<ToolOutcome> {
    const s = this.session();
    if (!s?.sessionInfo) return fail('not_connected', 'No hay un adaptador OBD conectado.');
    try {
      if (signal.aborted) throw new Cancelled();
      return await this.run(s, call, signal);
    } catch (err) {
      return failure(err);
    }
  }

  private async run(s: ObdSession, call: ToolCall, signal: AbortSignal): Promise<ToolOutcome> {
    switch (call.name) {
      case 'read_pids':
        return this.readPids(s, call.pids);
      case 'sample_pids':
        return this.samplePids(s, call.pids, call.seconds, signal);
      case 'read_dtcs':
        return this.readDtcs(s, call.kind);
      case 'read_freeze_frame':
        return this.readFreezeFrame(s);
      case 'read_readiness':
        return this.readReadiness(s);
      case 'read_vehicle_info':
        return this.readVehicleInfo(s);
      case 'read_adapter_info':
        return this.readAdapterInfo(s, call.includePower);
      case 'run_adapter_bench':
        return this.runBench(s);
      case 'clear_dtcs':
        return this.clearDtcs(s);
    }
  }

  // ── Live values ────────────────────────────────────────────────────────────

  private async readValue(s: ObdSession, pid: PidId): Promise<number | null> {
    try {
      return parsePidResponse(pid, await s.send(PID_DEFINITIONS[pid].command));
    } catch (err) {
      if (isLinkFailure(err)) throw err;
      return null; // this PID did not answer; the others still count
    }
  }

  private async readPids(s: ObdSession, pids: readonly PidId[]): Promise<ToolOutcome> {
    const data: Record<string, { value: number | null; unit: string }> = {};
    for (const pid of pids) data[pid] = { value: await this.readValue(s, pid), unit: PID_DEFINITIONS[pid].unit };
    if (pids.every((p) => data[p]!.value == null)) return fail('not_supported', 'El auto no respondió a esos PIDs.');
    const summary = pids.map((p) => `${p} ${fmt(data[p]!.value)} ${data[p]!.unit}`).join(', ');
    return { ok: true, data, summary };
  }

  private async samplePids(
    s: ObdSession,
    pids: readonly PidId[],
    seconds: number,
    signal: AbortSignal,
  ): Promise<ToolOutcome> {
    const values = new Map<PidId, number[]>(pids.map((p) => [p, []]));
    const end = this.now() + seconds * 1000;
    while (this.now() < end) {
      if (signal.aborted) throw new Cancelled();
      for (const pid of pids) {
        const v = await this.readValue(s, pid);
        if (v != null) values.get(pid)!.push(v);
      }
      await this.sleep(SAMPLE_INTERVAL_MS);
    }
    const data: Record<string, unknown> = {};
    for (const [pid, list] of values) {
      data[pid] = list.length
        ? {
            min: round(Math.min(...list)),
            max: round(Math.max(...list)),
            mean: round(list.reduce((a, b) => a + b, 0) / list.length),
            last: list[list.length - 1],
            n: list.length,
            unit: PID_DEFINITIONS[pid].unit,
          }
        : null;
    }
    if ([...values.values()].every((l) => l.length === 0)) return fail('not_supported', 'El auto no respondió a esos PIDs.');
    const summary = pids
      .map((p) => {
        const l = values.get(p)!;
        return l.length ? `${p} ${round(Math.min(...l))}–${round(Math.max(...l))} ${PID_DEFINITIONS[p].unit}` : `${p} sin dato`;
      })
      .join(', ');
    return { ok: true, data, summary };
  }

  // ── Diagnostic reads ───────────────────────────────────────────────────────

  // Runs `work` with headers when parked (exclusive, ATH1 then back to ATH0),
  // or on the shared link without headers when moving.
  private diag<T>(s: ObdSession, work: (send: Send, can: boolean) => Promise<T>): Promise<T> {
    const info = s.sessionInfo!;
    const can = isCan(info.protocol);
    if (this.deps.moving?.()) {
      return work(async (cmd, t = DIAG_TIMEOUT_MS) => readMessages(await s.send(cmd, t), { headers: false, can }), can);
    }
    return s.exclusive(async (port) => {
      const headers = (await quiet(port, 'ATH1')) != null;
      try {
        return await work(async (cmd, t = DIAG_TIMEOUT_MS) => readMessages(await port.send(cmd, t), { headers, can }), can);
      } finally {
        if (headers) await port.send('ATH0').catch(() => undefined);
      }
    });
  }

  private describe(d: Dtc) {
    return {
      code: d.code,
      ecu: d.ecu,
      system: d.system,
      owner: d.owner,
      description: this.deps.describer?.describe(d.code) ?? null,
    };
  }

  private async readDtcs(s: ObdSession, kind: DtcKind): Promise<ToolOutcome> {
    const service = SERVICE[kind];
    const report = await this.diag(s, async (send, can) => {
      const r = parseDtcs(await send(hex(service)), service, can);
      if (r.ecus.length === 0 && r.refusals.length > 0) throw new Rejected(nrcReason(r.refusals[0]!.code));
      return r;
    });
    const codes = report.codes.map((d) => this.describe(d));
    const summary = codes.length
      ? `Códigos ${KIND_LABEL[kind]}: ${codes.map((c) => c.code).join(', ')}`
      : `Sin códigos ${KIND_LABEL[kind]}`;
    return {
      ok: true,
      data: { kind, codes, ecusAnswered: report.ecus.length, incomplete: report.truncated },
      summary,
    };
  }

  private async readFreezeFrame(s: ObdSession): Promise<ToolOutcome> {
    const supported = new Set(this.supportedPids());
    return this.diag(s, async (send) => {
      const dtc = parseFreezeFrameDtc(await send('020200'));
      if (!dtc) return { ok: true, data: { stored: false }, summary: 'Sin freeze frame guardado' } as const;

      // Which PIDs the frame holds; if the ECU does not say, try the live ones.
      let numbers: number[] = [];
      try {
        const mask = answersTo(await send('020000'), 0x02).positive[0];
        if (mask) numbers = maskToPids(mask.bytes.slice(3, 7), 0);
      } catch (err) {
        if (isLinkFailure(err)) throw err;
      }
      const wanted = (Object.keys(PID_DEFINITIONS) as PidId[]).filter((p) => {
        const n = pidNumberFor(p);
        return p !== 'VOLTAGE' && n != null && (numbers.length ? numbers.includes(n) : supported.has(p));
      });
      const values: Record<string, { value: number; unit: string }> = {};
      for (const pid of wanted.slice(0, FREEZE_FRAME_PIDS_MAX)) {
        const n = pidNumberFor(pid)!;
        try {
          const v = parseFreezeFrameValue(await send(`02${hex(n)}00`), pid as Exclude<PidId, 'VOLTAGE'>, n);
          if (v != null) values[pid] = { value: v, unit: PID_DEFINITIONS[pid].unit };
        } catch (err) {
          if (isLinkFailure(err)) throw err;
        }
      }
      return {
        ok: true,
        data: { stored: true, dtc: this.describe(dtc), values },
        summary: `Freeze frame de ${dtc.code}`,
      } as const;
    });
  }

  private async readReadiness(s: ObdSession): Promise<ToolOutcome> {
    const supported = new Set(this.supportedPids());
    const counters: [PidId, string][] = [
      ['DIST_SINCE_CLEAR', 'distSinceClear'],
      ['TIME_SINCE_CLEAR', 'timeSinceClear'],
      ['DIST_WITH_MIL', 'distWithMil'],
      ['TIME_WITH_MIL', 'timeWithMil'],
    ];
    return this.diag(s, async (send) => {
      const merged = mergeMonitorStatus(parseMonitorStatus(await send('0101')));
      if (!merged) return fail('not_supported', 'El auto no informó el estado de los monitores.');
      const extra: Record<string, { value: number; unit: string }> = {};
      for (const [pid, key] of counters) {
        if (!supported.has(pid)) continue;
        try {
          const v = pidFromMessages(await send(PID_DEFINITIONS[pid].command), pid);
          if (v != null) extra[key] = { value: v, unit: PID_DEFINITIONS[pid].unit };
        } catch (err) {
          if (isLinkFailure(err)) throw err;
        }
      }
      const incomplete = merged.monitors.filter((m) => !m.complete).map((m) => m.id);
      return {
        ok: true,
        data: {
          milOn: merged.milOn,
          dtcCount: merged.dtcCount,
          ignition: merged.ignition,
          complete: merged.monitors.filter((m) => m.complete).map((m) => m.id),
          incomplete,
          ...extra,
        },
        summary:
          `Testigo ${merged.milOn ? 'encendido' : 'apagado'}, ${merged.dtcCount} códigos, ` +
          (incomplete.length ? `monitores incompletos: ${incomplete.join(', ')}` : 'monitores completos'),
      } as const;
    });
  }

  private async readVehicleInfo(s: ObdSession): Promise<ToolOutcome> {
    const vin = await this.diag(s, async (send, can) => {
      try {
        return parseVin(await send('0902'), can);
      } catch (err) {
        if (err instanceof NoDataError) return null;
        throw err;
      }
    });
    const pids = this.supportedPids();
    return {
      ok: true,
      data: {
        vin: vin?.vin ?? null,
        vinWellFormed: vin?.wellFormed ?? false,
        vinCheckDigitOk: vin?.checkDigitOk ?? false,
        supportedPids: pids,
      },
      summary: `VIN ${vin?.vin ?? 'no disponible'}, ${pids.length} PIDs soportados`,
    };
  }

  // ── Adapter ────────────────────────────────────────────────────────────────

  private async readAdapterInfo(s: ObdSession, includePower: boolean): Promise<ToolOutcome> {
    const info = s.sessionInfo!;
    let volts: number | null = null;
    if (includePower) {
      const raw = await s.send(info.identity.stn ? 'STVR' : 'ATRV').catch((err: unknown) => {
        if (isLinkFailure(err)) throw err;
        return null;
      });
      const v = raw != null ? parseFloat(raw) : NaN;
      volts = Number.isFinite(v) ? v : null;
    }
    const data = {
      chip: info.identity.stn ?? (info.identity.elm || 'ELM327'),
      stn: info.identity.stn != null,
      protocol: info.protocol,
      speedHz: round(s.speedRateHz()),
      requestStyle: s.requestStyle(),
      adapterResets: s.adapterResets,
      ...(includePower ? { volts } : {}),
    };
    return { ok: true, data, summary: `${data.chip}, ${data.speedHz} Hz${volts != null ? `, ${volts} V` : ''}` };
  }

  private async runBench(s: ObdSession): Promise<ToolOutcome> {
    const report = await s.runBench();
    const styles = report.styles.map((r) => ({ style: r.style, hz: round(r.hz), ok: r.ok, total: r.total }));
    const best = styles.reduce((a, b) => (b.hz > a.hz ? b : a), styles[0] ?? { style: 'plain', hz: 0, ok: 0, total: 0 });
    return { ok: true, data: { styles }, summary: `Mejor: ${best.style} a ${best.hz} Hz` };
  }

  // ── Clear (mode 04) ────────────────────────────────────────────────────────

  private async clearDtcs(s: ObdSession): Promise<ToolOutcome> {
    const supported = new Set(this.supportedPids());
    return this.diag(s, async (send) => {
      let distBefore: number | null = null;
      if (supported.has('DIST_SINCE_CLEAR')) {
        try {
          distBefore = pidFromMessages(await send(PID_DEFINITIONS.DIST_SINCE_CLEAR.command), 'DIST_SINCE_CLEAR');
        } catch (err) {
          if (isLinkFailure(err)) throw err;
        }
      }
      let messages: EcuMessage[];
      try {
        messages = await send('04', CLEAR_TIMEOUT_MS);
      } catch (err) {
        if (err instanceof NoDataError) return fail('not_supported', 'El auto no confirmó el borrado.');
        throw err;
      }
      const { positive, negative } = answersTo(messages, 0x04);
      if (positive.length === 0 && negative.length > 0) throw new Rejected(nrcReason(negative[0]!.code));
      if (positive.length === 0) return fail('not_supported', 'El auto no confirmó el borrado.');
      return {
        ok: true,
        data: {
          cleared: true,
          ecus: positive.map((m) => m.ecu),
          refused: negative.map((n) => ({ ecu: n.ecu, reason: nrcReason(n.code) })),
          distSinceClearBeforeKm: distBefore,
        },
        summary: 'Códigos borrados',
      } as const;
    });
  }
}

// A mode-01 value out of per-ECU messages (works with or without headers).
function pidFromMessages(messages: readonly EcuMessage[], pid: PidId): number | null {
  const n = pidNumberFor(pid);
  if (n == null || pid === 'VOLTAGE') return null;
  const m = answersTo(messages, 0x01).positive.find((x) => x.bytes[1] === n);
  return m ? parsePidBytes(pid, m.bytes.slice(2).map(hex)) : null;
}

function isLinkFailure(err: unknown): boolean {
  return err instanceof ConnectionLostError || err instanceof AdapterResetError || err instanceof Cancelled;
}

function failure(err: unknown): ToolOutcome {
  if (err instanceof Rejected) return fail('rejected_by_car', `El auto rechazó el pedido: ${err.reason}.`);
  if (err instanceof Cancelled) return fail('cancelled', 'Cancelado.');
  if (err instanceof ConnectionLostError) return fail('not_connected', 'Se perdió la conexión con el adaptador.');
  if (err instanceof AdapterResetError) return fail('adapter_reset', 'El adaptador se reinició (tensión baja); reintentar en unos segundos.');
  if (err instanceof CommandTimeoutError) return fail('timeout', 'El auto no respondió a tiempo.');
  if (err instanceof NoDataError) return fail('not_supported', 'El auto no respondió a ese pedido.');
  if (err instanceof Error && err.message === 'Session not open') return fail('not_connected', 'No hay un adaptador OBD conectado.');
  // A reply none of the parsers understood: the turn goes on without it.
  return fail('not_supported', 'Respuesta inesperada del auto.');
}

function fail(error: ToolErrorCode, message: string): ToolOutcome {
  return { ok: false, error, message };
}

function hex(b: number): string {
  return b.toString(16).toUpperCase().padStart(2, '0');
}

function round(v: number): number {
  return Math.round(v * 10) / 10;
}

function fmt(v: number | null): string {
  return v == null ? 'sin dato' : String(round(v));
}
