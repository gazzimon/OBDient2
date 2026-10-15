// Camera pitch and roll from the accelerometer, corrected for the car's own
// acceleration.
//
// An accelerometer cannot tell gravity from acceleration: braking at 3 m/s²
// looks like the phone tilting ~17° forward, and the AR route would jump down
// the screen at every stop. We know the car's acceleration from OBD speed
// (longitudinal) and speed × yaw rate (lateral, in curves), so we subtract it
// before estimating "up". What is left is low-passed: the mount is rigid, so
// the true pitch changes slowly and anything fast is noise or vibration.

import { toDeg } from '@/domain/geo/geo';

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

// Which way the phone lies in landscape, seen by the driver.
//   'top-left'  – top edge of the phone on the driver's left
//   'top-right' – top edge on the driver's right
export type LandscapeSide = 'top-left' | 'top-right';

export interface PoseSample {
  // Accelerometer including gravity, device axes (portrait: x right, y up,
  // z out of the screen toward the driver), m/s².
  readonly accelWithGravity: Vec3;
  readonly dtS: number;
}

export interface VehicleMotion {
  // Longitudinal acceleration, m/s² (positive = speeding up).
  readonly accelLongMps2: number;
  readonly speedMps: number;
  // Positive = turning left (counter-clockwise seen from above), deg/s.
  readonly yawRateDegS: number;
}

export interface PoseEstimate {
  readonly pitchDeg: number; // positive = camera looking down
  readonly rollDeg: number; // camera-model.ts convention
  // How much of the raw reading was the car accelerating, 0..1+. High values
  // mean the estimate is leaning on the OBD correction — useful for the UI.
  readonly motionShare: number;
}

export interface PoseConfig {
  readonly side: LandscapeSide;
  // +1 when the sensor reports the reaction to gravity (reads "up", the
  // Android convention); -1 when it reports gravity itself. Field-calibrated.
  readonly gravitySign: 1 | -1;
  readonly timeConstantS: number;
}

export const DEFAULT_POSE_CONFIG: PoseConfig = {
  side: 'top-left',
  gravitySign: 1,
  timeConstantS: 1.5,
};

const G = 9.80665;

export class PoseEstimator {
  private up: Vec3 | null = null;

  constructor(private config: PoseConfig = DEFAULT_POSE_CONFIG) {}

  configure(config: PoseConfig): void {
    if (config.side !== this.config.side || config.gravitySign !== this.config.gravitySign) this.up = null;
    this.config = config;
  }

  update(sample: PoseSample, motion: VehicleMotion | null): PoseEstimate {
    const axes = cameraAxes(this.config.side);
    const raw = scale(sample.accelWithGravity, this.config.gravitySign);

    // The car's acceleration in device axes. The optical axis points forward
    // and image-left points left; their small pitch/roll error is second order.
    let vehicle: Vec3 = { x: 0, y: 0, z: 0 };
    if (motion) {
      const lateral = motion.speedMps * (motion.yawRateDegS * Math.PI) / 180;
      vehicle = add(scale(axes.forward, motion.accelLongMps2), scale(axes.right, -lateral));
    }
    const corrected = sub(raw, vehicle);

    const alpha = sample.dtS / (this.config.timeConstantS + sample.dtS);
    this.up = this.up ? lerp(this.up, corrected, alpha) : corrected;

    const u = normalize(this.up);
    const ux = dot(u, axes.right);
    const uy = dot(u, axes.down);
    const uz = dot(u, axes.forward);

    return {
      pitchDeg: toDeg(Math.asin(clamp(-uz, -1, 1))),
      rollDeg: toDeg(Math.atan2(ux, -uy)),
      motionShare: Math.hypot(vehicle.x, vehicle.y, vehicle.z) / G,
    };
  }

  // Yaw rate about the world vertical, deg/s, from the gyroscope.
  // Positive = counter-clockwise from above (turning left).
  yawRateDegS(rotationRateDegS: Vec3): number {
    if (!this.up) return 0;
    return dot(normalize(this.up), rotationRateDegS);
  }

  reset(): void {
    this.up = null;
  }
}

// Camera axes expressed in device axes. The back camera looks along −z.
export function cameraAxes(side: LandscapeSide): { right: Vec3; down: Vec3; forward: Vec3 } {
  const forward = { x: 0, y: 0, z: -1 };
  return side === 'top-left'
    ? { right: { x: 0, y: -1, z: 0 }, down: { x: -1, y: 0, z: 0 }, forward }
    : { right: { x: 0, y: 1, z: 0 }, down: { x: 1, y: 0, z: 0 }, forward };
}

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => add(a, scale(sub(b, a), t));
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function normalize(a: Vec3): Vec3 {
  const n = Math.hypot(a.x, a.y, a.z);
  return n === 0 ? { x: 0, y: 0, z: 1 } : scale(a, 1 / n);
}
