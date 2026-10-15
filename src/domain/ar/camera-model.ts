// Pinhole camera model for a phone mounted on the windshield.
//
// Projects points on the road (local ENU around the phone) into preview pixels.
// The pose comes from three sources with very different reliability:
//   yaw   – vehicle heading (GPS course + gyro, see heading-filter.ts) + a
//           fixed mount offset found during calibration;
//   pitch – from gravity (pose-estimator.ts), + calibration offset;
//   roll  – from gravity, + calibration offset.
// The intrinsics come from the horizontal field of view, also calibrated: the
// app has no reliable per-device FOV, and a few degrees off is visible.

import { toRad, type Enu } from '@/domain/geo/geo';

export interface Intrinsics {
  readonly width: number; // preview width, px
  readonly height: number; // preview height, px
  readonly hfovDeg: number;
}

export interface CameraPose {
  // Height of the lens above the road, metres.
  readonly heightM: number;
  // Optical axis heading, degrees clockwise from true north.
  readonly yawDeg: number;
  // Positive = optical axis tilted DOWN toward the road.
  readonly pitchDeg: number;
  // Positive = image rotated clockwise (horizon tilts down to the right).
  readonly rollDeg: number;
}

export interface Pixel {
  readonly x: number;
  readonly y: number;
  // Distance along the optical axis, metres. Used for depth-based styling.
  readonly depthM: number;
}

// Points closer than this are not drawn: the bonnet hides them anyway, and the
// projection explodes as depth approaches zero.
export const NEAR_PLANE_M = 2;

interface CameraPoint {
  x: number; // right
  y: number; // down
  z: number; // forward (depth)
}

export function focalPx(intr: Intrinsics): number {
  return intr.width / 2 / Math.tan(toRad(intr.hfovDeg) / 2);
}

// World (ENU relative to the phone's ground point) → camera frame.
export function worldToCamera(p: Enu, pose: CameraPose): CameraPoint {
  const ψ = toRad(pose.yawDeg);
  const θ = toRad(pose.pitchDeg);
  const φ = toRad(pose.rollDeg);

  // Components along the level vehicle axes.
  const forward = p.east * Math.sin(ψ) + p.north * Math.cos(ψ);
  const right = p.east * Math.cos(ψ) - p.north * Math.sin(ψ);
  const up = p.up - pose.heightM;

  // Pitch down by θ: optical axis = f·cosθ − u·sinθ, image-down = −(u·cosθ + f·sinθ).
  const z = forward * Math.cos(θ) - up * Math.sin(θ);
  const yLevel = -(up * Math.cos(θ) + forward * Math.sin(θ));

  // Roll about the optical axis.
  const x = right * Math.cos(φ) - yLevel * Math.sin(φ);
  const y = right * Math.sin(φ) + yLevel * Math.cos(φ);
  return { x, y, z };
}

export function project(p: Enu, pose: CameraPose, intr: Intrinsics): Pixel | null {
  const c = worldToCamera(p, pose);
  if (c.z < NEAR_PLANE_M) return null;
  return toPixel(c, intr);
}

// Projects a ground polyline, clipping it against the near plane so a route
// that starts beside/behind the camera still draws from the bottom edge.
export function projectPolyline(points: readonly Enu[], pose: CameraPose, intr: Intrinsics): Pixel[] {
  const cam = points.map((p) => worldToCamera(p, pose));
  const out: Pixel[] = [];
  for (let i = 0; i < cam.length; i++) {
    const c = cam[i]!;
    const prev = i > 0 ? cam[i - 1]! : null;
    if (prev && (prev.z < NEAR_PLANE_M) !== (c.z < NEAR_PLANE_M)) {
      out.push(toPixel(clipToNear(prev, c), intr));
    }
    if (c.z >= NEAR_PLANE_M) out.push(toPixel(c, intr));
  }
  return out;
}

// Image row of the horizon (points at infinity on the level ground) at the
// image centre column. Used by calibration to show where the app thinks the
// horizon is — the fastest way for a person to see a wrong pitch.
export function horizonY(pose: CameraPose, intr: Intrinsics): number {
  return intr.height / 2 - focalPx(intr) * Math.tan(toRad(pose.pitchDeg));
}

function toPixel(c: CameraPoint, intr: Intrinsics): Pixel {
  const f = focalPx(intr);
  return {
    x: intr.width / 2 + (f * c.x) / c.z,
    y: intr.height / 2 + (f * c.y) / c.z,
    depthM: c.z,
  };
}

function clipToNear(a: CameraPoint, b: CameraPoint): CameraPoint {
  const t = (NEAR_PLANE_M - a.z) / (b.z - a.z);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: NEAR_PLANE_M };
}
