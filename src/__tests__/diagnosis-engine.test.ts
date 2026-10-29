import { matchSymptoms, SYMPTOMS } from '@/domain/assistant/symptoms';
import { diagnose, hypothesesText, matchesCode, pidsUsed, type DiagnosisInput, type Readings, type RootCause } from '@/domain/diagnosis/engine';
import { ROOT_CAUSES } from '@/domain/diagnosis/root-causes';

const EMPTY: DiagnosisInput = { codes: [], readings: {}, symptoms: [], denied: [], deviations: [], comparable: [], carRead: true };
const r = (mean: number, min = mean, max = mean) => ({ mean, min, max, n: 10 });
const said = (text: string) => {
  const m = matchSymptoms(text);
  return { symptoms: m.confirmed, denied: m.denied };
};
const WARM_IDLE: Readings = { COOLANT_TEMP: r(90), RPM: r(800, 780, 820), SPEED: r(0) };

describe('diagnose', () => {
  it('a lean code with high trims in a warm engine points to an air leak first', () => {
    const top = diagnose(ROOT_CAUSES, {
      ...EMPTY,
      codes: ['P0171'],
      readings: { ...WARM_IDLE, FUEL_TRIM_SHORT: r(8), FUEL_TRIM_LONG: r(12), INTAKE_MAP: r(50) },
    });
    expect(top[0]?.id).toBe('vacuum_leak');
    expect(top[0]?.evidence).toEqual(expect.arrayContaining(['código de mezcla pobre (P0171/P0174)']));
  });

  it('a sensor rule only applies under its conditions', () => {
    // High trims in a cold engine are normal (open loop): no evidence.
    const cold = diagnose(ROOT_CAUSES, { ...EMPTY, readings: { COOLANT_TEMP: r(30), RPM: r(900), SPEED: r(0), FUEL_TRIM_SHORT: r(20), FUEL_TRIM_LONG: r(5) } });
    expect(cold.find((h) => h.id === 'vacuum_leak')).toBeUndefined();
  });

  it('what could not be measured is listed to check, not counted against', () => {
    const [h] = diagnose(ROOT_CAUSES, { ...EMPTY, carRead: false, ...said('tiene un silbido y tiembla en ralentí') });
    expect(h?.id).toBe('vacuum_leak');
    expect(h?.toCheck).toEqual(expect.arrayContaining(['código de mezcla pobre (P0171/P0174)']));
    expect(h?.confidence).toBe(100);
  });

  it('a denied symptom weighs against', () => {
    const yes = diagnose(ROOT_CAUSES, { ...EMPTY, codes: ['P0128'], readings: { COOLANT_TEMP: r(60, 40, 70), RUN_TIME: r(1200) }, ...said('no levanta temperatura') });
    const no = diagnose(ROOT_CAUSES, { ...EMPTY, codes: ['P0128'], readings: { COOLANT_TEMP: r(60, 40, 70), RUN_TIME: r(1200) }, symptoms: [], denied: ['no_warmup'] });
    const t = (l: typeof yes) => l.find((h) => h.id === 'thermostat_open')!;
    expect(t(yes).score).toBeGreaterThan(t(no).score);
    expect(t(no).against).toEqual(['no: no levanta temperatura']);
  });

  it('the baseline counts only when this car has enough history', () => {
    const dev = { metric: 'charging_v' as const, label: '', unit: 'V', value: 12.9, usual: 14.1, diff: -1.2, direction: 'low' as const, sessions: 8 };
    const withDev = diagnose(ROOT_CAUSES, { ...EMPTY, readings: { RPM: r(800), VOLTAGE: r(12.9) }, deviations: [dev], comparable: ['charging_v'] });
    expect(withDev[0]).toMatchObject({ id: 'charging_low', confidence: expect.any(Number) });
    expect(withDev[0]?.evidence).toContain('tensión de carga más baja que lo habitual en este auto');
  });

  it('a safety cause carries its warning, and nothing at all gives no hypotheses', () => {
    const [h] = diagnose(ROOT_CAUSES, { ...EMPTY, carRead: false, ...said('el pedal se va al fondo, pedal esponjoso') });
    expect(h).toMatchObject({ id: 'brakes_hydraulic' });
    expect(h?.safety).toMatch(/no sigas andando/);
    expect(diagnose(ROOT_CAUSES, EMPTY)).toEqual([]);
    expect(hypothesesText([])).toMatch(/no aparece una causa clara/);
  });

  it('overheating outranks a mild symptom match', () => {
    const top = diagnose(ROOT_CAUSES, { ...EMPTY, readings: { COOLANT_TEMP: r(104, 98, 108), RPM: r(900) }, ...said('levanta temperatura') });
    expect(top[0]?.id).toBe('overheating');
    expect(hypothesesText(top)).toMatch(/⚠ Si la temperatura sigue subiendo/);
  });
});

describe('the catalogue', () => {
  it('every symptom a cause names exists, and ids are unique', () => {
    const ids = new Set<string>();
    for (const c of ROOT_CAUSES) {
      expect(ids.has(c.id)).toBe(false);
      ids.add(c.id);
      for (const i of c.indicators) if (i.kind === 'symptom') expect(SYMPTOMS[i.symptom]).toBeDefined();
    }
  });

  it('only generic codes', () => {
    for (const c of ROOT_CAUSES) {
      for (const i of c.indicators) if (i.kind === 'dtc') for (const code of i.codes) expect(code).toMatch(/^(P0|P2|B0|C0|U0)/);
    }
  });

  it('prefixes match by start', () => {
    expect(matchesCode('P0304', 'P030*')).toBe(true);
    expect(matchesCode('P0420', 'P042')).toBe(false);
    const fake: RootCause[] = [{ id: 'x', title: 'x', system: 'motor', checks: [], indicators: [{ kind: 'sensor', pid: 'MAF', stat: 'mean', op: '>', value: 1, weight: 1, text: '', when: [{ pid: 'RPM', stat: 'mean', op: '>', value: 0 }] }] }];
    expect(pidsUsed(fake).sort()).toEqual(['MAF', 'RPM']);
  });
});
