// M7.0: how much data per second this car and this adapter really give.
//
// The telemetry loop asks for speed plus one more PID per cycle. Mode 01 lets one
// request carry up to six PIDs ("01 0D 0C 05 …", ISO 15765), and the STN can
// return as soon as the first ECU answers. Whether that is worth building (M7.1)
// depends on what the car does, so this measures it first, read-only:
//
//   1. one PID and 2/3/4/6 PIDs per request, in each request style;
//   2. today's loop (speed + one rotating PID, two requests) as the baseline;
//   3. the diagnostic requests (0101, 0902) plain, with STPX r:/t: and with
//      STCSEGR 1.
//
// The first raw answers of every arm are kept: they are the fixtures the M7.1
// parser and its tests are written against, not examples from a manual.

import { PID_DEFINITIONS, type PidId } from '@/core/constants/pids';
import { AdapterResetError, ConnectionLostError } from '@/core/errors/obd.errors';
import { readMessages } from '@/core/utils/obdFrames';
import type { CommandPort } from '@/data/adapters/protocol-manager';
import { isReadOnly } from './diagnostic-capture';
import { requestFor, type RequestStyle } from './telemetry-poller';

// Most PIDs ISO 15765 allows in one mode-01 request.
export const MAX_PIDS_PER_REQUEST = 6;
const GROUP_SIZES = [1, 2, 3, 4, 6] as const;
const SAMPLES = 30;
const DIAG_SAMPLES = 10;
const REQUEST_TIMEOUT_MS = 1000;
const DIAG_TIMEOUT_MS = 6000;
const KEEP_RAW = 2;

export interface M7Context {
  readonly adapter: string;
  readonly protocol: string;
  readonly stn: boolean;
  readonly can: boolean;
  readonly styles: readonly RequestStyle[];
  // Secondary PIDs the car supports (speed is always asked).
  readonly supported: readonly PidId[];
}

export interface M7Arm {
  readonly group: 'pids' | 'rotation' | 'diagnostic';
  readonly label: string;
  readonly command: string;
  // PIDs asked per request (0 for diagnostic arms).
  readonly asked: number;
  readonly ok: number;
  readonly total: number;
  readonly elapsedMs: number;
  // PID values that came back, over every good answer.
  readonly returned: number;
  // Good answers that held fewer PIDs than asked: the ECU dropped some.
  readonly partial: number;
  readonly maxMs: number;
  readonly raw: readonly string[];
}

export interface M7Report {
  readonly startedAt: number;
  readonly context: Pick<M7Context, 'adapter' | 'protocol' | 'stn' | 'can'>;
  readonly arms: readonly M7Arm[];
  readonly interrupted: string | null;
}

// PID byte → length of its data, for the mode-01 PIDs the app reads.
export function pidLengths(): ReadonlyMap<number, number> {
  const out = new Map<number, number>();
  for (const def of Object.values(PID_DEFINITIONS)) {
    const m = /^01([0-9A-F]{2})$/.exec(def.command);
    if (m && def.expectedResponseBytes != null) out.set(parseInt(m[1]!, 16), def.expectedResponseBytes);
  }
  return out;
}

// The PIDs a mode-01 answer carries: "41 0D xx 0C yy yy …". Stops at the first
// PID it does not know the length of (the rest cannot be told apart).
export function parseMultiPid(bytes: readonly number[], lengths: ReadonlyMap<number, number>): number[] {
  if (bytes[0] !== 0x41) return [];
  const pids: number[] = [];
  let i = 1;
  while (i < bytes.length) {
    const n = lengths.get(bytes[i]!);
    if (n === undefined || i + 1 + n > bytes.length) break;
    pids.push(bytes[i]!);
    i += 1 + n;
  }
  return pids;
}

const pidByte = (id: PidId): string => PID_DEFINITIONS[id].command.slice(2);
const isMode01 = (id: PidId): boolean => /^01[0-9A-F]{2}$/.test(PID_DEFINITIONS[id].command);

interface Tally {
  ok: number;
  total: number;
  returned: number;
  partial: number;
  maxMs: number;
  raw: string[];
}
const tally = (): Tally => ({ ok: 0, total: 0, returned: 0, partial: 0, maxMs: 0, raw: [] });

// A failed request (no data, timeout) counts against the arm; a dropped link or
// a rebooted adapter ends the whole measurement.
async function attempt(port: CommandPort, command: string, timeoutMs: number): Promise<string | null> {
  if (!isReadOnly(command)) throw new Error(`not read-only: ${command}`);
  try {
    return await port.send(command, timeoutMs);
  } catch (err) {
    if (err instanceof ConnectionLostError || err instanceof AdapterResetError) throw err;
    return null;
  }
}

export async function runM7Bench(port: CommandPort, ctx: M7Context, now: () => number = () => Date.now()): Promise<M7Report> {
  const startedAt = now();
  const lengths = pidLengths();
  const arms: M7Arm[] = [];
  let interrupted: string | null = null;

  const finish = (group: M7Arm['group'], label: string, command: string, asked: number, t: Tally, elapsedMs: number) =>
    arms.push({ group, label, command, asked, ok: t.ok, total: t.total, elapsedMs: Math.max(1, elapsedMs), returned: t.returned, partial: t.partial, maxMs: t.maxMs, raw: t.raw });

  const answered = (response: string): number[] => {
    const m = readMessages(response, { headers: false, can: ctx.can }).find((x) => x.bytes[0] === 0x41);
    return m ? parseMultiPid(m.bytes, lengths) : [];
  };

  const pids: PidId[] = ['SPEED', ...ctx.supported.filter((p) => p !== 'SPEED' && isMode01(p))];
  const sizes = GROUP_SIZES.filter((n) => n <= Math.min(pids.length, MAX_PIDS_PER_REQUEST));

  try {
    // 1. PIDs per request, in each style.
    for (const style of ctx.styles) {
      for (const size of sizes) {
        const command = `01${pids.slice(0, size).map(pidByte).join('')}`;
        const wire = requestFor(style, command);
        const t = tally();
        const start = now();
        for (let i = 0; i < SAMPLES; i++) {
          const t0 = now();
          const response = await attempt(port, wire, REQUEST_TIMEOUT_MS);
          t.total++;
          t.maxMs = Math.max(t.maxMs, now() - t0);
          if (response == null) continue;
          const got = answered(response).length;
          if (got === 0) continue;
          t.ok++;
          t.returned += got;
          if (got < size) t.partial++;
          if (t.raw.length < KEEP_RAW) t.raw.push(response);
        }
        finish('pids', `${style} · ${size} PID`, wire, size, t, now() - start);
      }
    }

    // 2. What the loop does today: speed, then one rotating PID, two requests.
    const rotating = pids.slice(1);
    const fastest = ctx.styles[0];
    if (fastest && rotating.length > 0) {
      const t = tally();
      const start = now();
      for (let i = 0; i < SAMPLES; i++) {
        const other = rotating[i % rotating.length]!;
        const t0 = now();
        const speed = await attempt(port, requestFor(fastest, '010D'), REQUEST_TIMEOUT_MS);
        const second = await attempt(port, requestFor(fastest, PID_DEFINITIONS[other].command), REQUEST_TIMEOUT_MS);
        t.total++;
        t.maxMs = Math.max(t.maxMs, now() - t0);
        const got = Number(speed != null && answered(speed).length > 0) + Number(second != null && answered(second).length > 0);
        if (got === 0) continue;
        t.ok++;
        t.returned += got;
        if (got < 2) t.partial++;
        if (speed != null && t.raw.length < KEEP_RAW) t.raw.push(speed);
      }
      finish('rotation', `hoy: velocidad + 1 PID (${fastest})`, `${requestFor(fastest, '010D')} + otro`, 2, t, now() - start);
    }

    // 3. The diagnostic requests, to see what STPX r:/t: and STCSEGR 1 change.
    const diag: { label: string; command: string; before?: string; after?: string; stn?: boolean }[] = [
      { label: '0101 plano', command: '0101' },
      { label: '0101 STPX r:1 t:300', command: 'STPX d:0101, r:1, t:300', stn: true },
      { label: '0902 plano', command: '0902' },
      { label: '0902 STPX r:1 t:300', command: 'STPX d:0902, r:1, t:300', stn: true },
      { label: '0902 con STCSEGR 1', command: '0902', before: 'STCSEGR 1', after: 'STCSEGR 0', stn: true },
    ];
    for (const d of diag) {
      if (d.stn && !ctx.stn) continue;
      if (d.before) await attempt(port, d.before, REQUEST_TIMEOUT_MS);
      const t = tally();
      const start = now();
      for (let i = 0; i < DIAG_SAMPLES; i++) {
        const t0 = now();
        const response = await attempt(port, d.command, DIAG_TIMEOUT_MS);
        t.total++;
        t.maxMs = Math.max(t.maxMs, now() - t0);
        if (response == null) continue;
        t.ok++;
        if (t.raw.length < KEEP_RAW) t.raw.push(response);
      }
      finish('diagnostic', d.label, d.command, 0, t, now() - start);
      if (d.after) await attempt(port, d.after, REQUEST_TIMEOUT_MS);
    }
  } catch (err) {
    interrupted = err instanceof AdapterResetError ? 'el adaptador se reinició' : err instanceof ConnectionLostError ? 'se perdió la conexión' : 'error inesperado';
  }

  return { startedAt, context: { adapter: ctx.adapter, protocol: ctx.protocol, stn: ctx.stn, can: ctx.can }, arms, interrupted };
}

const num = (n: number, digits = 1): string => n.toFixed(digits).replace('.', ',');

// Plain text to read on the phone and to share. Rates are over the whole arm.
export function formatM7Bench(report: M7Report): string {
  const lines = [
    `Medición M7.0 · ${new Date(report.startedAt).toISOString()}`,
    `Adaptador: ${report.context.adapter}`,
    `Protocolo: ${report.context.protocol}`,
  ];
  if (report.interrupted) lines.push(`INTERRUMPIDA: ${report.interrupted}`);
  const titles: Record<M7Arm['group'], string> = {
    pids: 'Varios PIDs por pedido',
    rotation: 'Lo que hace hoy la telemetría',
    diagnostic: 'Diagnóstico',
  };
  for (const group of ['pids', 'rotation', 'diagnostic'] as const) {
    const arms = report.arms.filter((a) => a.group === group);
    if (arms.length === 0) continue;
    lines.push('', `== ${titles[group]} ==`);
    for (const a of arms) {
      const seconds = a.elapsedMs / 1000;
      lines.push(`${a.label} → ${a.command}`);
      lines.push(
        group === 'diagnostic'
          ? `  ${a.ok}/${a.total} ok · ${num(a.elapsedMs / a.total, 0)} ms/pedido · máx ${a.maxMs} ms`
          : `  ${a.ok}/${a.total} ok · ${num(a.total / seconds)} ciclos/s · ${num(a.returned / seconds)} PID/s · máx ${a.maxMs} ms · incompletas ${a.partial}`,
      );
    }
  }
  lines.push('', '== Respuestas crudas (para los tests de M7.1) ==');
  for (const a of report.arms) {
    for (const r of a.raw) lines.push(`${a.command}`, ...r.split('\n').map((l) => `  ${l}`));
  }
  return lines.join('\n');
}
