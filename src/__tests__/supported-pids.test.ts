// Tests for supportedPids.ts — Mode-01 supported-PID bitmask parsing (PLAN-003
// Hito 0). All functions are pure (no BT, no I/O), so no mocks needed.

import {
  parseSupportedPidsMask,
  pidNumberFor,
  filterSupportedPids,
} from '@/core/utils/supportedPids';
import { DASHBOARD_PIDS, type PidId } from '@/core/constants/pids';

// ---------------------------------------------------------------------------
// parseSupportedPidsMask
// ---------------------------------------------------------------------------

describe('parseSupportedPidsMask', () => {
  // Canonical SAE J1979 example for 0100. 0xBE1FB813 → PIDs 01,03,04,05,06,07,
  // 0C,0D,0E,0F,10,11,13,15,1C,1F,20 (widely published reference vector).
  it('parses the canonical 0100 response', () => {
    const { supported, hasNextRange } = parseSupportedPidsMask('41 00 BE 1F B8 13', 0x00);
    expect(supported.has(0x0c)).toBe(true); // RPM
    expect(supported.has(0x0d)).toBe(true); // SPEED
    expect(supported.has(0x05)).toBe(true); // COOLANT_TEMP
    expect(supported.has(0x02)).toBe(false); // freeze-frame DTC — not set in BE
    expect(hasNextRange).toBe(true); // 0x20 bit set → query 0120
  });

  it('sets hasNextRange false when the base+0x20 bit is clear', () => {
    // Last byte 0x12 has LSB=0 → PID 0x20 unsupported → no next range.
    const { hasNextRange } = parseSupportedPidsMask('41 00 BE 1F B8 12', 0x00);
    expect(hasNextRange).toBe(false);
  });

  // Multi-ECU: two frames on one line (headers off). A PID is supported if ANY
  // ECU reports it → the masks must be OR-ed.
  it('ORs masks from multiple ECUs', () => {
    // ECU A supports 0x01 only (0x80000000); ECU B supports 0x08 only (0x01000000).
    const raw = '41 00 80 00 00 00 41 00 01 00 00 00';
    const { supported } = parseSupportedPidsMask(raw, 0x00);
    expect(supported.has(0x01)).toBe(true);
    expect(supported.has(0x08)).toBe(true);
    expect(supported.has(0x02)).toBe(false);
  });

  // Some clones drop the spaces.
  it('handles a concatenated (no-space) response', () => {
    const { supported } = parseSupportedPidsMask('4100BE1FB813', 0x00);
    expect(supported.has(0x0c)).toBe(true);
    expect(supported.has(0x0d)).toBe(true);
  });

  it('parses a 0120 range against the correct base', () => {
    // 0x80000000 at base 0x20 → PID 0x21 supported.
    const { supported } = parseSupportedPidsMask('41 20 80 00 00 00', 0x20);
    expect(supported.has(0x21)).toBe(true);
    expect(supported.has(0x01)).toBe(false); // not the 0x00 range
  });

  it('returns an empty set for NODATA / garbage', () => {
    expect(parseSupportedPidsMask('NO DATA', 0x00).supported.size).toBe(0);
    expect(parseSupportedPidsMask('', 0x00).supported.size).toBe(0);
    expect(parseSupportedPidsMask('SEARCHING...', 0x00).supported.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// pidNumberFor
// ---------------------------------------------------------------------------

describe('pidNumberFor', () => {
  it('derives the PID number from the command', () => {
    expect(pidNumberFor('RPM')).toBe(0x0c);
    expect(pidNumberFor('COOLANT_TEMP')).toBe(0x05);
    expect(pidNumberFor('AMBIENT_TEMP')).toBe(0x46);
  });

  it('returns null for AT-command PIDs (adapter-side, always available)', () => {
    expect(pidNumberFor('VOLTAGE')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// filterSupportedPids
// ---------------------------------------------------------------------------

describe('filterSupportedPids', () => {
  it('keeps only supported PIDs plus always-on AT PIDs', () => {
    // Vehicle supports RPM (0x0C) and SPEED (0x0D) only.
    const supported = new Set([0x0c, 0x0d]);
    const result = filterSupportedPids(DASHBOARD_PIDS, supported);
    expect(result).toContain('RPM');
    expect(result).toContain('SPEED');
    expect(result).toContain('VOLTAGE'); // AT command — always kept
    expect(result).not.toContain('CATALYST_TEMP'); // 0x3C not in the set
  });

  it('returns the full list unchanged when discovery yields nothing', () => {
    const result = filterSupportedPids(DASHBOARD_PIDS, new Set());
    expect(result).toEqual([...DASHBOARD_PIDS]);
  });

  it('never drops a PID the vehicle reports', () => {
    const everyNumber = new Set<number>(
      (DASHBOARD_PIDS as readonly PidId[])
        .map(pidNumberFor)
        .filter((n): n is number => n !== null),
    );
    const result = filterSupportedPids(DASHBOARD_PIDS, everyNumber);
    expect(result).toEqual([...DASHBOARD_PIDS]);
  });
});
