// Discovering which modules answer (the "module tree" FORScan shows), with
// read-only probes only (decision 2026-10-20). For each candidate address the
// phone sets the header, asks TesterPresent (3E 00) and, if it answers, the
// part number (22 F187, else the VIN 22 F190). What responds is a real fact about THIS car,
// saved to the lab knowledge base.
//
// Two addressing schemes, chosen by the live protocol:
//   - 11-bit: request 7E0-7E7, response request+8 (7E8-7EF).
//   - 29-bit (ISO 15765-4): request 18DA{tt}F1, response 18DAF1{tt}.
// The target list is seeded with the usual modules and grows from the
// knowledge base as real cars are scanned.

export interface ScanTarget {
  // Short id used in the knowledge base ("11:7E0", "29:10").
  readonly id: string;
  readonly reqHeader: string;
  readonly rxHeader: string;
  // A human guess; the real identity comes from the module's own part number.
  readonly label: string;
}

const HINTS_11: Record<number, string> = { 0: 'PCM (motor)', 1: 'TCM (caja)', 2: 'módulo', 3: 'módulo', 4: 'módulo', 5: 'módulo', 6: 'módulo', 7: 'módulo' };

// Common 29-bit targets (ISO/Ford-style); labels are hints, verified by the part number.
const TARGETS_29: { t: number; label: string }[] = [
  { t: 0x10, label: 'PCM (motor)' },
  { t: 0x18, label: 'caja (alt.)' },
  { t: 0x28, label: 'ABS' },
  { t: 0x37, label: 'carrocería / GWM' },
  { t: 0x40, label: 'tablero (IPC)' },
  { t: 0x58, label: 'airbag (RCM)' },
  { t: 0x60, label: 'carrocería (BCM)' },
  { t: 0x6f, label: 'módulo' },
  { t: 0x70, label: 'módulo' },
  { t: 0x7d, label: 'dirección (PSCM)' },
  { t: 0x7e, label: 'módulo' },
  { t: 0x726, label: 'climatización' },
  { t: 0x730, label: 'módulo' },
  { t: 0x760, label: 'ABS (alt.)' },
];

const hex = (n: number, width: number) => n.toString(16).toUpperCase().padStart(width, '0');

export function scanTargets(bit29: boolean): ScanTarget[] {
  if (!bit29) {
    return Array.from({ length: 8 }, (_, i) => ({
      id: `11:${hex(0x7e0 + i, 3)}`,
      reqHeader: hex(0x7e0 + i, 3),
      rxHeader: hex(0x7e8 + i, 3),
      label: HINTS_11[i] ?? 'módulo',
    }));
  }
  return TARGETS_29.map(({ t, label }) => ({
    id: `29:${hex(t, 2)}`,
    // 18DA tt F1 → request to module tt from tester F1; response 18DA F1 tt.
    reqHeader: `18DA${hex(t & 0xff, 2)}F1`,
    rxHeader: `18DAF1${hex(t & 0xff, 2)}`,
    label,
  }));
}

export const SCAN_PROBE = '3E00'; // TesterPresent: "¿estás ahí?"
// To identify the responder (ISO 14229-1 Table C.1): F187 is the maker's spare
// part number, every module's; F190 is the VIN, mostly only the engine's.
export const SCAN_IDENTIFY = ['22F187', '22F190'] as const;

// The positive answer (62 + DID) to an identify request, or null: a negative
// response (7F 22 31) means the module is there but this DID is not.
export function identifyReply(raw: string | null, request: string): string | null {
  if (!raw) return null;
  const positive = `62${request.slice(2).toUpperCase()}`;
  return raw.replace(/\s+/g, '').toUpperCase().includes(positive) ? raw.replace(/\s+/g, ' ').trim() : null;
}

// A 7F negative response still means the module is THERE (it answered).
export function moduleAnswered(raw: string): boolean {
  const c = raw.toUpperCase();
  if (/NO DATA|CAN ERROR|BUFFER|UNABLE|ERROR|TIMEOUT|^\?/.test(c)) return false;
  return /[0-9A-F]{2}/.test(c.replace(/\s/g, ''));
}

// ── Functional broadcast + multi-bus (M9, 2026-10-20) ────────────────────────
// One request to the functional address and every module on the bus answers at
// once — finds modules no list has, on any make (ISO 15765-4).

export const FUNCTIONAL_11 = '7DF';
export const FUNCTIONAL_29 = '18DB33F1';

// ── A header for one free request (obd_command) ─────────────────────────────
// The 2026-10-21 chat sent 27 requests with header 18DAF111: that is the ID the
// module 11 ANSWERS with (18DA F1 11: to the tester F1, from 11), so every one was
// "NO DATA" and proved nothing. A request goes to 18DA 11 F1. The same mistake on
// 11 bits is 7E8 for 7E0. Both are refused with the right one; the width must
// match the protocol. `rxHeader`: the reply's ID when it is known (to filter on it).
// Outside 7E0–7E7 the pairing is the maker's (714 → 77E on a VW/Audi): it is
// known only from `known`, the pairs scan_modules found on this car. Without it
// the 2026-10-28 Audi dashboard answered its F187 cut after the first frame ("4G8").
export type RequestHeader = { readonly ok: true; readonly reqHeader: string; readonly rxHeader: string | null } | { readonly ok: false; readonly message: string };

export function requestHeader(header: string, bit29: boolean, known: ReadonlyMap<string, string> = new Map()): RequestHeader {
  const h = header.replace(/\s+/g, '').toUpperCase();
  if (!/^[0-9A-F]+$/.test(h)) return { ok: false, message: 'El header es hexadecimal.' };
  if (bit29 && h.length !== 8) return { ok: false, message: 'Este auto usa CAN de 29 bits: el header tiene 8 dígitos, p. ej. 18DA11F1 (pedido al módulo 11).' };
  if (!bit29 && h.length !== 3) return { ok: false, message: 'Este auto usa CAN de 11 bits: el header tiene 3 dígitos, p. ej. 7E0.' };
  if (bit29) {
    if (h === FUNCTIONAL_29) return { ok: true, reqHeader: h, rxHeader: null };
    const m = /^18DA([0-9A-F]{2})([0-9A-F]{2})$/.exec(h);
    if (!m) return { ok: true, reqHeader: h, rxHeader: known.get(h) ?? null };
    const [, target, source] = m;
    if (target === 'F1' && source !== 'F1') {
      return { ok: false, message: `${h} es la dirección con la que RESPONDE el módulo ${source}; para pedirle algo usá 18DA${source}F1.` };
    }
    return { ok: true, reqHeader: h, rxHeader: `18DA${source}${target}` };
  }
  const n = parseInt(h, 16);
  if (n >= 0x7e8 && n <= 0x7ef) {
    return { ok: false, message: `${h} es la dirección con la que RESPONDE un módulo; para pedirle algo usá ${(n - 8).toString(16).toUpperCase()}.` };
  }
  if (n >= 0x7e0 && n <= 0x7e7) return { ok: true, reqHeader: h, rxHeader: (n + 8).toString(16).toUpperCase() };
  return { ok: true, reqHeader: h, rxHeader: known.get(h) ?? null };
}

export function isFunctional(header: string): boolean {
  return header === FUNCTIONAL_11 || header === FUNCTIONAL_29;
}

// A UDS/OBD refusal (7F, service, reason) in words, for the model and the driver.
const NRC: Readonly<Record<string, string>> = {
  '10': 'rechazo general',
  '11': 'el módulo no tiene ese servicio',
  '12': 'el módulo no tiene esa subfunción',
  '13': 'el pedido tiene un largo o formato incorrecto',
  '22': 'condiciones no aptas (p. ej. motor en marcha o falta contacto)',
  '31': 'ese identificador (DID/PID) no existe en este módulo',
  '33': 'necesita acceso de seguridad',
  '7E': 'no disponible en la sesión actual',
  '7F': 'servicio no disponible en la sesión actual',
};

// A refusal is a whole answer of its own: 7F first (after the ID and the PCI
// byte, when shown), then the service that was asked. A 7F anywhere else is
// data: the 2026-10-28 Audi answered 19 02 FF with "59 02 7F …" (7F is the
// status mask) and it was reported as "refused, code 00".
export function refusalIn(raw: string, service: string | null = null): { service: string; code: string; reason: string } | null {
  for (const line of raw.toUpperCase().split(/[\r\n]+/)) {
    const m = /^(?:[0-9A-F]{8}|[0-9A-F]{3})?(?:0[3-7])?7F([0-9A-F]{2})([0-9A-F]{2})/.exec(line.replace(/\s+/g, ''));
    if (!m || m[2] === '78') continue; // 78: "response pending", not a refusal
    if (service && m[1] !== service.toUpperCase()) continue;
    return { service: m[1]!, code: m[2]!, reason: NRC[m[2]!] ?? `código ${m[2]}` };
  }
  return null;
}

// The service a raw request asks ("22 F1 87" → "22"); null for AT/ST commands.
export function serviceOf(command: string): string | null {
  const c = command.replace(/\s+/g, '').toUpperCase();
  return /^(AT|ST)/.test(c) || !/^[0-9A-F]{2}/.test(c) ? null : c.slice(0, 2);
}

// The adapter did not get an answer (or the frame failed): nothing was learnt.
export function noAnswer(raw: string): boolean {
  return /^\s*(ERROR|NO DATA|\?|UNABLE TO CONNECT|CAN ERROR|BUS (INIT|ERROR|BUSY)|STOPPED|FB ERROR|DATA ERROR)/i.test(raw) || /NO DATA/i.test(raw);
}

export type Bus = 'HS' | 'MS' | 'SW';

// STN protocol presets (FRPM): ISO 15765, DLC=8. Only one CAN channel is
// active at a time, so we switch, scan, and restore HS.
export const BUS_PRESET: Record<Bus, { bit11: number; bit29: number; label: string }> = {
  HS: { bit11: 33, bit29: 34, label: 'HS-CAN (500 kbps)' },
  MS: { bit11: 53, bit29: 54, label: 'MS-CAN (125 kbps)' },
  SW: { bit11: 63, bit29: 64, label: 'SW-CAN (33,3 kbps)' },
};

// The car's current protocol string → the STN preset to restore it with.
export function protocolToPreset(protocol: string): number {
  const bit29 = /29BIT|29-?BIT/.test(protocol);
  const slow = /250K/.test(protocol);
  if (slow) return bit29 ? 36 : 35;
  return bit29 ? 34 : 33;
}

const FUNCTIONAL_RESPONSE = '7E'; // positive response to TesterPresent (3E + 40)

// The modules that answered a functional 3E 00, from header-prefixed lines.
// 11-bit: a line starts with 7E8–7EF (module = header − 8).
// 29-bit: a line starts with 18DAF1{tt} (module = tt).
export function respondersFrom(raw: string, bit29: boolean): ScanTarget[] {
  const out = new Map<string, ScanTarget>();
  for (const line of raw.split(/[\r\n]+/)) {
    const c = line.replace(/\s+/g, '').toUpperCase();
    if (!/^[0-9A-F]+$/.test(c)) continue;
    if (bit29) {
      if (!c.startsWith('18DAF1') || c.length < 8) continue;
      const tt = c.slice(6, 8);
      out.set(`29:${tt}`, { id: `29:${tt}`, reqHeader: `18DA${tt}F1`, rxHeader: `18DAF1${tt}`, label: 'módulo' });
    } else {
      const header = c.slice(0, 3);
      const n = parseInt(header, 16);
      if (!(n >= 0x7e8 && n <= 0x7ef)) continue;
      const req = (n - 8).toString(16).toUpperCase();
      out.set(`11:${req}`, { id: `11:${req}`, reqHeader: req, rxHeader: header, label: HINTS_11[n - 0x7e8] ?? 'módulo' });
    }
  }
  return [...out.values()];
}

export const FUNCTIONAL_PROBE = '3E00';
export { FUNCTIONAL_RESPONSE };

// ── Adapter-aware paths (2026-10-20) ─────────────────────────────────────────
// Three adapters, auto-detected at scan time:
//   - B33-U: vendor UDS AT set (AT UDS1 / AT URH), firmware does ISO-TP →
//     reliable multi-frame reads (full part numbers).
//   - B35/B14 (STN): STP bus switch + ATSH/ATCRA + functional broadcast.
//   - plain ELM327: HS-CAN only, ATSH path.

export type ScanPath = 'uds-at' | 'stn';

// The response to a UDS request, with the request echo removed (B33-U echoes
// the request first). What is left is the module's reply, or empty if none.
export function udsReply(raw: string, sentHex: string): string {
  const sent = sentHex.replace(/\s+/g, '').toUpperCase();
  const lines = raw
    .split(/[\r\n]+/)
    .map((l) => l.replace(/\s+/g, '').toUpperCase())
    .filter((l) => /^[0-9A-F]+$/.test(l) && l !== sent);
  return lines.join(' ');
}

// AT URH <TX> <RX> <data>: send a UDS request to a module on the B33-U.
export function urhCommand(reqHeader: string, rxHeader: string, data: string): string {
  return `AT URH ${reqHeader} ${rxHeader} ${data.replace(/\s+/g, '')}`;
}

// ── The make's own addresses (2026-10-21) ────────────────────────────────────
// Outside OBD, the request→response pairing is the maker's (ISO 15765-2
// §10.3.2 leaves it open): VW +0x6A, GM +0x400, PSA −0x100… Only 29-bit
// "normal fixed" (18DAttF1 → 18DAF1tt) is defined. So each target carries its
// response ID, and the adapter is told both.

const MAX_MAKE_TARGETS = 32;

// The make's targets added after the generic ones: same ID width as the live
// protocol (the adapter sends with the protocol's width), no repeats, capped.
// `skipped`: all left out; `otherWidth`: of those, addresses of the other ID width
// (11-bit ones on a 29-bit car: this adapter cannot reach them on this protocol);
// `overLimit`: the rest, beyond MAX_MAKE_TARGETS.
export function mergeTargets(base: readonly ScanTarget[], make: readonly ScanTarget[], bit29: boolean): { targets: ScanTarget[]; skipped: number; otherWidth: number; overLimit: number } {
  const seen = new Set(base.map((t) => t.id));
  const targets = [...base];
  let otherWidth = 0;
  let overLimit = 0;
  let added = 0;
  for (const t of make) {
    if (seen.has(t.id)) continue;
    if ((t.reqHeader.length === 8) !== bit29) {
      otherWidth += 1;
      continue;
    }
    if (added >= MAX_MAKE_TARGETS) {
      overLimit += 1;
      continue;
    }
    seen.add(t.id);
    targets.push(t);
    added += 1;
  }
  return { targets, skipped: otherWidth + overLimit, otherWidth, overLimit };
}

// Whether the adapter's default flow control misses this module: by default
// it answers a FirstFrame on RxID − 8 (11-bit) or with the two last bytes
// swapped (29-bit). A module elsewhere never gets the FlowControl and stops
// after the first frame (N_Bs timeout): the part number arrives cut.
export function needsFlowPair(t: ScanTarget): boolean {
  if (t.reqHeader.length === 8) return t.rxHeader !== `${t.reqHeader.slice(0, 4)}${t.reqHeader.slice(6, 8)}${t.reqHeader.slice(4, 6)}`;
  return parseInt(t.rxHeader, 16) - 8 !== parseInt(t.reqHeader, 16);
}
