// What is normal for *this* car (2026-10-28): the history already keeps codes
// and trips; this adds how the car usually behaves, so a reading can be
// compared with its own past instead of a generic threshold.
//
// - Keyed by VIN only. A mechanic plugs the same adapter into many cars: a
//   baseline without a VIN would mix them, so nothing is learnt without one.
// - One value per session and metric, not one per second: an hour at idle in
//   a garage must not outweigh twenty short drives. A session is one adapter
//   connection; each metric keeps the mean of the samples that met its
//   condition (warm idle, cruising…), if there were enough of them.
// - Every metric is a running mean and spread of those session values
//   (Welford), capped so old sessions fade: after MAX_WEIGHT sessions each new
//   one counts like the average of the old ones (the car ages, parts change).
// - A deviation needs MIN_SESSIONS sessions and must be big in both senses:
//   several spreads from the mean and more than the metric's own floor, so a
//   car with a very steady history does not cry wolf over 20 rpm.

import type { PidId } from '@/core/constants/pids';

export type BaselineMetric =
  | 'idle_rpm'
  | 'idle_map'
  | 'idle_maf'
  | 'stft_warm'
  | 'ltft_warm'
  | 'charging_v'
  | 'resting_v'
  | 'cruise_coolant'
  | 'warmup_min'
  | 'l_per_100km';

export interface MetricInfo {
  readonly label: string;
  readonly unit: string;
  // Smallest difference worth mentioning, in the metric's unit.
  readonly floor: number;
  // Fewest samples in a session for its mean to count.
  readonly minSamples: number;
}

export const METRICS: Readonly<Record<BaselineMetric, MetricInfo>> = {
  idle_rpm: { label: 'ralentí en caliente', unit: 'rpm', floor: 80, minSamples: 10 },
  idle_map: { label: 'presión de admisión en ralentí', unit: 'kPa', floor: 5, minSamples: 10 },
  idle_maf: { label: 'caudal de aire en ralentí', unit: 'g/s', floor: 0.6, minSamples: 10 },
  stft_warm: { label: 'corrección corta de mezcla', unit: '%', floor: 4, minSamples: 20 },
  ltft_warm: { label: 'corrección larga de mezcla', unit: '%', floor: 4, minSamples: 20 },
  charging_v: { label: 'tensión de carga con el motor en marcha', unit: 'V', floor: 0.3, minSamples: 10 },
  resting_v: { label: 'tensión de batería con el motor apagado', unit: 'V', floor: 0.25, minSamples: 3 },
  cruise_coolant: { label: 'temperatura de motor en ruta', unit: '°C', floor: 4, minSamples: 30 },
  warmup_min: { label: 'tiempo hasta llegar a temperatura', unit: 'min', floor: 3, minSamples: 1 },
  l_per_100km: { label: 'consumo', unit: 'L/100 km', floor: 1.5, minSamples: 1 },
};

export const METRIC_IDS = Object.keys(METRICS) as BaselineMetric[];

export const MIN_SESSIONS = 3;
export const MAX_WEIGHT = 30;
// How many spreads away a value must be to count as unusual.
export const DEVIATION_Z = 2.5;

// Warm: the thermostat has opened on any ordinary engine.
export const WARM_C = 80;
// From below this at the start of a session, the warm-up is timed.
const COLD_START_C = 40;
const IDLE_MAX_KMH = 1;
const RUNNING_RPM = 400;
const CRUISE_MIN_KMH = 50;
// A trip this short says little about the consumption.
const MIN_TRIP_KM = 5;

export interface Stat {
  readonly n: number;
  readonly mean: number;
  // Sum of squared differences from the mean (Welford's M2).
  readonly m2: number;
  readonly min: number;
  readonly max: number;
  readonly lastAt: number;
}

export interface CarBaseline {
  readonly vin: string;
  readonly sessions: number;
  readonly firstAt: number;
  readonly metrics: Partial<Record<BaselineMetric, Stat>>;
}

// One sample of the car, with whatever was fresh at that moment.
export type BaselineSample = { readonly t: number } & Partial<Record<PidId, number>>;

export interface Deviation {
  readonly metric: BaselineMetric;
  readonly label: string;
  readonly unit: string;
  readonly value: number;
  readonly usual: number;
  // value − usual, in the metric's unit.
  readonly diff: number;
  readonly direction: 'high' | 'low';
  readonly sessions: number;
}

// Which metrics a sample feeds, and with what value.
export function classify(s: BaselineSample): Partial<Record<BaselineMetric, number>> {
  const out: Partial<Record<BaselineMetric, number>> = {};
  const rpm = s.RPM;
  const kmh = s.SPEED;
  const coolant = s.COOLANT_TEMP;
  const running = rpm != null && rpm >= RUNNING_RPM;
  const warm = coolant != null && coolant >= WARM_C;
  const idle = running && kmh != null && kmh <= IDLE_MAX_KMH;
  if (idle && warm) {
    out.idle_rpm = rpm;
    if (s.INTAKE_MAP != null) out.idle_map = s.INTAKE_MAP;
    if (s.MAF != null) out.idle_maf = s.MAF;
  }
  if (running && warm) {
    if (s.FUEL_TRIM_SHORT != null) out.stft_warm = s.FUEL_TRIM_SHORT;
    if (s.FUEL_TRIM_LONG != null) out.ltft_warm = s.FUEL_TRIM_LONG;
  }
  if (s.VOLTAGE != null) {
    if (running) out.charging_v = s.VOLTAGE;
    // Ignition on, engine stopped: the battery on its own.
    else if (rpm === 0) out.resting_v = s.VOLTAGE;
  }
  if (running && warm && kmh != null && kmh >= CRUISE_MIN_KMH) out.cruise_coolant = coolant;
  return out;
}

// The session in progress: sums per metric, and the warm-up clock.
export class BaselineSession {
  private readonly sums = new Map<BaselineMetric, { sum: number; n: number }>();
  private coldSince: number | null = null;
  private timedWarmup: number | null = null;
  private first = true;

  push(s: BaselineSample): void {
    for (const [m, v] of Object.entries(classify(s)) as [BaselineMetric, number][]) this.add(m, v);
    const coolant = s.COOLANT_TEMP;
    if (coolant == null || this.timedWarmup != null) return;
    const running = s.RPM != null && s.RPM >= RUNNING_RPM;
    // Only a cold start is timed: a car already warm says nothing about its thermostat.
    if (this.first) {
      this.first = false;
      if (coolant < COLD_START_C && running) this.coldSince = s.t;
      return;
    }
    if (this.coldSince == null) {
      if (coolant < COLD_START_C && running) this.coldSince = s.t;
      return;
    }
    if (coolant >= WARM_C) {
      this.timedWarmup = (s.t - this.coldSince) / 60_000;
      this.add('warmup_min', this.timedWarmup);
    }
  }

  // This session's value of each metric, when it has enough samples.
  values(): Partial<Record<BaselineMetric, number>> {
    const out: Partial<Record<BaselineMetric, number>> = {};
    for (const [m, { sum, n }] of this.sums) if (n >= METRICS[m].minSamples) out[m] = sum / n;
    return out;
  }

  private add(m: BaselineMetric, v: number): void {
    const cur = this.sums.get(m) ?? { sum: 0, n: 0 };
    this.sums.set(m, { sum: cur.sum + v, n: cur.n + 1 });
  }
}

// Welford's update, with the weight capped at MAX_WEIGHT.
export function addValue(stat: Stat | undefined, v: number, at: number): Stat {
  if (!stat) return { n: 1, mean: v, m2: 0, min: v, max: v, lastAt: at };
  const n = Math.min(stat.n, MAX_WEIGHT - 1) + 1;
  // With the weight capped, the old spread is scaled to the weight it keeps.
  const m2 = stat.n > n - 1 ? (stat.m2 * (n - 1)) / stat.n : stat.m2;
  const delta = v - stat.mean;
  const mean = stat.mean + delta / n;
  return { n, mean, m2: m2 + delta * (v - mean), min: Math.min(stat.min, v), max: Math.max(stat.max, v), lastAt: at };
}

export function spread(stat: Stat): number {
  return stat.n > 1 ? Math.sqrt(stat.m2 / (stat.n - 1)) : 0;
}

// Is this value unusual for this car? Null when the history is too short or
// the difference too small to matter.
export function deviation(metric: BaselineMetric, stat: Stat | undefined, value: number): Deviation | null {
  if (!stat || stat.n < MIN_SESSIONS) return null;
  const info = METRICS[metric];
  const diff = value - stat.mean;
  if (Math.abs(diff) < info.floor) return null;
  // A spread below the floor is treated as the floor: a car steady to 5 rpm
  // still has the meter's own noise.
  if (Math.abs(diff) < DEVIATION_Z * Math.max(spread(stat), info.floor / DEVIATION_Z)) return null;
  return {
    metric,
    label: info.label,
    unit: info.unit,
    value: round(value),
    usual: round(stat.mean),
    diff: round(diff),
    direction: diff > 0 ? 'high' : 'low',
    sessions: stat.n,
  };
}

// Where the baselines live: one JSON document (MMKV on the phone).
export interface BaselineStorage {
  load(): string | null;
  save(json: string): void;
}

// Cars kept; the least recently seen goes first (a mechanic sees many).
export const MAX_CARS = 200;

export class VehicleBaselines {
  private cars: Record<string, CarBaseline>;

  constructor(
    private readonly storage: BaselineStorage,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.cars = parse(storage.load());
  }

  get(vin: string | null): CarBaseline | null {
    return vin ? (this.cars[vin] ?? null) : null;
  }

  // A finished session: each metric that had enough samples adds one value.
  commit(vin: string | null, session: BaselineSession): void {
    if (!vin) return;
    const values = session.values();
    if (Object.keys(values).length === 0) return;
    const at = this.now();
    const car = this.cars[vin] ?? { vin, sessions: 0, firstAt: at, metrics: {} };
    const metrics = { ...car.metrics };
    for (const [m, v] of Object.entries(values) as [BaselineMetric, number][]) metrics[m] = addValue(metrics[m], v, at);
    this.cars[vin] = { ...car, sessions: car.sessions + 1, metrics };
    this.trim();
    this.save();
  }

  // A trip of "Mis viajes": its consumption, when the MAF gave one.
  addTrip(vin: string | null, distanceM: number, fuelL: number | null): void {
    if (!vin || fuelL == null || distanceM < MIN_TRIP_KM * 1000) return;
    const at = this.now();
    const car = this.cars[vin] ?? { vin, sessions: 0, firstAt: at, metrics: {} };
    const value = (fuelL / distanceM) * 100_000;
    this.cars[vin] = { ...car, metrics: { ...car.metrics, l_per_100km: addValue(car.metrics.l_per_100km, value, at) } };
    this.save();
  }

  // What is unusual now, comparing the session's values (and, if given, a
  // recent trip's consumption) with this car's past.
  deviations(vin: string | null, current: Partial<Record<BaselineMetric, number>>): Deviation[] {
    const car = this.get(vin);
    if (!car) return [];
    return (Object.entries(current) as [BaselineMetric, number][]).flatMap(([m, v]) => {
      const d = deviation(m, car.metrics[m], v);
      return d ? [d] : [];
    });
  }

  clear(): void {
    this.cars = {};
    this.save();
  }

  private trim(): void {
    const vins = Object.keys(this.cars);
    if (vins.length <= MAX_CARS) return;
    const lastSeen = (c: CarBaseline) => Math.max(...Object.values(c.metrics).map((s) => s?.lastAt ?? 0), c.firstAt);
    vins
      .sort((a, b) => lastSeen(this.cars[a]!) - lastSeen(this.cars[b]!))
      .slice(0, vins.length - MAX_CARS)
      .forEach((v) => delete this.cars[v]);
  }

  private save(): void {
    this.storage.save(JSON.stringify(this.cars));
  }
}

// "ralentí en caliente: 850 rpm (de 780 a 900 en 12 sesiones)", for the
// report and the assistant.
export function describeBaseline(car: CarBaseline): { metric: BaselineMetric; label: string; text: string }[] {
  return METRIC_IDS.flatMap((m) => {
    const s = car.metrics[m];
    if (!s) return [];
    const info = METRICS[m];
    const range = s.n > 1 ? ` (entre ${fmt(s.min)} y ${fmt(s.max)}, ${s.n} mediciones)` : ' (1 medición)';
    return [{ metric: m, label: info.label, text: `${fmt(s.mean)} ${info.unit}${range}` }];
  });
}

function parse(json: string | null): Record<string, CarBaseline> {
  if (!json) return {};
  try {
    const v: unknown = JSON.parse(json);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, CarBaseline>) : {};
  } catch {
    return {}; // a corrupt store must not take the diagnosis down with it
  }
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

function fmt(v: number): string {
  const r = Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
  return String(r).replace('.', ',');
}
