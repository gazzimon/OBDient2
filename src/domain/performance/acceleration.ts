// 0–100 km/h (2026-10-28): times an acceleration from a standstill with the
// OBD speed (up to ~24 Hz on an STN adapter, every sample), and estimates the
// power at the wheels from the car's mass.
//
// - Armed after the car has been still for a moment; the clock starts at the
//   last still sample, so the driver's reaction time is not counted (like a
//   rollout-free timeslip).
// - Each mark (60, 100 km/h) is interpolated between the two samples around
//   it: the OBD speed is whole km/h and arrives every ~40 ms.
// - It aborts if the car slows down (lifted off), if the data stops (the
//   phone went to sleep, the adapter dropped) or after MAX_RUN_MS.
// - Power: at each moment the force that accelerates the car plus rolling
//   resistance and air drag, times the speed (P = (m·a + Froll + Faero)·v),
//   smoothed over half a second. Mass and drag are estimates, so the figure
//   is a rough guide (±20 %), never a dyno reading.
//
// The screen warns: only on a closed road or private ground, never on the street.

export interface SpeedSample {
  readonly t: number; // ms
  readonly kmh: number;
}

export type RunState =
  | { readonly kind: 'waiting_stop' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'running'; readonly startedAt: number; readonly kmh: number }
  | { readonly kind: 'done'; readonly result: RunResult }
  | { readonly kind: 'aborted'; readonly reason: AbortReason };

export type AbortReason = 'slowed_down' | 'data_gap' | 'too_long';

export interface RunResult {
  readonly t0to60s: number | null;
  readonly t0to100s: number;
  readonly distanceM: number;
  readonly peakAccelG: number;
  // Null without the mass.
  readonly peakPowerKw: number | null;
  readonly samples: number;
}

export const TARGET_KMH = 100;
const SPLIT_KMH = 60;
// Still: below this for STILL_MS.
const STILL_KMH = 1;
const STILL_MS = 1000;
// Lifting off: this far below the highest speed of the run.
const SLOWDOWN_KMH = 4;
const MAX_GAP_MS = 1500;
const MAX_RUN_MS = 40_000;
// Power smoothing window.
const POWER_WINDOW_MS = 500;
const G = 9.81;
const AIR_DENSITY = 1.2;
// A typical small car: drag area (Cd·A) and rolling coefficient.
export const DEFAULT_CDA = 0.7;
const ROLLING = 0.012;

export class AccelerationRun {
  private state: RunState = { kind: 'waiting_stop' };
  private stillSince: number | null = null;
  private lastStill: SpeedSample | null = null;
  private samples: SpeedSample[] = [];
  private maxKmh = 0;
  private lastT: number | null = null;

  // Mass with the driver, kg; null skips the power.
  constructor(private readonly massKg: number | null, private readonly cda = DEFAULT_CDA) {}

  get current(): RunState {
    return this.state;
  }

  push(s: SpeedSample): RunState {
    const gap = this.lastT != null && s.t - this.lastT > MAX_GAP_MS;
    this.lastT = s.t;
    switch (this.state.kind) {
      case 'done':
      case 'aborted':
        return this.state;
      case 'waiting_stop':
      case 'ready':
        if (s.kmh < STILL_KMH) {
          this.stillSince ??= s.t;
          this.lastStill = s;
          if (s.t - this.stillSince >= STILL_MS) this.state = { kind: 'ready' };
          return this.state;
        }
        this.stillSince = null;
        if (this.state.kind === 'waiting_stop' || !this.lastStill || gap) {
          this.state = { kind: 'waiting_stop' };
          return this.state;
        }
        // Launch: the clock starts at the last still sample.
        this.samples = [{ t: this.lastStill.t, kmh: 0 }, s];
        this.maxKmh = s.kmh;
        this.state = { kind: 'running', startedAt: this.lastStill.t, kmh: s.kmh };
        return this.check();
      case 'running':
        if (gap) return (this.state = { kind: 'aborted', reason: 'data_gap' });
        this.samples.push(s);
        this.maxKmh = Math.max(this.maxKmh, s.kmh);
        this.state = { ...this.state, kmh: s.kmh };
        return this.check();
    }
  }

  private check(): RunState {
    if (this.state.kind !== 'running') return this.state;
    const last = this.samples[this.samples.length - 1]!;
    if (last.kmh >= TARGET_KMH) {
      this.state = { kind: 'done', result: summarize(this.samples, this.massKg, this.cda) };
      return this.state;
    }
    if (last.kmh < this.maxKmh - SLOWDOWN_KMH) return (this.state = { kind: 'aborted', reason: 'slowed_down' });
    if (last.t - this.state.startedAt > MAX_RUN_MS) return (this.state = { kind: 'aborted', reason: 'too_long' });
    return this.state;
  }
}

// When the speed first reached `kmh`, interpolated; null if it never did.
export function crossing(samples: readonly SpeedSample[], kmh: number): number | null {
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    if (b.kmh >= kmh && a.kmh < kmh) return a.t + ((kmh - a.kmh) / (b.kmh - a.kmh)) * (b.t - a.t);
  }
  return null;
}

export function summarize(samples: readonly SpeedSample[], massKg: number | null, cda = DEFAULT_CDA): RunResult {
  const t0 = samples[0]!.t;
  const at100 = crossing(samples, TARGET_KMH) ?? samples[samples.length - 1]!.t;
  const at60 = crossing(samples, SPLIT_KMH);
  // Distance up to the 100 mark (trapezoids).
  let distanceM = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    const tEnd = Math.min(b.t, at100);
    if (tEnd <= a.t) break;
    const bKmh = b.t > at100 ? a.kmh + ((b.kmh - a.kmh) * (tEnd - a.t)) / (b.t - a.t) : b.kmh;
    distanceM += ((a.kmh + bKmh) / 2 / 3.6) * ((tEnd - a.t) / 1000);
  }
  // Acceleration and power over a sliding window, to smooth the whole-km/h steps.
  let peakAccel = 0;
  let peakPower = 0;
  let j = 0;
  for (let i = 1; i < samples.length; i++) {
    const b = samples[i]!;
    while (j < i && b.t - samples[j]!.t > POWER_WINDOW_MS) j++;
    const a = samples[Math.max(0, Math.min(j, i - 1))]!;
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0) continue;
    const vA = a.kmh / 3.6;
    const vB = b.kmh / 3.6;
    const accel = (vB - vA) / dt;
    peakAccel = Math.max(peakAccel, accel);
    if (massKg != null) {
      const v = (vA + vB) / 2;
      const force = massKg * accel + ROLLING * massKg * G + 0.5 * AIR_DENSITY * cda * v * v;
      peakPower = Math.max(peakPower, (force * v) / 1000);
    }
  }
  return {
    t0to60s: at60 != null ? round2((at60 - t0) / 1000) : null,
    t0to100s: round2((at100 - t0) / 1000),
    distanceM: Math.round(distanceM),
    peakAccelG: round2(peakAccel / G),
    peakPowerKw: massKg != null ? Math.round(peakPower) : null,
    samples: samples.length,
  };
}

// Metric horsepower (CV), as Argentine spec sheets give it.
export const kwToCv = (kw: number): number => Math.round(kw * 1.3596);

export const ABORT_TEXT: Readonly<Record<AbortReason, string>> = {
  slowed_down: 'Se cortó: bajó la velocidad antes de llegar a 100.',
  data_gap: 'Se cortó: dejaron de llegar datos del auto (¿se apagó la pantalla o se desconectó el adaptador?).',
  too_long: 'Se cortó: pasaron más de 40 segundos sin llegar a 100.',
};

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
