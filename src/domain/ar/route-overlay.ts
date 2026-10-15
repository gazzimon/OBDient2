// Builds the AR scene: the route ahead as a ribbon on the road, plus a marker
// standing at the next maneuver. Pure geometry → pixels; the view only paints.

import { toEnu, type Enu, type LatLng } from '@/domain/geo/geo';
import { routeSlice, type RouteProgress } from '@/domain/navigation/route-progress';
import type { Route } from '@/domain/navigation/route';
import { project, projectPolyline, type CameraPose, type Intrinsics, type Pixel } from './camera-model';

export interface OverlayOptions {
  // How far ahead to draw, metres. Beyond ~150 m the ribbon is a few pixels
  // wide and pose error dominates.
  readonly lookAheadM: number;
  readonly ribbonWidthM: number;
  // Resampling step: a straight 300 m segment must still bend with perspective.
  readonly sampleStepM: number;
}

export const DEFAULT_OVERLAY: OverlayOptions = {
  lookAheadM: 150,
  ribbonWidthM: 2.6,
  sampleStepM: 5,
};

export interface ManeuverMarker {
  readonly base: Pixel; // on the road
  readonly top: Pixel; // ~3 m above it
}

export interface OverlayScene {
  // Closed polygon, image pixels. Empty when nothing is in view.
  readonly ribbon: readonly Pixel[];
  readonly centerline: readonly Pixel[];
  readonly maneuver: ManeuverMarker | null;
}

const EMPTY: OverlayScene = { ribbon: [], centerline: [], maneuver: null };

export function buildOverlay(
  route: Route,
  progress: RouteProgress,
  camera: LatLng,
  pose: CameraPose,
  intr: Intrinsics,
  opts: OverlayOptions = DEFAULT_OVERLAY,
): OverlayScene {
  const ahead = routeSlice(route, progress.offsetM, opts.lookAheadM);
  if (ahead.length < 2) return EMPTY;

  const enu = resample(ahead.map((p) => toEnu(camera, p)), opts.sampleStepM);
  const half = opts.ribbonWidthM / 2;
  const left: Enu[] = [];
  const right: Enu[] = [];
  for (let i = 0; i < enu.length; i++) {
    const [nx, ny] = normalAt(enu, i);
    const p = enu[i]!;
    left.push({ east: p.east + nx * half, north: p.north + ny * half, up: 0 });
    right.push({ east: p.east - nx * half, north: p.north - ny * half, up: 0 });
  }

  const l = projectPolyline(left, pose, intr);
  const r = projectPolyline(right, pose, intr);
  const ribbon = l.length >= 2 && r.length >= 2 ? [...l, ...r.reverse()] : [];

  let maneuver: ManeuverMarker | null = null;
  const m = progress.nextManeuver;
  if (m && progress.distanceToManeuverM != null && progress.distanceToManeuverM <= opts.lookAheadM) {
    const g = toEnu(camera, m.location);
    const base = project(g, pose, intr);
    const top = project({ ...g, up: 3 }, pose, intr);
    if (base && top) maneuver = { base, top };
  }

  return { ribbon, centerline: projectPolyline(enu, pose, intr), maneuver };
}

// Left-pointing unit normal of the polyline at vertex i (east, north).
function normalAt(pts: readonly Enu[], i: number): [number, number] {
  const a = pts[Math.max(0, i - 1)]!;
  const b = pts[Math.min(pts.length - 1, i + 1)]!;
  const dx = b.east - a.east;
  const dy = b.north - a.north;
  const n = Math.hypot(dx, dy) || 1;
  return [-dy / n, dx / n];
}

function resample(pts: readonly Enu[], step: number): Enu[] {
  const out: Enu[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const len = Math.hypot(b.east - a.east, b.north - a.north);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      out.push({ east: a.east + (b.east - a.east) * t, north: a.north + (b.north - a.north) * t, up: 0 });
    }
  }
  return out;
}
