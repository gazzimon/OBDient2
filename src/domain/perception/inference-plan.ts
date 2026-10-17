// Which part of the frame the detector analyses on each frame.
//
// The main camera stays continuous (safety alerts and AR need every frame).
// Instead of switching to the telephoto lens — 200–800 ms blind per switch on
// Android — every few frames the detector looks at a centre crop at full
// sensor resolution: a "virtual telephoto" that sees the distant lead car,
// traffic lights and signs without losing a single frame.

import { FULL_FRAME, type Region } from './detection';

export interface PlanOptions {
  // One crop pass every `cropEvery` frames (0 disables it).
  readonly cropEvery: number;
  // Crop size as a fraction of the frame, centred horizontally.
  readonly cropScale: number;
  // Vertical centre of the crop, normalised. The horizon sits a bit above the
  // middle on a windshield mount, and that is where far objects are.
  readonly cropCenterY: number;
}

export const DEFAULT_PLAN: PlanOptions = { cropEvery: 3, cropScale: 0.4, cropCenterY: 0.45 };

export function regionForFrame(frameIndex: number, opts: PlanOptions = DEFAULT_PLAN): Region {
  if (opts.cropEvery <= 0 || frameIndex % opts.cropEvery !== opts.cropEvery - 1) return FULL_FRAME;
  return centreCrop(opts.cropScale, opts.cropCenterY);
}

export function centreCrop(scale: number, centerY: number): Region {
  const half = scale / 2;
  const cy = Math.min(1 - half, Math.max(half, centerY));
  return { x1: 0.5 - half, y1: cy - half, x2: 0.5 + half, y2: cy + half };
}

// The crop centre follows the horizon the AR already computes, so the
// virtual telephoto keeps looking down the road when the mount tilts.
export function cropCenterFromHorizon(horizonYNorm: number): number {
  // Far objects sit on and just below the horizon.
  return Math.min(0.8, Math.max(0.2, horizonYNorm + 0.05));
}
