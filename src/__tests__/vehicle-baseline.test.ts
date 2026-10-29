import {
  addValue,
  BaselineSession,
  classify,
  deviation,
  MAX_WEIGHT,
  spread,
  VehicleBaselines,
  type BaselineStorage,
} from '@/domain/vehicle/baseline';

function memory(): BaselineStorage & { json: string | null } {
  const s = { json: null as string | null, load: () => s.json, save: (j: string) => void (s.json = j) };
  return s;
}

const VIN = '8AGEA76C0RR000099';
const warmIdle = (t: number, rpm = 800) => ({ t, RPM: rpm, SPEED: 0, COOLANT_TEMP: 90, VOLTAGE: 14.1, FUEL_TRIM_SHORT: 1, FUEL_TRIM_LONG: 2 });

function sessionOf(n: number, sample: (t: number) => Parameters<BaselineSession['push']>[0]): BaselineSession {
  const s = new BaselineSession();
  for (let i = 0; i < n; i++) s.push(sample(i * 1000));
  return s;
}

describe('classify', () => {
  it('warm idle feeds idle, trims and charging; driving feeds the cruise temperature', () => {
    expect(classify(warmIdle(0))).toEqual({ idle_rpm: 800, stft_warm: 1, ltft_warm: 2, charging_v: 14.1 });
    expect(classify({ t: 0, RPM: 2200, SPEED: 90, COOLANT_TEMP: 92 })).toEqual({ cruise_coolant: 92 });
  });

  it('a cold engine feeds nothing but the voltage; ignition on with the engine off is the resting voltage', () => {
    expect(classify({ t: 0, RPM: 900, SPEED: 0, COOLANT_TEMP: 30, VOLTAGE: 14.3 })).toEqual({ charging_v: 14.3 });
    expect(classify({ t: 0, RPM: 0, VOLTAGE: 12.6 })).toEqual({ resting_v: 12.6 });
  });
});

describe('BaselineSession', () => {
  it('keeps a metric only with enough samples', () => {
    expect(sessionOf(5, warmIdle).values().idle_rpm).toBeUndefined();
    const v = sessionOf(30, warmIdle).values();
    expect(v.idle_rpm).toBe(800);
    expect(v.charging_v).toBeCloseTo(14.1);
  });

  it('times the warm-up only from a cold start', () => {
    const s = new BaselineSession();
    s.push({ t: 0, RPM: 900, COOLANT_TEMP: 20 });
    s.push({ t: 4 * 60_000, RPM: 900, COOLANT_TEMP: 60 });
    s.push({ t: 9 * 60_000, RPM: 900, COOLANT_TEMP: 81 });
    expect(s.values().warmup_min).toBe(9);

    const warm = new BaselineSession();
    warm.push({ t: 0, RPM: 900, COOLANT_TEMP: 85 });
    warm.push({ t: 60_000, RPM: 900, COOLANT_TEMP: 90 });
    expect(warm.values().warmup_min).toBeUndefined();
  });
});

describe('statistics', () => {
  it('Welford gives the mean and spread', () => {
    let s = addValue(undefined, 10, 0);
    for (const v of [12, 14]) s = addValue(s, v, 0);
    expect(s.mean).toBe(12);
    expect(spread(s)).toBeCloseTo(2);
  });

  it('the weight is capped so old sessions fade', () => {
    let s = addValue(undefined, 800, 0);
    for (let i = 0; i < 100; i++) s = addValue(s, 800, 0);
    expect(s.n).toBe(MAX_WEIGHT);
    s = addValue(s, 1100, 0);
    expect(s.mean).toBeCloseTo(810);
  });

  it('a deviation needs history and must beat both the spread and the floor', () => {
    let s = addValue(undefined, 800, 0);
    expect(deviation('idle_rpm', s, 1000)).toBeNull(); // 1 session
    for (const v of [810, 790, 805]) s = addValue(s, v, 0);
    expect(deviation('idle_rpm', s, 850)).toBeNull(); // under the 80 rpm floor
    expect(deviation('idle_rpm', s, 1000)).toMatchObject({ direction: 'high', usual: 801.25, sessions: 4 });
    expect(deviation('idle_rpm', s, 650)).toMatchObject({ direction: 'low' });
  });
});

describe('VehicleBaselines', () => {
  it('learns per VIN, never without one, and survives a restart', () => {
    const store = memory();
    const b = new VehicleBaselines(store, () => 1000);
    b.commit(null, sessionOf(30, warmIdle));
    expect(store.json).toBeNull();
    for (let i = 0; i < 4; i++) b.commit(VIN, sessionOf(30, warmIdle));
    const again = new VehicleBaselines(store);
    expect(again.get(VIN)).toMatchObject({ sessions: 4, metrics: { idle_rpm: { n: 4, mean: 800 } } });
    expect(again.get('OTHER')).toBeNull();
  });

  it('reports what is unusual now, and learns consumption from trips', () => {
    const b = new VehicleBaselines(memory());
    for (let i = 0; i < 4; i++) b.commit(VIN, sessionOf(30, (t) => warmIdle(t, 790 + i * 5)));
    expect(b.deviations(VIN, { idle_rpm: 1050, charging_v: 14.1 }).map((d) => d.metric)).toEqual(['idle_rpm']);
    b.addTrip(VIN, 2000, 0.2); // too short to count
    for (const l of [0.8, 0.82, 0.78]) b.addTrip(VIN, 10_000, l);
    expect(b.get(VIN)?.metrics.l_per_100km).toMatchObject({ n: 3, mean: 8 });
  });

  it('a corrupt store starts empty', () => {
    const s = memory();
    s.json = '{not json';
    expect(new VehicleBaselines(s).get(VIN)).toBeNull();
  });
});
