// One frame's understanding of the road ahead: tracked objects with metric
// position and closing rate, the ego corridor, and the lead vehicle.

import type { CameraPose, Intrinsics } from '@/domain/ar/camera-model';
import { VEHICLES, VRUS, type Box, type ObjectClass } from './detection';
import { estimateDistance, type DistanceEstimate } from './ground';
import type { Track } from './tracker';
import { scaleTtc, type TtcEstimate } from './ttc';

export interface PerceivedObject {
  readonly trackId: number;
  readonly cls: ObjectClass;
  readonly box: Box;
  readonly distance: DistanceEstimate | null;
  readonly ttc: TtcEstimate | null;
  readonly inPath: boolean;
}

export interface Scene {
  readonly objects: readonly PerceivedObject[];
  readonly lead: PerceivedObject | null; // closest vehicle in the ego corridor
  readonly vrusInPath: readonly PerceivedObject[];
}

// Half the car (0.9 m) plus a margin for wobble and estimate error.
export const CORRIDOR_HALF_WIDTH_M = 1.5;

export function buildScene(
  tracks: readonly Track[],
  now: number,
  camera: { pose: Pick<CameraPose, 'heightM' | 'pitchDeg' | 'rollDeg'>; intr: Intrinsics; yawOffsetDeg: number } | null,
): Scene {
  const objects = tracks.map((tr): PerceivedObject => {
    const distance = camera ? estimateDistance(tr.box, tr.cls, camera.pose, camera.intr, camera.yawOffsetDeg) : null;
    return {
      trackId: tr.id,
      cls: tr.cls,
      box: tr.box,
      distance,
      ttc: scaleTtc(tr.history, now),
      inPath: inCorridor(tr.box, distance),
    };
  });

  const vehiclesAhead = objects.filter((o) => o.inPath && VEHICLES.has(o.cls));
  const lead =
    vehiclesAhead.sort((a, b) => nearness(b) - nearness(a))[0] ?? null;
  return { objects, lead, vrusInPath: objects.filter((o) => o.inPath && VRUS.has(o.cls)) };
}

function inCorridor(box: Box, d: DistanceEstimate | null): boolean {
  if (d) return Math.abs(d.rightM) <= CORRIDOR_HALF_WIDTH_M;
  // No calibration: a centre band of the image is the best proxy.
  const cx = (box.x1 + box.x2) / 2;
  return cx > 0.35 && cx < 0.65;
}

// Larger = closer. Metric when possible, else the box bottom (lower in the
// image = closer on a flat road).
function nearness(o: PerceivedObject): number {
  return o.distance ? -o.distance.forwardM : o.box.y2 * 1000;
}
