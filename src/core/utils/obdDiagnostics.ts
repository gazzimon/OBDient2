// Diagnostic answers → typed results (M2.2): trouble codes (modes 03/07/0A),
// monitor status (0101), freeze frame (mode 02) and VIN (0902).
//
// Input is the per-ECU messages from readMessages() (obdFrames.ts), so frames,
// headers and several ECUs are already sorted out. References: SAE J1979 for
// the layouts, SAE J2012 (DEC2007) §5 for the code structure. Verified on a
// real car with the B35 (docs/hardware/adaptador-stn.md, 2026-10-18).

import type { PidId } from '@/core/constants/pids';
import { parsePidBytes } from '@/core/utils/obdParser';
import { answersTo, type EcuMessage, type NegativeAnswer } from '@/core/utils/obdFrames';

// ── Trouble codes ───────────────────────────────────────────────────────────

export type DtcSystem = 'powertrain' | 'chassis' | 'body' | 'network';
// Who defines the meaning (J2012 §5): the standard, the carmaker, nobody yet,
// or a range the standard splits without saying how (U3xxx).
export type DtcOwner = 'standard' | 'manufacturer' | 'reserved' | 'unspecified';

export interface Dtc {
  readonly code: string; // "P0171"
  readonly system: DtcSystem;
  readonly owner: DtcOwner;
  // Who reported it: CAN ID or legacy source address; null without headers.
  readonly ecu: string | null;
}

export interface DtcReport {
  readonly codes: readonly Dtc[];
  // ECUs that answered, with or without codes (null = unknown, headers off).
  readonly ecus: readonly (string | null)[];
  // ECUs that refused the request, with the reason code.
  readonly refusals: readonly NegativeAnswer[];
  // An answer announced more codes than it carried (lost frame).
  readonly truncated: boolean;
}

const LETTERS = ['P', 'C', 'B', 'U'] as const;
const SYSTEMS: Record<(typeof LETTERS)[number], DtcSystem> = { P: 'powertrain', C: 'chassis', B: 'body', U: 'network' };

// Two bytes → "P0171": the top two bits pick the letter, the next two the
// first digit, the remaining 12 bits are three hex digits (J2012 figure 1).
export function decodeDtc(high: number, low: number): string {
  const letter = LETTERS[(high >> 6) & 0x03]!;
  const rest = (((high & 0x3f) << 8) | low).toString(16).toUpperCase().padStart(4, '0');
  return letter + rest;
}

export function dtcSystem(code: string): DtcSystem {
  return SYSTEMS[code[0] as (typeof LETTERS)[number]];
}

export function dtcOwner(code: string): DtcOwner {
  const group = code.slice(0, 2);
  switch (group) {
    case 'P0':
    case 'P2':
    case 'B0':
    case 'C0':
    case 'U0':
      return 'standard';
    case 'P3':
      // P3000–P33FF carmaker, P3400–P3FFF standard (J2012 figure 1 note).
      return parseInt(code.slice(2, 3), 16) <= 3 ? 'manufacturer' : 'standard';
    case 'B3':
    case 'C3':
      return 'reserved';
    case 'U3':
      return 'unspecified';
    default:
      return 'manufacturer'; // P1, B1, B2, C1, C2, U1, U2
  }
}

export type DtcService = 0x03 | 0x07 | 0x0a;

// Mode 03 (stored), 07 (pending) or 0A (permanent). On CAN each answer starts
// with the number of codes ("43 00" = none, seen on the B35 car); the older
// buses send up to three codes per line, padded with 0000.
export function parseDtcs(messages: readonly EcuMessage[], service: DtcService, can: boolean): DtcReport {
  const { positive, negative } = answersTo(messages, service);
  const codes: Dtc[] = [];
  const seen = new Set<string>();
  const ecus: (string | null)[] = [];
  let truncated = false;

  for (const m of positive) {
    if (!ecus.includes(m.ecu)) ecus.push(m.ecu);
    let pairs = m.bytes.slice(1);
    if (can) {
      const count = pairs[0] ?? 0;
      pairs = pairs.slice(1, 1 + count * 2);
      if (pairs.length < count * 2 || !m.complete) truncated = true;
    }
    for (let i = 0; i + 1 < pairs.length; i += 2) {
      if (pairs[i] === 0 && pairs[i + 1] === 0) continue; // filler
      const code = decodeDtc(pairs[i]!, pairs[i + 1]!);
      const key = `${m.ecu}:${code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      codes.push({ code, system: dtcSystem(code), owner: dtcOwner(code), ecu: m.ecu });
    }
  }
  return { codes, ecus, refusals: negative, truncated };
}

// ── Monitor status since codes were cleared (01 01) ─────────────────────────

export type MonitorId =
  // Every engine
  | 'misfire'
  | 'fuel_system'
  | 'components'
  // Spark ignition
  | 'catalyst'
  | 'heated_catalyst'
  | 'evap_system'
  | 'secondary_air'
  | 'ac_refrigerant'
  | 'oxygen_sensor'
  | 'oxygen_sensor_heater'
  // Compression ignition (diesel)
  | 'nmhc_catalyst'
  | 'nox_aftertreatment'
  | 'boost_pressure'
  | 'exhaust_gas_sensor'
  | 'particulate_filter'
  // Both
  | 'egr_vvt';

export interface MonitorState {
  readonly id: MonitorId;
  readonly complete: boolean;
}

export interface MonitorStatus {
  readonly ecu: string | null;
  readonly milOn: boolean;
  // Confirmed emission-related codes this ECU reports.
  readonly dtcCount: number;
  readonly ignition: 'spark' | 'compression';
  // Only the monitors this ECU supports.
  readonly monitors: readonly MonitorState[];
}

const COMMON: readonly MonitorId[] = ['misfire', 'fuel_system', 'components'];
// Bit 0 → 7 of bytes C (supported) and D (not complete), J1979 PID 01.
const SPARK: readonly (MonitorId | null)[] = [
  'catalyst',
  'heated_catalyst',
  'evap_system',
  'secondary_air',
  'ac_refrigerant',
  'oxygen_sensor',
  'oxygen_sensor_heater',
  'egr_vvt',
];
const COMPRESSION: readonly (MonitorId | null)[] = [
  'nmhc_catalyst',
  'nox_aftertreatment',
  null,
  'boost_pressure',
  null,
  'exhaust_gas_sensor',
  'particulate_filter',
  'egr_vvt',
];

// One status per ECU that answered "41 01 A B C D". Byte B: bits 0–2 common
// monitors supported, bits 4–6 not complete, bit 3 compression ignition.
// Bytes C/D: the engine-specific monitors, supported / not complete.
export function parseMonitorStatus(messages: readonly EcuMessage[]): MonitorStatus[] {
  const out: MonitorStatus[] = [];
  for (const m of answersTo(messages, 0x01).positive) {
    if (m.bytes[1] !== 0x01 || m.bytes.length < 6) continue;
    const [a, b, c, d] = m.bytes.slice(2, 6) as [number, number, number, number];
    const compression = (b & 0x08) !== 0;
    const monitors: MonitorState[] = [];
    COMMON.forEach((id, i) => {
      if (b & (1 << i)) monitors.push({ id, complete: (b & (1 << (i + 4))) === 0 });
    });
    (compression ? COMPRESSION : SPARK).forEach((id, i) => {
      if (id && c & (1 << i)) monitors.push({ id, complete: (d & (1 << i)) === 0 });
    });
    out.push({
      ecu: m.ecu,
      milOn: (a & 0x80) !== 0,
      dtcCount: a & 0x7f,
      ignition: compression ? 'compression' : 'spark',
      monitors,
    });
  }
  return out;
}

// The car as a whole: the light is on if any ECU asks for it; a monitor is
// complete only if every ECU that runs it says so.
export function mergeMonitorStatus(statuses: readonly MonitorStatus[]): Omit<MonitorStatus, 'ecu'> | null {
  if (statuses.length === 0) return null;
  const byId = new Map<MonitorId, boolean>();
  for (const s of statuses) {
    for (const mon of s.monitors) byId.set(mon.id, (byId.get(mon.id) ?? true) && mon.complete);
  }
  return {
    milOn: statuses.some((s) => s.milOn),
    dtcCount: statuses.reduce((n, s) => n + s.dtcCount, 0),
    ignition: statuses[0]!.ignition,
    monitors: [...byId].map(([id, complete]) => ({ id, complete })),
  };
}

// ── Freeze frame (mode 02) ──────────────────────────────────────────────────
// Ask with the frame number: "02 PID 00". The B35 car answers NO DATA to
// "0202" and "42 02 00 …" to "020200".

// The code that stored freeze frame 0 ("42 02 00 hi lo"); null when none is
// stored (0000) or nobody answered.
export function parseFreezeFrameDtc(messages: readonly EcuMessage[]): Dtc | null {
  for (const m of answersTo(messages, 0x02).positive) {
    if (m.bytes[1] !== 0x02 || m.bytes.length < 5) continue;
    const [hi, lo] = [m.bytes[3]!, m.bytes[4]!];
    if (hi === 0 && lo === 0) continue;
    const code = decodeDtc(hi, lo);
    return { code, system: dtcSystem(code), owner: dtcOwner(code), ecu: m.ecu };
  }
  return null;
}

// One stored value ("42 PID frame data…"), with the same formula as live data.
export function parseFreezeFrameValue(
  messages: readonly EcuMessage[],
  pid: Exclude<PidId, 'VOLTAGE'>,
  pidNumber: number,
): number | null {
  for (const m of answersTo(messages, 0x02).positive) {
    if (m.bytes[1] !== pidNumber || m.bytes.length < 4) continue;
    return parsePidBytes(pid, m.bytes.slice(3).map(hex));
  }
  return null;
}

// ── Supported-PID bitmasks (01 00, 02 00 00, 09 00 …) ───────────────────────

// Four bytes after the header; bit 7 of the first byte is PID base+1.
export function maskToPids(mask: readonly number[], base: number): number[] {
  const out: number[] = [];
  mask.slice(0, 4).forEach((byte, i) => {
    for (let bit = 0; bit < 8; bit++) if (byte & (0x80 >> bit)) out.push(base + i * 8 + bit + 1);
  });
  return out;
}

// ── VIN (09 02) ─────────────────────────────────────────────────────────────

export interface VinResult {
  readonly vin: string;
  readonly ecu: string | null;
  // 17 characters from the allowed set (no I, O, Q).
  readonly wellFormed: boolean;
  // Position 9 check digit. Required in North America; elsewhere (the B35
  // car, built in Argentina) it may legitimately fail.
  readonly checkDigitOk: boolean;
}

// CAN: one message "49 02 01" + 17 ASCII bytes. Older buses: one line per
// 4-byte chunk ("49 02 <n> …"), put in order by <n>, with leading 00 filler.
export function parseVin(messages: readonly EcuMessage[], can: boolean): VinResult | null {
  const answers = answersTo(messages, 0x09).positive.filter((m) => m.bytes[1] === 0x02);
  if (answers.length === 0) return null;
  const byEcu = new Map<string | null, number[]>();
  if (can) {
    for (const m of answers) if (!byEcu.has(m.ecu)) byEcu.set(m.ecu, m.bytes.slice(3));
  } else {
    const chunks = new Map<string | null, EcuMessage[]>();
    for (const m of answers) chunks.set(m.ecu, [...(chunks.get(m.ecu) ?? []), m]);
    for (const [ecu, list] of chunks) {
      byEcu.set(ecu, [...list].sort((x, y) => x.bytes[2]! - y.bytes[2]!).flatMap((m) => m.bytes.slice(3)));
    }
  }
  let first: VinResult | null = null;
  for (const [ecu, bytes] of byEcu) {
    const vin = String.fromCharCode(...bytes.filter((b) => b !== 0x00)).trim();
    const result = { vin, ecu, wellFormed: VIN_FORMAT.test(vin), checkDigitOk: vinCheckDigitOk(vin) };
    if (result.wellFormed) return result;
    first ??= result;
  }
  return first;
}

const VIN_FORMAT = /^[A-HJ-NPR-Z0-9]{17}$/;
const TRANSLIT = '0123456789.ABCDEFGH..JKLMN.P.R..STUVWXYZ';
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

export function vinCheckDigitOk(vin: string): boolean {
  if (!VIN_FORMAT.test(vin)) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const ch = vin[i]!;
    const value = /[0-9]/.test(ch) ? Number(ch) : TRANSLIT.indexOf(ch) % 10;
    sum += value * WEIGHTS[i]!;
  }
  const check = sum % 11;
  return vin[8] === (check === 10 ? 'X' : String(check));
}

function hex(b: number): string {
  return b.toString(16).toUpperCase().padStart(2, '0');
}
