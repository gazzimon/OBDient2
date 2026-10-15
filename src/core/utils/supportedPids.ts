// OBD-II Mode-01 "PIDs supported" bitmask discovery (PLAN-003, Hito 0).
//
// A vehicle answers 0100/0120/0140/0160 with a 32-bit mask telling which PIDs it
// supports. This lets the poller skip PIDs the vehicle doesn't expose instead of
// wasting a round-trip on each (which returns NODATA, or worse, times out).
//
// Dedicated parser (not obdParser.parsePidResponse) because the bitmask needs
// three things the live-PID parsers don't (PLAN-003 §1):
//   1. multi-ECU OR — headers are off, so several ECUs answer on one line and a
//      PID counts as supported if ANY of them reports it;
//   2. no-space fallback — some clones return the bytes concatenated;
//   3. range chaining — the base+0x20 bit means "the next range exists".

import { PID_DEFINITIONS, DASHBOARD_PIDS, type PidId } from '@/core/constants/pids';
import { tokenizeHexBytes } from '@/core/utils/hexFrame';

export interface SupportedPidsMask {
  // Absolute mode-01 PID numbers reported supported (e.g. 0x0C for RPM).
  readonly supported: Set<number>;
  // True when base+0x20 is set → the next 0x20 block should be queried.
  readonly hasNextRange: boolean;
}

// Parses one "PIDs supported" response for a given base PID (0x00/0x20/0x40).
// ORs the masks of every `41 <base> ...` frame present (multi-ECU).
export function parseSupportedPidsMask(raw: string, basePid: number): SupportedPidsMask {
  const bytes = tokenizeHexBytes(raw);
  const baseHex = basePid.toString(16).padStart(2, '0').toUpperCase();

  let mask = 0;
  for (let i = 0; i + 5 < bytes.length + 1; i++) {
    if (bytes[i] === '41' && bytes[i + 1] === baseHex) {
      const frame = bytes.slice(i + 2, i + 6);
      if (frame.length === 4 && frame.every((b) => /^[0-9A-F]{2}$/.test(b))) {
        const frameMask = frame.reduce((acc, b) => ((acc << 8) | parseInt(b, 16)) >>> 0, 0);
        mask = (mask | frameMask) >>> 0;
      }
    }
  }

  const supported = new Set<number>();
  for (let i = 0; i < 32; i++) {
    // Bit 31 (MSB) = base+0x01, bit 0 (LSB) = base+0x20.
    if ((mask & (0x80000000 >>> i)) !== 0) supported.add(basePid + i + 1);
  }

  return { supported, hasNextRange: supported.has(basePid + 0x20) };
}

// The mode-01 PID number a PidId maps to, derived from its command ('010C' →
// 0x0C). Returns null for AT-command PIDs (VOLTAGE/ATRV) that are read from the
// adapter itself, not the vehicle — those are always available.
export function pidNumberFor(pidId: PidId): number | null {
  const def = PID_DEFINITIONS[pidId];
  if (def.expectedResponseBytes === null) return null; // AT command (e.g. ATRV)
  const hex = /^01([0-9A-Fa-f]{2})$/.exec(def.command)?.[1];
  return hex != null ? parseInt(hex, 16) : null;
}

// Narrows a PID list to what the vehicle actually supports. AT-command PIDs are
// always kept. An EMPTY supported set means discovery failed or wasn't trusted →
// return the list unchanged so we poll everything (current behavior, PLAN-003 §2.3).
export function filterSupportedPids(
  all: readonly PidId[],
  supportedNumbers: ReadonlySet<number>,
): PidId[] {
  if (supportedNumbers.size === 0) return [...all];
  return all.filter((pid) => {
    const num = pidNumberFor(pid);
    return num === null || supportedNumbers.has(num);
  });
}

// The full mode-01 "PIDs supported" range, all 7 tramos (PLAN-005 §5: gap
// found against CarScanner AI, which walks the same 7; OBDIENT previously
// stopped at 0140). Extending this is safe even though nothing in
// DASHBOARD_PIDS lives past 0x46 today — the vehicle's own hasNextRange bit
// still stops the real round-trips short for any vehicle that doesn't go
// this far (confirmed on the Tracker 2024 bench: it stopped after 0180
// because the vehicle's own bitmask said so, not because of a client-side
// ceiling). The value is discovery/diagnostic in its own right — knowing
// what a vehicle exposes past what's actively read, without a manual
// debug-console bench session for every new vehicle.
export const SUPPORTED_PID_QUERIES: readonly { command: string; basePid: number }[] = [
  { command: '0100', basePid: 0x00 },
  { command: '0120', basePid: 0x20 },
  { command: '0140', basePid: 0x40 },
  { command: '0160', basePid: 0x60 },
  { command: '0180', basePid: 0x80 },
  { command: '01A0', basePid: 0xA0 },
  { command: '01C0', basePid: 0xC0 },
];

// Highest PID number any active list actually reads — exposed for callers
// that want to know that (e.g. deciding whether a discovered-but-unread PID
// is worth surfacing). No longer used to cap the discovery walk itself; see
// MAX_QUERYABLE_PID_NUMBER below for why that's now decoupled.
export function maxPidNumber(pids: readonly PidId[]): number {
  return pids.reduce((max, pid) => {
    const num = pidNumberFor(pid);
    return num != null && num > max ? num : max;
  }, 0);
}

// Ceiling for the discovery walk itself. Deliberately NOT
// `maxPidNumber(DASHBOARD_PIDS)` anymore (that tied discovery range to what's
// actively read, which is the opposite of what PLAN-005 §5 asked for — walk
// the full 7 tramos regardless of whether anything reads that range yet).
// Set past the last basePid in SUPPORTED_PID_QUERIES (0xC0) so the walk can
// actually reach it; the vehicle's own hasNextRange bit does the real
// early-stopping in practice.
export const MAX_QUERYABLE_PID_NUMBER = 0xE0;
