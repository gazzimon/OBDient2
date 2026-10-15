// Ego state: where the car is, where it points and how fast it goes — at the
// rate the AR needs (20–30 Hz), from sensors that each fail differently:
//
//   GPS      ~1 Hz, absolute, noisy, course only valid while moving
//   OBD      ~5–10 Hz speed, precise relative but scaled a few % off truth
//   gyro     fast and smooth, drifts
//
// Heading: integrate the gyro, pull toward the GPS course when moving.
// Speed:   OBD when fresh (scaled by a learned OBD/GPS factor), else GPS.
// Position: dead-reckon with speed + heading between fixes; when a fix lands,
//           the jump is absorbed over ~1 s so the AR overlay never snaps.
//
// It also keeps a short history in the ego frame — the format Qwen-Drive's
// planner expects (x forward, y left, heading positive to the left) — so the
// optional server path can use it without a second estimator.

import {
  angleDiffDeg,
  destination,
  fromEnu,
  normalizeDeg,
  toEnu,
  toRad,
  type LatLng,
} from '@/domain/geo/geo';

export interface GpsFix {
  readonly position: LatLng;
  readonly accuracyM: number;
  // Course over ground, degrees; null/negative when unknown.
  readonly courseDeg: number | null;
  readonly speedMps: number | null;
  readonly tMs: number;
}

export interface ObdSpeed {
  readonly kmh: number;
  readonly tMs: number;
}

export type SpeedSource = 'obd' | 'gps' | 'none';

export interface EgoState {
  readonly position: LatLng;
  readonly headingDeg: number;
  readonly headingValid: boolean;
  readonly speedMps: number;
  readonly speedSource: SpeedSource;
  readonly accelLongMps2: number;
  readonly yawRateDegS: number;
  readonly gpsAccuracyM: number;
  readonly tMs: number;
}

export interface EgoPose {
  readonly x: number; // forward, m
  readonly y: number; // left, m
  readonly headingRad: number; // positive = left
  readonly tMs: number;
}

const OBD_FRESH_MS = 1500;
const GPS_COURSE_MIN_MPS = 3;
const FIX_BLEND_S = 1;
const ACCEL_TAU_S = 0.4;
const HISTORY_MS = 2500;

export class EgoEstimator {
  private position: LatLng | null = null;
  private headingDeg = 0;
  private headingValid = false;
  private speedMps = 0;
  private speedSource: SpeedSource = 'none';
  private accelLong = 0;
  private yawRate = 0;
  private accuracyM = Infinity;
  private lastT: number | null = null;

  // Remaining correction from the last fix, absorbed gradually (ENU metres).
  private pending = { east: 0, north: 0 };

  private lastObd: ObdSpeed | null = null;
  private lastGpsSpeed: { mps: number; tMs: number } | null = null;
  // OBD speedometers read a few % high by design; learned against GPS.
  private obdScale = 1;

  private history: { position: LatLng; headingDeg: number; tMs: number }[] = [];

  // When nothing better exists yet (car parked at the start), the road the
  // route begins on is the best guess of where the car points.
  seedHeading(deg: number): void {
    if (!this.headingValid) {
      this.headingDeg = normalizeDeg(deg);
      this.headingValid = true;
    }
  }

  onGps(fix: GpsFix): void {
    this.accuracyM = fix.accuracyM;
    if (fix.speedMps != null && fix.speedMps >= 0) {
      this.lastGpsSpeed = { mps: fix.speedMps, tMs: fix.tMs };
      this.learnObdScale(fix);
    }

    if (!this.position) {
      this.position = fix.position;
    } else {
      const err = toEnu(this.position, fix.position);
      // Trust the fix in proportion to its quality.
      const w = fix.accuracyM <= 10 ? 1 : fix.accuracyM <= 30 ? 0.5 : 0.2;
      this.pending = { east: err.east * w, north: err.north * w };
    }

    const moving = (fix.speedMps ?? this.speedMps) >= GPS_COURSE_MIN_MPS;
    if (fix.courseDeg != null && fix.courseDeg >= 0 && moving) {
      if (!this.headingValid) {
        this.headingDeg = fix.courseDeg;
        this.headingValid = true;
      } else {
        // GPS course lags but does not drift; gyro is smooth but drifts.
        this.headingDeg = normalizeDeg(this.headingDeg + 0.5 * angleDiffDeg(fix.courseDeg, this.headingDeg));
      }
    }
  }

  onObdSpeed(sample: ObdSpeed): void {
    this.lastObd = sample;
  }

  // Advances the state to `tMs`. `yawRateDegS` from the gyro (positive = left).
  tick(tMs: number, yawRateDegS: number): EgoState | null {
    const dt = this.lastT == null ? 0 : Math.min(0.5, Math.max(0, (tMs - this.lastT) / 1000));
    this.lastT = tMs;
    if (!this.position) return null;

    // Speed.
    const prevSpeed = this.speedMps;
    if (this.lastObd && tMs - this.lastObd.tMs <= OBD_FRESH_MS) {
      this.speedMps = (this.lastObd.kmh / 3.6) * this.obdScale;
      this.speedSource = 'obd';
    } else if (this.lastGpsSpeed && tMs - this.lastGpsSpeed.tMs <= 3000) {
      this.speedMps = this.lastGpsSpeed.mps;
      this.speedSource = 'gps';
    } else {
      this.speedSource = 'none';
    }
    if (dt > 0) {
      const raw = (this.speedMps - prevSpeed) / dt;
      this.accelLong += (dt / (ACCEL_TAU_S + dt)) * (raw - this.accelLong);
    }

    // Heading: the gyro rate is counter-clockwise positive, heading is clockwise.
    this.yawRate = yawRateDegS;
    if (this.headingValid) this.headingDeg = normalizeDeg(this.headingDeg - yawRateDegS * dt);

    // Position: dead-reckon, then absorb part of the pending fix correction.
    let next = this.headingValid && this.speedMps > 0.3
      ? destination(this.position, this.headingDeg, this.speedMps * dt)
      : this.position;
    if (dt > 0) {
      const k = Math.min(1, dt / FIX_BLEND_S);
      const step = { east: this.pending.east * k, north: this.pending.north * k };
      next = fromEnu(next, step);
      this.pending = { east: this.pending.east - step.east, north: this.pending.north - step.north };
    }
    this.position = next;

    this.pushHistory(tMs);
    return this.state(tMs);
  }

  // Past poses in the CURRENT ego frame, oldest first, sampled every `stepMs`.
  egoFrameHistory(stepMs = 500, count = 4): EgoPose[] {
    const now = this.history[this.history.length - 1];
    if (!now) return [];
    const ψ = toRad(now.headingDeg);
    const out: EgoPose[] = [];
    for (let i = count - 1; i >= 0; i--) {
      const target = now.tMs - i * stepMs;
      const h = this.history.find((s) => s.tMs >= target) ?? now;
      const d = toEnu(now.position, h.position);
      out.push({
        x: d.east * Math.sin(ψ) + d.north * Math.cos(ψ),
        y: -(d.east * Math.cos(ψ) - d.north * Math.sin(ψ)),
        headingRad: -toRad(angleDiffDeg(h.headingDeg, now.headingDeg)),
        tMs: h.tMs,
      });
    }
    return out;
  }

  get obdSpeedScale(): number {
    return this.obdScale;
  }

  private learnObdScale(fix: GpsFix): void {
    const obd = this.lastObd;
    if (!obd || fix.speedMps == null || fix.accuracyM > 15) return;
    if (Math.abs(fix.tMs - obd.tMs) > 500) return;
    const obdMps = obd.kmh / 3.6;
    if (obdMps < 8 || fix.speedMps < 8) return; // ratio is meaningless when slow
    const ratio = fix.speedMps / obdMps;
    if (ratio < 0.85 || ratio > 1.15) return; // outlier (tunnel, multipath)
    this.obdScale += 0.02 * (ratio - this.obdScale);
  }

  private pushHistory(tMs: number): void {
    if (!this.position) return;
    this.history.push({ position: this.position, headingDeg: this.headingDeg, tMs });
    while (this.history.length > 0 && tMs - this.history[0]!.tMs > HISTORY_MS) this.history.shift();
  }

  private state(tMs: number): EgoState {
    return {
      position: this.position!,
      headingDeg: this.headingDeg,
      headingValid: this.headingValid,
      speedMps: this.speedMps,
      speedSource: this.speedSource,
      accelLongMps2: this.accelLong,
      yawRateDegS: this.yawRate,
      gpsAccuracyM: this.accuracyM,
      tMs,
    };
  }
}
