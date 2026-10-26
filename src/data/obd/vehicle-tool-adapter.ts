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
import { calculate, CalcError } from '@/core/utils/calculator';
import { fuelFromMaf } from '@/core/utils/fuel';
import { isCan } from '@/data/adapters/elm-protocol';
import type { DtcKind, ToolCall, ToolErrorCode, ToolOutcome } from '@/domain/assistant/tools';
import type { FaultEvent, FaultEventInput } from '@/domain/faults/fault-history';
import type { VehicleToolsPort } from '@/domain/ports/vehicle-tools.port';
import type { ObdSession } from './obd-session';
import { quiet } from './stn';
import { classifyCommand } from '@/domain/obd/uds-safety';
import { makeFromVin } from '@/domain/obd/vin-make';
import { redactText } from '@/domain/privacy/redact';
import { BUS_PRESET, FUNCTIONAL_11, FUNCTIONAL_29, FUNCTIONAL_PROBE, mergeTargets, identifyReply, moduleAnswered, needsFlowPair, noAnswer, protocolToPreset, refusalIn, requestHeader, respondersFrom, scanTargets, SCAN_IDENTIFY, SCAN_PROBE, udsReply, urhCommand, type Bus, type ScanPath, type ScanTarget } from '@/domain/obd/module-scan';

// What a trouble code means (data/knowledge/dtc-base.ts). Carmaker codes and
// codes the base leaves out go to the model with their class only.
export interface DtcInfo {
  readonly title: string;
  readonly summary: string;
  // Most likely first.
  readonly causes: readonly { likelihood: 'high' | 'medium' | 'low'; cause: string }[];
  readonly symptoms: readonly string[];
  readonly repair: { difficulty: string; costEur: readonly [number, number] | null } | null;
  // checked: agrees with SAE J2012 · unchecked: newer than the 2007 standard ·
  // low: body/chassis code the standard could not confirm.
  readonly reliability: 'checked' | 'unchecked' | 'low';
}

export interface DtcDescriber {
  describe(code: string): Promise<DtcInfo | null>;
}

// Where reads and clears are written down (FaultHistory on the phone).
export interface FaultHistorySink {
  record(event: FaultEventInput): void;
  // Newest first; one car or all.
  list(vin?: string | null): readonly FaultEvent[];
}

// The telemetry's latest value of a PID (the Dashboard), with its time.
export type LiveValue = (pid: PidId) => { readonly value: number; readonly at: number } | null;

export interface VehicleToolDeps {
  readonly describer?: DtcDescriber;
  // read_pids answers from the telemetry when its value is fresh: no bus request.
  readonly live?: LiveValue;
  readonly history?: FaultHistorySink;
  // Driving: diagnostic reads skip headers and never pause the telemetry.
  readonly moving?: () => boolean;
  // scan_modules: the addresses the lab knows for a make (obdient-tools).
  readonly knownTargets?: (make: string, model: string | null, signal: AbortSignal) => Promise<ScanTarget[]>;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

const DIAG_TIMEOUT_MS = 6000;
const CLEAR_TIMEOUT_MS = 10_000;
const SAMPLE_INTERVAL_MS = 250;
const FREEZE_FRAME_PIDS_MAX = 12;
const HISTORY_MAX_EVENTS = 20;
// A telemetry value younger than this is as good as a new reading.
const LIVE_MAX_AGE_MS = 2000;
// Reads are retried once after the adapter rebooted; clearing and the bench are not.
const RETRY_AFTER_RESET: ReadonlySet<ToolCall['name']> = new Set([
  'read_pids',
  'sample_pids',
  'read_dtcs',
  'read_freeze_frame',
  'read_readiness',
  'read_vehicle_info',
  'read_adapter_info',
]);

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
  // VIN per session, read once: the history is kept per car.
  private readonly vins = new WeakMap<ObdSession, string | null>();

  constructor(
    private readonly session: () => ObdSession | null,
    private readonly deps: VehicleToolDeps = {},
  ) {
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = deps.now ?? (() => Date.now());
  }

  // The VIN for "Mis viajes" and the lab's tracking (VIN = the car, decision
  // 2026-10-20): read once per session with 09 02; null if the car does not give it.
  async ensureVin(): Promise<string | null> {
    const s = this.session();
    if (!s?.sessionInfo) return null;
    if (this.vins.has(s)) return this.vins.get(s)!;
    try {
      return await this.diag(s, (send, can) => this.vinFor(s, send, can));
    } catch {
      return null;
    }
  }

  // Every mode-01 PID the car announced that the app knows how to read.
  // The VIN this session already read (codes, freeze frame, vehicle info), or null.
  knownVin(): string | null {
    const s = this.session();
    return s ? (this.vins.get(s) ?? null) : null;
  }

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
    // These two do not need the car.
    if (call.name === 'calculate') return this.calculate(call.expression);
    if (call.name === 'read_fault_history') return this.readFaultHistory();
    const s = this.session();
    if (!s?.sessionInfo) return fail('not_connected', 'No hay un adaptador OBD conectado.');
    try {
      if (signal.aborted) throw new Cancelled();
      try {
        return await this.run(s, call, signal);
      } catch (err) {
        // The adapter rebooted mid-call (brown-out while cranking): once the
        // session is configured again, a read is worth one more try.
        if (!(err instanceof AdapterResetError) || !RETRY_AFTER_RESET.has(call.name)) throw err;
        await s.settled();
        if (signal.aborted) throw new Cancelled();
        return await this.run(s, call, signal);
      }
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
      case 'scan_modules':
        return this.scanModules(s, call.make, call.model, signal);
      case 'obd_command':
        return this.obdCommand(s, call.command, call.header);
      case 'read_freeze_frame':
        return this.readFreezeFrame(s);
      case 'read_readiness':
        return this.readReadiness(s);
      case 'read_vehicle_info':
        return this.readVehicleInfo(s);
      case 'read_adapter_info':
        return call.fullCheck ? this.checkAdapter(s, call.includePower) : this.readAdapterInfo(s, call.includePower);
      case 'run_adapter_bench':
        return this.runBench(s);
      case 'clear_dtcs':
        return this.clearDtcs(s);
      case 'read_fault_history':
      case 'calculate':
        throw new Error('handled before the session'); // see execute()
      case 'search_place':
      case 'set_destination':
      case 'start_navigation':
      case 'route_status':
      case 'stop_navigation':
      case 'where_am_i':
      case 'fuel_prices':
      case 'weather':
        return fail('not_supported', 'La navegación no la maneja el adaptador.'); // NavigationTools
      case 'dollar_rate':
      case 'car_price':
      case 'log_service':
      case 'read_service_log':
        return fail('not_supported', 'No la maneja el adaptador.'); // OnlineTools, ServiceTools
      case 'web_search':
      case 'research':
      case 'web_fetch':
      case 'knowledge_lookup':
      case 'docs_search':
      case 'chat_search':
        return fail('not_supported', 'Internet no lo maneja el adaptador.'); // OnlineTools
    }
  }

  // ── Without the car ────────────────────────────────────────────────────────

  private calculate(expression: string): ToolOutcome {
    try {
      const result = calculate(expression);
      return { ok: true, data: { expression, result }, summary: `${expression} = ${result}` };
    } catch (err) {
      if (err instanceof CalcError) return fail('invalid_arguments', err.message);
      throw err;
    }
  }

  // The car's history on this phone (FaultHistory). The VIN read this session
  // picks the car; before any read, every car on the phone.
  private readFaultHistory(): ToolOutcome {
    const s = this.session();
    const vin = s ? (this.vins.get(s) ?? undefined) : undefined;
    const events = this.deps.history?.list(vin) ?? [];
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
    const data = events.slice(0, HISTORY_MAX_EVENTS).map((e) => {
      switch (e.type) {
        case 'codes':
          return {
            type: 'codes',
            kind: e.kind,
            codes: e.codes.map((c) => c.code),
            firstSeen: day(e.at),
            lastSeen: day(e.lastSeenAt),
            distSinceClearKm: e.distSinceClearKm,
          };
        case 'freeze_frame':
          return { type: 'freeze_frame', code: e.dtc.code, at: day(e.at), values: e.values };
        case 'cleared':
          return {
            type: 'cleared',
            at: day(e.at),
            codesBefore: e.codesBefore.map((c) => c.code),
            distSinceClearBeforeKm: e.distSinceClearBeforeKm,
          };
      }
    });
    return {
      ok: true,
      data: { vin: vin ?? null, events: data, more: Math.max(0, events.length - HISTORY_MAX_EVENTS) },
      summary: events.length ? `${events.length} eventos en el historial` : 'Historial vacío',
    };
  }

  // ── Live values ────────────────────────────────────────────────────────────

  private async readValue(s: ObdSession, pid: PidId, useLive = false): Promise<number | null> {
    const live = useLive ? this.deps.live?.(pid) : null;
    if (live && this.now() - live.at < LIVE_MAX_AGE_MS) return live.value;
    // STN chips measure the supply with STVR; ATRV is the ELM327 command.
    const command = pid === 'VOLTAGE' && s.sessionInfo?.identity.stn ? 'STVR' : PID_DEFINITIONS[pid].command;
    try {
      return parsePidResponse(pid, await s.send(command));
    } catch (err) {
      if (isLinkFailure(err)) throw err;
      return null; // this PID did not answer; the others still count
    }
  }

  private async readPids(s: ObdSession, pids: readonly PidId[]): Promise<ToolOutcome> {
    const data: Record<string, { value: number | null; unit: string }> = {};
    for (const pid of pids) data[pid] = { value: await this.readValue(s, pid, true), unit: PID_DEFINITIONS[pid].unit };
    if (pids.every((p) => data[p]!.value == null)) return fail('not_supported', 'El auto no respondió a esos PIDs.');
    const summary = pids.map((p) => `${p} ${fmt(data[p]!.value)} ${data[p]!.unit}`).join(', ');
    const maf = data.MAF?.value;
    if (maf == null) return { ok: true, data, summary };
    const speed = data.SPEED?.value ?? this.deps.live?.('SPEED')?.value ?? null;
    return { ok: true, data: { ...data, fuelEstimate: fuelFromMaf(maf, speed) }, summary };
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
    const mafs = values.get('MAF');
    if (mafs?.length) {
      const speeds = values.get('SPEED');
      const meanSpeed = speeds?.length ? speeds.reduce((x, y) => x + y, 0) / speeds.length : null;
      data.fuelEstimate = fuelFromMaf(mafs.reduce((x, y) => x + y, 0) / mafs.length, meanSpeed);
    }
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
  // Lab (M9): the module tree. On each reachable bus (HS always; MS and SW too
  // when the adapter is an STN that supports them), a functional broadcast
  // (3E 00 to 7DF / 18DB33F1) makes every module answer at once, then the
  // seeded address list fills any that did not, and each one is identified with
  // 22 F190. Only one CAN channel is active at a time, so the bus is switched
  // with STP/STPO and HS is restored at the end. Every module found is a real
  // fact about this car — bus and address — saved to the lab knowledge.
  private async scanModules(s: ObdSession, givenMake: string | null, model: string | null, signal: AbortSignal): Promise<ToolOutcome> {
    const info = s.sessionInfo!;
    const bit29 = /29BIT/.test(info.protocol);
    const isStn = info.identity.stn != null;
    const vin = await this.ensureVin();
    // The make's own addresses (ABS, airbag, body…): OBD's 7E0–7E7 and the
    // 7DF broadcast only reach engine and gearbox.
    const make = givenMake?.toLowerCase() ?? makeFromVin(vin);
    const makeTargets = make && this.deps.knownTargets ? await this.deps.knownTargets(make, model, signal).catch(() => []) : [];

    type Found = ScanTarget & { bus: Bus; identify: string | null };
    const result = await s.exclusive(async (port) => {
      await quiet(port, 'ATH1');
      // Which path: the B33-U vendor UDS set (firmware does ISO-TP) if it takes
      // AT UDS1, else the STN/ELM header path.
      const udsAt = (await quiet(port, 'AT UDS1')) != null;
      const path: ScanPath = udsAt ? 'uds-at' : 'stn';

      // Which buses are reachable: HS always; MS/SW only on STN that accept the
      // preset (the B14 has no SW-CAN, so STP 63 returns '?').
      const buses: Bus[] = ['HS'];
      if (isStn && !udsAt) {
        for (const bus of ['MS', 'SW'] as Bus[]) {
          const ok = await quiet(port, `STP ${bit29 ? BUS_PRESET[bus].bit29 : BUS_PRESET[bus].bit11}`);
          if (ok != null && !/\?|ERR/i.test(ok)) buses.push(bus);
        }
        // Restore HS before scanning (the probes above left us on SW).
        await quiet(port, `STP ${protocolToPreset(info.protocol)}`);
        await quiet(port, 'STPO');
        await quiet(port, 'ATH1');
      }

      const out: Found[] = [];
      const seen = new Set<string>();
      let skipped = { otherWidth: 0, overLimit: 0 };
      let elmFlow = false;
      // FlowControl to the module's own request ID when the adapter's default
      // (RxID − 8, or 29-bit swap) misses it. On the STN a custom pair turns the
      // default off for every other ID, so pairs are cleared before each module.
      const flowFor = async (t: ScanTarget) => {
        if (isStn) {
          await quiet(port, 'STCFCPC');
          if (needsFlowPair(t)) await quiet(port, `STCFCPA ${t.reqHeader}, ${t.rxHeader}`);
        } else if (needsFlowPair(t)) {
          await quiet(port, `ATFCSH ${t.reqHeader}`);
          await quiet(port, 'ATFCSD 30 00 00');
          elmFlow = (await quiet(port, 'ATFCSM 1')) != null;
        } else if (elmFlow) {
          await quiet(port, 'ATFCSM 0');
          elmFlow = false;
        }
      };
      try {
        for (const bus of buses) {
          if (bus !== 'HS') {
            await quiet(port, `STP ${bit29 ? BUS_PRESET[bus].bit29 : BUS_PRESET[bus].bit11}`);
            await quiet(port, 'STPO');
            await quiet(port, 'ATH1');
          }
          const generic = [...scanTargets(bit29)];
          // STN: a functional broadcast finds modules no list has.
          if (path === 'stn') {
            await quiet(port, `ATSH ${bit29 ? FUNCTIONAL_29 : FUNCTIONAL_11}`);
            await quiet(port, 'ATCRA').catch(() => undefined);
            const broadcast = await quiet(port, FUNCTIONAL_PROBE, 2500);
            for (const r of broadcast ? respondersFrom(broadcast, bit29) : []) if (!generic.some((c) => c.id === r.id)) generic.unshift(r);
          }
          const merged = mergeTargets(generic, makeTargets, bit29);
          skipped = { otherWidth: merged.otherWidth, overLimit: merged.overLimit };
          for (const t of merged.targets) {
            if (seen.has(`${bus}:${t.id}`)) continue;
            let present: boolean;
            let identify: string | null = null;
            if (path === 'uds-at') {
              const probe = await quiet(port, urhCommand(t.reqHeader, t.rxHeader, SCAN_PROBE), 1500);
              present = probe != null && udsReply(probe, SCAN_PROBE) !== '';
            } else {
              await quiet(port, `ATSH ${t.reqHeader}`);
              // Only this module's answer; the default filter takes 7E8–7EF only,
              // so VW 77D, GM 641 or PSA 652 were dropped.
              await quiet(port, `ATCRA ${t.rxHeader}`);
              await flowFor(t);
              const probe = await quiet(port, SCAN_PROBE, 1200);
              present = probe != null && moduleAnswered(probe);
            }
            if (!present) continue;
            for (const req of SCAN_IDENTIFY) {
              const raw = path === 'uds-at' ? await quiet(port, urhCommand(t.reqHeader, t.rxHeader, req), 1500) : await quiet(port, req, 1500);
              identify = identifyReply(raw && path === 'uds-at' ? udsReply(raw, req) : raw, req);
              if (identify) break;
            }
            seen.add(`${bus}:${t.id}`);
            out.push({ ...t, bus, identify });
          }
        }
      } finally {
        if (buses.length > 1) {
          await quiet(port, `STP ${protocolToPreset(info.protocol)}`).catch(() => undefined);
          await quiet(port, 'STPO').catch(() => undefined);
        }
        if (udsAt) await quiet(port, 'AT UDS0').catch(() => undefined);
        if (isStn) await quiet(port, 'STCFCPC').catch(() => undefined);
        else if (elmFlow) await quiet(port, 'ATFCSM 0').catch(() => undefined);
        await quiet(port, 'ATCRA').catch(() => undefined);
        // The last module's header would stay: telemetry asks the functional one.
        await quiet(port, `ATSH ${bit29 ? FUNCTIONAL_29 : FUNCTIONAL_11}`).catch(() => undefined);
        await quiet(port, 'ATH0').catch(() => undefined);
      }
      return { out, path, buses, skipped };
    });

    const { out: found, path, buses, skipped } = result;
    const byBus = (b: Bus) => found.filter((m) => m.bus === b).length;
    const adapter = info.identity.stn ?? info.identity.elm ?? 'adaptador';
    return {
      ok: true,
      data: {
        adapter,
        path: path === 'uds-at' ? 'UDS por firmware (AT URH)' : 'STN/ELM (encabezados)',
        protocol: info.protocol,
        vin,
        make: make ?? 'desconocida (no se probaron direcciones de marca ni se guardó en el laboratorio)',
        makeAddresses: makeTargets.length,
        ...(skipped.otherWidth ? { skippedOtherIdWidth: skipped.otherWidth } : {}),
        ...(skipped.overLimit ? { skippedOverLimit: skipped.overLimit } : {}),
        // "None answered" is easy to over-read (2026-10-21: "the adapter cannot reach
        // UDS", then the wrong adapter advice): it says what it does not prove.
        ...(found.length === 0 ? { note: noModulesNote(skipped.otherWidth, bit29) } : {}),
        buses: buses.map((b) => ({ bus: b, label: BUS_PRESET[b].label, modules: byBus(b) })),
        modules: found.map((m) => ({ id: m.id, bus: m.bus, reqHeader: m.reqHeader, label: m.label, partNumber: m.identify })),
      },
      summary: found.length
        ? `${found.length} módulos (${adapter}): ${buses.filter((b) => byBus(b)).map((b) => `${byBus(b)} en ${b}`).join(', ')}`
        : `Ningún módulo respondió (${adapter})`,
      // The lab keys facts by make: without it the server refuses the report. It is
      // read by every user, so it carries what the car is (make, model, which
      // modules answer where), never which car: no VIN, and a part number that
      // turns out to be one (DID F190) is masked (ADR-0011).
      ...(make
        ? {
            knowledge: {
              make,
              ...(model ? { model } : {}),
              protocol: info.protocol,
              modules: found.map((m) => ({ id: m.id, bus: m.bus, reqHeader: m.reqHeader, rxHeader: m.rxHeader, label: m.label, partNumber: m.identify == null ? m.identify : redactText(m.identify) })),
            },
          }
        : {}),
    };
  }

  // Lab (Modo laboratorio): one free READ command. Writes are refused here too,
  // even though the policy also gates it — defence in depth.
  private async obdCommand(s: ObdSession, command: string, header: string | null): Promise<ToolOutcome> {
    const verdict = classifyCommand(command);
    if (!verdict.ok) return fail('not_supported', `Bloqueado: ${verdict.reason}. Solo lectura.`);
    const info = s.sessionInfo!;
    const bit29 = /29BIT/.test(info.protocol);
    const isStn = info.identity.stn != null;
    let target: { reqHeader: string; rxHeader: string | null } | null = null;
    if (header) {
      if (!classifyCommand(`ATSH${header}`).ok) return fail('invalid_arguments', 'Encabezado inválido.');
      // A response ID given as the request (18DAF111 for 18DA11F1) is refused with the right one.
      const checked = requestHeader(header, bit29);
      if (!checked.ok) return fail('invalid_arguments', checked.message);
      target = checked;
    }
    const raw = await s.exclusive(async (port) => {
      let elmFlow = false;
      await quiet(port, 'ATH1');
      try {
        if (target) {
          await quiet(port, `ATSH ${target.reqHeader}`);
          // Only that module's answer, and its FlowControl where the adapter's
          // default misses it (as scan_modules does), so a long answer is not cut.
          if (target.rxHeader) {
            const t = { id: target.reqHeader, reqHeader: target.reqHeader, rxHeader: target.rxHeader, label: '' };
            await quiet(port, `ATCRA ${t.rxHeader}`);
            if (isStn) {
              await quiet(port, 'STCFCPC');
              if (needsFlowPair(t)) await quiet(port, `STCFCPA ${t.reqHeader}, ${t.rxHeader}`);
            } else if (needsFlowPair(t)) {
              await quiet(port, `ATFCSH ${t.reqHeader}`);
              await quiet(port, 'ATFCSD 30 00 00');
              elmFlow = (await quiet(port, 'ATFCSM 1')) != null;
            }
          }
        }
        return await port.send(command.replace(/\s+/g, ' ').trim(), 4000).catch((e) => `ERROR ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        // Back to how telemetry needs the adapter: functional header, no filter.
        if (target) {
          if (isStn) await quiet(port, 'STCFCPC').catch(() => undefined);
          else if (elmFlow) await quiet(port, 'ATFCSM 0').catch(() => undefined);
          await quiet(port, 'ATCRA').catch(() => undefined);
          await quiet(port, `ATSH ${bit29 ? FUNCTIONAL_29 : FUNCTIONAL_11}`).catch(() => undefined);
        }
        await quiet(port, 'ATH0').catch(() => undefined);
      }
    });
    const flat = String(raw).replace(/\s+/g, ' ').trim();
    // The reply as the app reads it: multi-frame answers assembled (no 10 14 / 21 / 22
    // control bytes in the middle), and a DID's text decoded. Left to the model, the
    // 2026-10-26 test read "8AGEA76C0RR000099" as "BA76C0R2200043": it took the
    // control bytes for data. Assembled, a VIN is also one run of bytes the privacy
    // layer masks; as raw frames its serial went by unmasked.
    const messages = frameMessages(String(raw), isCan(info.protocol));
    // The raw frames only when nothing could be assembled from them.
    const data = { command, header: target?.reqHeader ?? null, ...(messages.length ? { messages } : { raw: flat }) };
    // No answer is not an answer: the model must not read it as "the module has no such data".
    if (noAnswer(flat)) {
      return fail('timeout', `Sin respuesta${target ? ` de ${target.reqHeader}` : ''} a "${command}" (${flat.slice(0, 40)}). No prueba que el dato no exista: puede ser otra dirección, otro bus o algo que este adaptador no alcanza.`);
    }
    const refused = refusalIn(flat);
    if (refused) {
      return { ok: true, data: { ...data, refused }, summary: `El módulo rechazó ${command}: ${refused.reason}` };
    }
    const first = messages[0];
    return { ok: true, data, summary: `Respuesta: ${(first ? `${first.ecu ?? ''} ${first.bytes}` : flat).trim().slice(0, 60)}` };
  }

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

  // The car's VIN for the history, read on first need and kept for the session.
  private async vinFor(s: ObdSession, send: Send, can: boolean): Promise<string | null> {
    if (this.vins.has(s)) return this.vins.get(s)!;
    let vin: string | null = null;
    try {
      const r = parseVin(await send('0902'), can);
      vin = r?.wellFormed ? r.vin : null;
    } catch (err) {
      if (isLinkFailure(err)) throw err;
    }
    this.vins.set(s, vin);
    return vin;
  }

  private async distSinceClear(send: Send): Promise<number | null> {
    if (!this.supportedPids().includes('DIST_SINCE_CLEAR')) return null;
    try {
      return pidFromMessages(await send(PID_DEFINITIONS.DIST_SINCE_CLEAR.command), 'DIST_SINCE_CLEAR');
    } catch (err) {
      if (isLinkFailure(err)) throw err;
      return null;
    }
  }

  private record(event: FaultEventInput): void {
    try {
      this.deps.history?.record(event);
    } catch {
      // Losing a history entry must never fail the tool call.
    }
  }

  private async describe(d: Dtc) {
    const info = (await this.deps.describer?.describe(d.code).catch(() => null)) ?? null;
    return {
      code: d.code,
      ecu: d.ecu,
      system: d.system,
      owner: d.owner,
      description: info ? `${info.title}. ${info.summary}` : null,
      ...(info ? { causes: info.causes, symptoms: info.symptoms, repair: info.repair, reliability: info.reliability } : {}),
    };
  }

  private async readDtcs(s: ObdSession, kind: DtcKind): Promise<ToolOutcome> {
    const service = SERVICE[kind];
    const report = await this.diag(s, async (send, can) => {
      const r = parseDtcs(await send(hex(service)), service, can);
      if (r.ecus.length === 0 && r.refusals.length > 0) throw new Rejected(nrcReason(r.refusals[0]!.code));
      if (this.deps.history && !r.truncated) {
        const vin = await this.vinFor(s, send, can);
        const distSinceClearKm = await this.distSinceClear(send);
        this.record({ type: 'codes', vin, kind, codes: r.codes.map(faultCode), distSinceClearKm });
      }
      return r;
    });
    const codes = await Promise.all(report.codes.map((d) => this.describe(d)));
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
    return this.diag(s, async (send, can) => {
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
      if (this.deps.history) {
        this.record({ type: 'freeze_frame', vin: await this.vinFor(s, send, can), dtc: faultCode(dtc), values });
      }
      return {
        ok: true,
        data: { stored: true, dtc: await this.describe(dtc), values },
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
        // The check digit is only mandatory on North American VINs (1–5);
        // elsewhere a mismatch is normal and says nothing about the read.
        ...(vin && /^[1-5]/.test(vin.vin) ? { vinCheckDigitOk: vin.checkDigitOk } : {}),
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

  // "Does my adapter work well?": which modules answer, whether a plain ELM327
  // is genuine (it answers the commands of the version it claims), and whether
  // it powers down by itself. Read-only; the link is paused for a moment.
  private async checkAdapter(s: ObdSession, includePower: boolean): Promise<ToolOutcome> {
    const base = await this.readAdapterInfo(s, includePower);
    if (!base.ok) return base;
    const info = s.sessionInfo!;
    const can = isCan(info.protocol);
    const check = await s.exclusive(async (port) => {
      const headers = (await quiet(port, 'ATH1')) != null;
      let modules: string[] = [];
      try {
        modules = [...new Set(answersTo(readMessages(await port.send('0100', DIAG_TIMEOUT_MS), { headers, can }), 0x01).positive.map((m) => m.ecu ?? '?'))];
      } catch (err) {
        if (isLinkFailure(err)) throw err;
      } finally {
        if (headers) await port.send('ATH0').catch(() => undefined);
      }
      let genuine: 'yes' | 'clone' | 'unknown' | null = null;
      let sleepsByItself: boolean | null;
      if (info.identity.stn) {
        const power = await quiet(port, 'STSLCS');
        sleepsByItself = power == null ? null : /UART SLEEP:\s*ON/i.test(power);
      } else {
        const version = Number(/v(\d+\.\d+)/i.exec(info.identity.elm)?.[1] ?? NaN);
        const needs = [version >= 2.0 ? 'ATAMC' : null, version >= 2.1 ? 'ATCTM1' : null].filter((c): c is string => c != null);
        if (Number.isNaN(version)) genuine = 'unknown';
        else {
          const answers = await Promise.all(needs.map((c) => quiet(port, c)));
          genuine = answers.every((a) => a != null) ? 'yes' : 'clone';
        }
        // ELM327 factory defaults never sleep; the app sends ATLP when it disconnects.
        sleepsByItself = false;
      }
      return { modules, genuine, sleepsByItself };
    });
    return {
      ok: true,
      data: { ...(base.data as object), ...check },
      summary: `${(base.data as { chip: string }).chip}: ${check.modules.length} módulos responden`,
    };
  }

  private async runBench(s: ObdSession): Promise<ToolOutcome> {
    const report = await s.runBench();
    const styles = report.styles.map((r) => ({ style: r.style, hz: round(r.hz), ok: r.ok, total: r.total }));
    const best = styles.reduce((a, b) => (b.hz > a.hz ? b : a), styles[0] ?? { style: 'plain', hz: 0, ok: 0, total: 0 });
    return { ok: true, data: { styles }, summary: `Mejor: ${best.style} a ${best.hz} Hz` };
  }

  // ── Clear (mode 04) ────────────────────────────────────────────────────────

  private async clearDtcs(s: ObdSession): Promise<ToolOutcome> {
    return this.diag(s, async (send, can) => {
      // Before the clear: what the history needs to say what was erased.
      const vin = this.deps.history ? await this.vinFor(s, send, can) : null;
      const distBefore = await this.distSinceClear(send);
      let codesBefore: Dtc[] = [];
      if (this.deps.history) {
        try {
          codesBefore = [...parseDtcs(await send('03'), 0x03, can).codes];
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
      this.record({
        type: 'cleared',
        vin,
        ecus: positive.map((m) => m.ecu),
        distSinceClearBeforeKm: distBefore,
        codesBefore: codesBefore.map(faultCode),
      });
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

function faultCode(d: Dtc) {
  return { code: d.code, ecu: d.ecu, owner: d.owner };
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

// What "no module answered" does not prove, said to the model with the scan.
function noModulesNote(otherWidth: number, bit29: boolean): string {
  const parts = ['Ningún módulo respondió a estas direcciones con este adaptador. No es concluyente.'];
  if (otherWidth) parts.push(`Se saltaron ${otherWidth} direcciones conocidas de la marca porque usan IDs de ${bit29 ? '11' : '29'} bits y el protocolo del auto es de ${bit29 ? '29' : '11'}.`);
  parts.push('Los módulos pueden estar detrás de un gateway o en otro bus; si el auto usa CAN FD, ni el ELM327 ni el STN lo hablan: hace falta otro hardware.');
  return parts.join(' ');
}

// The answers in a reply, assembled: [{ ecu, bytes: "62 F1 90 38 41…", complete, text? }].
// `text`: the ASCII after "62 DID DID" (a read-DID answer) or "49 02 01" (the VIN).
export function frameMessages(raw: string, can: boolean): { ecu: string | null; bytes: string; complete: boolean; text?: string }[] {
  let messages: EcuMessage[];
  try {
    messages = readMessages(raw, { headers: true, can });
  } catch {
    return [];
  }
  return messages
    .filter((m) => m.bytes.length > 0)
    .map((m) => {
      const hex = m.bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0'));
      const data = m.bytes[0] === 0x62 && m.bytes.length > 4 ? m.bytes.slice(3) : m.bytes[0] === 0x49 && m.bytes[1] === 0x02 ? m.bytes.slice(3) : [];
      const text = data.length >= 4 && data.every((b) => b >= 0x20 && b <= 0x7e) ? String.fromCharCode(...data) : null;
      return { ecu: m.ecu, bytes: hex.join(' '), complete: m.complete, ...(text ? { text } : {}) };
    });
}
