import { calculate, CalcError } from '@/core/utils/calculator';
import { fuelFromMaf } from '@/core/utils/fuel';

describe('calculate', () => {
  it('does arithmetic with precedence, powers and functions', () => {
    expect(calculate('2.52*3600/(14.7*740)')).toBeCloseTo(0.83398, 4);
    expect(calculate('2 + 3 * 4 ^ 2')).toBe(50);
    expect(calculate('2 ^ 3 ^ 2')).toBe(512);
    expect(calculate('-(3 - 5) % 3')).toBe(2);
    expect(calculate('round(2204 * 0.621371, 1)')).toBe(1369.5);
    expect(calculate('sqrt(16) + max(1, 7, 3) + pi')).toBeCloseTo(14.14159, 4);
  });

  it('refuses what is not arithmetic, never evaluates code', () => {
    for (const bad of ['process.exit()', '2,5 * 3', '1/0', '2 +', 'foo(1)', 'a'.repeat(201), 'constructor', 'tostring(1)', 'valueof(2)', '__proto__']) {
      expect(() => calculate(bad)).toThrow(CalcError);
    }
  });
});

describe('fuelFromMaf', () => {
  it('idle: litres per hour; moving: also per 100 km', () => {
    expect(fuelFromMaf(2.52, 0)).toMatchObject({ litersPerHour: 0.83, litersPer100Km: null });
    expect(fuelFromMaf(15, 90)).toMatchObject({ litersPerHour: 4.96, litersPer100Km: 5.5 });
  });
});
