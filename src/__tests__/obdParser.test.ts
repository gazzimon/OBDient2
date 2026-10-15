import { parsePidResponse, isErrorResponse } from '@/core/utils/obdParser';

describe('isErrorResponse', () => {
  it('detects NODATA', () => {
    expect(isErrorResponse('NODATA')).toBe(true);
    expect(isErrorResponse('NO DATA')).toBe(true);
  });

  it('detects ERROR', () => {
    expect(isErrorResponse('ERROR')).toBe(true);
  });

  it('detects UNABLE TO CONNECT', () => {
    expect(isErrorResponse('UNABLE TO CONNECT')).toBe(true);
  });

  it('returns false for valid hex responses', () => {
    expect(isErrorResponse('41 0C 1A F8')).toBe(false);
    expect(isErrorResponse('41 0D 3C')).toBe(false);
  });
});

describe('parsePidResponse — RPM', () => {
  // Formula: ((A*256)+B)/4
  // Bytes: 1A=26, F8=248 → (26*256+248)/4 = (6656+248)/4 = 6904/4 = 1726
  it('parses a normal RPM response', () => {
    expect(parsePidResponse('RPM', '41 0C 1A F8')).toBe(1726);
  });

  // Idle RPM: 0B=11, 50=80 → (11*256+80)/4 = (2816+80)/4 = 2896/4 = 724
  it('parses idle RPM', () => {
    expect(parsePidResponse('RPM', '41 0C 0B 50')).toBe(724);
  });

  it('throws on NODATA response', () => {
    expect(() => parsePidResponse('RPM', 'NODATA')).toThrow();
  });
});

describe('parsePidResponse — SPEED', () => {
  // Formula: A → km/h
  // 0x3C = 60 km/h
  it('parses 60 km/h', () => {
    expect(parsePidResponse('SPEED', '41 0D 3C')).toBe(60);
  });

  it('parses 0 km/h (stopped)', () => {
    expect(parsePidResponse('SPEED', '41 0D 00')).toBe(0);
  });
});

describe('parsePidResponse — COOLANT_TEMP', () => {
  // Formula: A-40 → °C
  // 0x60 = 96 → 96-40 = 56°C
  it('parses normal coolant temp', () => {
    expect(parsePidResponse('COOLANT_TEMP', '41 05 60')).toBe(56);
  });

  // 0x8C = 140 → 140-40 = 100°C (alert threshold)
  it('parses threshold-level coolant temp (100°C)', () => {
    expect(parsePidResponse('COOLANT_TEMP', '41 05 8C')).toBe(100);
  });

  // 0x00 = 0 → 0-40 = -40°C (min)
  it('parses minimum coolant temp', () => {
    expect(parsePidResponse('COOLANT_TEMP', '41 05 00')).toBe(-40);
  });
});

describe('parsePidResponse — COOLANT_TEMP_SENSOR1', () => {
  // Real bench capture (Chevrolet Tracker 2024, PLAN-005): A=01 (bit0 set,
  // sensor 1 fitted), B=0x83=131 → 131-40 = 91°C, C=00 (sensor 2, ignored).
  it('parses sensor 1 temp from a real bench capture', () => {
    expect(parsePidResponse('COOLANT_TEMP_SENSOR1', '41 67 01 83 00')).toBe(91);
  });

  // A=00 → bit0 unset → sensor 1 not fitted, B is meaningless — must throw,
  // not silently return a garbage temperature.
  it('throws when the presence bit says sensor 1 is not fitted', () => {
    expect(() => parsePidResponse('COOLANT_TEMP_SENSOR1', '41 67 00 83 00')).toThrow();
  });

  // A=03 → both sensors fitted (bit0 and bit1 set); still only sensor 1 (B) is read.
  it('parses sensor 1 temp when both sensors are present', () => {
    expect(parsePidResponse('COOLANT_TEMP_SENSOR1', '41 67 03 5A 64')).toBe(50);
  });
});

describe('parsePidResponse — ENGINE_LOAD', () => {
  // Formula: A*100/255
  // 0xFF = 255 → 100%
  it('parses full load (100%)', () => {
    expect(parsePidResponse('ENGINE_LOAD', '41 04 FF')).toBe(100);
  });

  // 0x80 = 128 → 128*100/255 ≈ 50.2%
  it('parses ~50% load', () => {
    expect(parsePidResponse('ENGINE_LOAD', '41 04 80')).toBeCloseTo(50.2, 1);
  });
});

describe('parsePidResponse — MAF', () => {
  // Formula: ((A*256)+B)/100
  // 01=1, 90=144 → (1*256+144)/100 = 400/100 = 4.0 g/s
  it('parses MAF at idle', () => {
    expect(parsePidResponse('MAF', '41 10 01 90')).toBe(4);
  });
});

describe('parsePidResponse — header anchoring (PLAN-005 Fase 0 regression)', () => {
  // Before Fase 0, extractDataBytes blindly sliced off the first two tokens
  // regardless of their value — a leading stray token (echo fragment, adapter
  // noise) would silently shift every byte and corrupt the reading instead of
  // failing loudly. The header-anchored extractor must skip past it instead.
  it('finds the header even behind a leading stray token', () => {
    expect(parsePidResponse('RPM', 'JUNK 41 0C 1A F8')).toBe(1726);
  });

  // Two ECUs answering the same PID on one line (headers off) — the first
  // matching frame must win; trailing bytes from the second frame must not
  // shift a fixed-width formula's byte positions.
  it('takes the first frame when multiple ECUs answer the same PID', () => {
    expect(parsePidResponse('RPM', '41 0C 1A F8 41 0C 00 00')).toBe(1726);
  });

  it('throws when the header never appears', () => {
    expect(() => parsePidResponse('RPM', '41 0D 3C')).toThrow(); // wrong PID header
  });
});

describe('parsePidResponse — VOLTAGE', () => {
  it('parses normal battery voltage string', () => {
    expect(parsePidResponse('VOLTAGE', '12.3V')).toBe(12.3);
    expect(parsePidResponse('VOLTAGE', '14.2V')).toBe(14.2);
  });

  it('parses voltage string without V suffix', () => {
    expect(parsePidResponse('VOLTAGE', '11.8')).toBe(11.8);
  });

  it('throws on non-numeric response', () => {
    expect(() => parsePidResponse('VOLTAGE', 'NODATA')).toThrow();
  });
});
