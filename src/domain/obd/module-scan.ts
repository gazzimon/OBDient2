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
