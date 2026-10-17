// From a box in the image to metres on the road, in the CAR's frame.
//
// The inverse of camera-model.ts: the ray through the box's bottom-centre
// pixel (where the object touches the road) is intersected with the ground
// plane below the lens. Same pose and calibration as the AR, so a well
// calibrated AR means well calibrated distances.
//
// When the bottom edge is not usable (object cut by the frame edge, or so far
// that a pixel spans metres), a size prior gives a second estimate:
// distance ≈ f · real height / pixel height.

import { focalPx, type CameraPose, type Intrinsics } from '@/domain/ar/camera-model';
import { toRad } from '@/domain/geo/geo';
import type { Box, ObjectClass } from './detection';

export interface GroundPoint {
  readonly forwardM: number; // along the car's axis
  readonly rightM: number; // positive to the right
}

// `pixel` in preview pixels. `yawOffsetDeg`: camera axis vs car axis
// (calibration). Null when the ray does not hit the road ahead.
export function pixelToGround(
  pixel: { x: number; y: number },
  pose: Pick<CameraPose, 'heightM' | 'pitchDeg' | 'rollDeg'>,
  intr: Intrinsics,
  yawOffsetDeg = 0,
): GroundPoint | null {
  const f = focalPx(intr);
  const x = (pixel.x - intr.width / 2) / f;
  const y = (pixel.y - intr.height / 2) / f;
  const z = 1;

  // Undo roll, then pitch (see worldToCamera for the forward transform).
  const φ = toRad(pose.rollDeg);
  const right = x * Math.cos(φ) + y * Math.sin(φ);
  const yLevel = -x * Math.sin(φ) + y * Math.cos(φ);
  const θ = toRad(pose.pitchDeg);
  const forward = z * Math.cos(θ) - yLevel * Math.sin(θ);
  const up = -(z * Math.sin(θ) + yLevel * Math.cos(θ));

  if (up >= -1e-6) return null; // at or above the horizon
  const t = pose.heightM / -up;
  const fw = t * forward;
  const rt = t * right;
  if (fw <= 0) return null;

  // Camera axis → car axis.
  const ψ = toRad(yawOffsetDeg);
  return {
    forwardM: fw * Math.cos(ψ) - rt * Math.sin(ψ),
    rightM: fw * Math.sin(ψ) + rt * Math.cos(ψ),
  };
}

// Typical heights, metres. Only for the fallback.
const HEIGHT_M: Partial<Record<ObjectClass, number>> = {
  car: 1.5,
  truck: 3.2,
  bus: 3.0,
  motorcycle: 1.4,
  bicycle: 1.5,
  person: 1.7,
  animal: 0.8,
};

export interface DistanceEstimate {
  readonly forwardM: number;
  readonly rightM: number;
  readonly source: 'ground' | 'size';
}

// Edge margin (normalised): a box touching the bottom edge is cut off, so its
// bottom is not where it meets the road.
const EDGE = 0.01;

export function estimateDistance(
  box: Box,
  cls: ObjectClass,
  pose: Pick<CameraPose, 'heightM' | 'pitchDeg' | 'rollDeg'>,
  intr: Intrinsics,
  yawOffsetDeg = 0,
): DistanceEstimate | null {
  const cx = ((box.x1 + box.x2) / 2) * intr.width;
  if (box.y2 < 1 - EDGE) {
    const g = pixelToGround({ x: cx, y: box.y2 * intr.height }, pose, intr, yawOffsetDeg);
    if (g && g.forwardM < 120) return { ...g, source: 'ground' };
  }
  const realH = HEIGHT_M[cls];
  const pxH = (box.y2 - box.y1) * intr.height;
  if (!realH || pxH < 4) return null;
  const forwardM = (focalPx(intr) * realH) / pxH;
  // Lateral from the box centre's bearing.
  const rightM = (forwardM * (cx - intr.width / 2)) / focalPx(intr);
  return { forwardM, rightM, source: 'size' };
}
