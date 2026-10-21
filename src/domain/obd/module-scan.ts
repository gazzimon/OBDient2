// Discovering which modules answer (the "module tree" FORScan shows), with
// read-only probes only (decision 2026-10-20). For each candidate address the
// phone sets the header, asks TesterPresent (3E 00) and, if it answers, the
// VIN/part-number DID (22 F190). What responds is a real fact about THIS car,
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

// Common 29-bit targets (ISO/Ford-style); labels are hints, verified by 22 F190.
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
export const SCAN_IDENTIFY = '22F190'; // VIN / part number, to identify the responder

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
