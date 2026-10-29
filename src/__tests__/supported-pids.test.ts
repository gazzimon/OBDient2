// Tests for supportedPids.ts — Mode-01 supported-PID bitmask parsing (PLAN-003
// Hito 0). All functions are pure (no BT, no I/O), so no mocks needed.

import {
  parseSupportedPidsByEcu,
  firstUnansweredRange,
  isRangePid,
  pidNumberFor,
  filterSupportedPids,
} from '@/core/utils/supportedPids';
import { DASHBOARD_PIDS, type PidId } from '@/core/constants/pids';

// ---------------------------------------------------------------------------
// parseSupportedPidsByEcu
// ---------------------------------------------------------------------------

// Headers off, as a clone that refuses ATH1 answers: every ECU's PIDs together.
const HEADERLESS = { headers: false, can: true } as const;
const allSupported = (raw: string, basePid: number) =>
  new Set(parseSupportedPidsByEcu(raw, basePid, HEADERLESS).flatMap((m) => [...m.supported]));

describe('parseSupportedPidsByEcu', () => {
  // Canonical SAE J1979 example for 0100. 0xBE1FB813 → PIDs 01,03,04,05,06,07,
  // 0C,0D,0E,0F,10,11,13,15,1C,1F,20 (widely published reference vector).
  it('parses the canonical 0100 response', () => {
    const [mask] = parseSupportedPidsByEcu('41 00 BE 1F B8 13', 0x00, HEADERLESS);
    expect(mask!.supported.has(0x0c)).toBe(true); // RPM
    expect(mask!.supported.has(0x0d)).toBe(true); // SPEED
    expect(mask!.supported.has(0x05)).toBe(true); // COOLANT_TEMP
    expect(mask!.supported.has(0x02)).toBe(false); // freeze-frame DTC — not set in BE
    expect(mask!.hasNextRange).toBe(true); // 0x20 bit set → query 0120
  });

  it('sets hasNextRange false when the base+0x20 bit is clear', () => {
    // Last byte 0x12 has LSB=0 → PID 0x20 unsupported → no next range.
    expect(parseSupportedPidsByEcu('41 00 BE 1F B8 12', 0x00, HEADERLESS)[0]!.hasNextRange).toBe(false);
  });

  it('keeps each CAN ECU bitmap separate', () => {
    const masks = parseSupportedPidsByEcu(
      '7E8 06 41 00 80 00 00 00\n7E9 06 41 00 01 00 00 00',
      0x00,
      { headers: true, can: true },
    );
    expect(masks).toHaveLength(2);
    expect(masks.map(({ ecu, supported }) => [ecu, [...supported]])).toEqual([
      ['7E8', [1]],
      ['7E9', [8]],
    ]);
  });

  // Multi-ECU with headers off: a PID is supported if ANY ECU reports it.
  it('ORs headerless masks from multiple ECUs, spaced or concatenated', () => {
    for (const raw of ['41 00 80 00 00 00 41 00 01 00 00 00', '410080000000410001000000']) {
      const supported = allSupported(raw, 0x00);
      expect(supported.has(0x01)).toBe(true);
      expect(supported.has(0x08)).toBe(true);
      expect(supported.has(0x02)).toBe(false);
    }
  });

  it('parses a 0120 range against the correct base', () => {
    // 0x80000000 at base 0x20 → PID 0x21 supported.
    const supported = allSupported('41 20 80 00 00 00', 0x20);
    expect(supported.has(0x21)).toBe(true);
    expect(supported.has(0x01)).toBe(false); // not the 0x00 range
  });

  it('distinguishes a valid empty bitmap from no usable response', () => {
    expect(
      parseSupportedPidsByEcu('7E8 06 41 00 00 00 00 00', 0x00, { headers: true, can: true }),
    ).toMatchObject([{ ecu: '7E8', supported: new Set(), hasNextRange: false }]);
    for (const raw of ['NO DATA', '', 'SEARCHING...']) {
      expect(parseSupportedPidsByEcu(raw, 0x00, { headers: true, can: true })).toEqual([]);
      expect(parseSupportedPidsByEcu(raw, 0x00, HEADERLESS)).toEqual([]);
    }
  });
});

describe('discovery gaps', () => {
  it('marks unknown only past the range an ECU announced and did not answer', () => {
    // 7E8 announced 0x20–0x40 and answered it, then announced 0x40 and went silent.
    // 7E9 said it has no next range: its absence above 0x20 is known.
    const byEcu = [
      { ecu: '7E8', numbers: [0x0c, 0x20, 0x2f, 0x40], ranges: [0x00, 0x20] },
      { ecu: '7E9', numbers: [0x0c], ranges: [0x00] },
    ];
    expect(firstUnansweredRange(byEcu)).toBe(0x40);
    expect(firstUnansweredRange([{ ecu: '7E8', numbers: [0x0c, 0x20], ranges: [0x00, 0x20] }])).toBeNull();
    expect(firstUnansweredRange([])).toBeNull();
  });

  it('tells the range markers from data PIDs', () => {
    expect([0x20, 0x40, 0xe0].every(isRangePid)).toBe(true);
    expect([0x0c, 0x21, 0x46].some(isRangePid)).toBe(false);
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

  it('does not turn a known empty bitmap into unknown support', () => {
    const result = filterSupportedPids(DASHBOARD_PIDS, new Set(), true);
    expect(result).toEqual(['VOLTAGE']);
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
