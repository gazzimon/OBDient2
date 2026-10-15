// Where the car is ALONG the route: snapping, remaining distance, next
// maneuver, off-route and arrival detection. Pure and deterministic — the
// guidance and the AR overlay both read the same progress.

import { distanceM, fromEnu, toEnu, type LatLng } from '@/domain/geo/geo';
import type { Maneuver, Route } from './route';

export interface RouteProgress {
  // Closest point on the route to the fix.
  readonly snapped: LatLng;
  // Index of the geometry segment [i, i+1] the snapped point lies on.
  readonly segmentIndex: number;
  // Distance along the route to the snapped point, metres.
  readonly offsetM: number;
  readonly remainingM: number;
  // Lateral distance from the fix to the route, metres.
  readonly crossTrackM: number;
  readonly nextManeuver: Maneuver | null;
  readonly distanceToManeuverM: number | null;
  readonly offRoute: boolean;
  readonly arrived: boolean;
}

export interface ProgressTuning {
  // Beyond this lateral distance (plus GPS accuracy) a fix counts as off-route.
  readonly offRouteM: number;
  // How long the car must stay off the route before declaring it: a few
  // seconds of bad GPS (urban canyon) is noise, not a wrong turn.
  readonly offRouteMs: number;
  readonly arrivalM: number;
}

export const DEFAULT_TUNING: ProgressTuning = {
  offRouteM: 35,
  offRouteMs: 4000,
  arrivalM: 25,
};

// Stateful only in what must survive between fixes: the last segment (search
// window, so a route that loops back on itself does not snap to the wrong leg)
// and since when the car has been off it.
export class RouteTracker {
  private segmentIndex = 0;
  private offSinceMs: number | null = null;

  constructor(
    readonly route: Route,
    private readonly tuning: ProgressTuning = DEFAULT_TUNING,
  ) {
    if (route.geometry.length < 2) throw new Error('Route geometry needs at least 2 points');
  }

  update(fix: LatLng, accuracyM: number, tMs: number): RouteProgress {
    const { geometry, cumulativeM } = this.route;
    const lastSegment = geometry.length - 2;

    // Look a little back (GPS jitter) and well ahead (fast driving, sparse fixes).
    const from = Math.max(0, this.segmentIndex - 2);
    const to = Math.min(lastSegment, this.segmentIndex + 40);
    let best = closestOnSegments(geometry, fix, from, to);

    // Nothing close in the window (tunnel exit, app resumed): search everything.
    if (best.distanceM > this.tuning.offRouteM + accuracyM) {
      const global = closestOnSegments(geometry, fix, 0, lastSegment);
      if (global.distanceM < best.distanceM) best = global;
    }

    this.segmentIndex = best.segment;
    const offsetM = (cumulativeM[best.segment] ?? 0) + best.alongM;
    const remainingM = Math.max(0, this.route.distanceM - offsetM);

    const isOff = best.distanceM > this.tuning.offRouteM + accuracyM;
    if (!isOff) this.offSinceMs = null;
    else if (this.offSinceMs == null) this.offSinceMs = tMs;

    const nextManeuver = this.route.maneuvers.find((m) => m.routeOffsetM > offsetM + 1) ?? null;

    return {
      snapped: best.point,
      segmentIndex: best.segment,
      offsetM,
      remainingM,
      crossTrackM: best.distanceM,
      nextManeuver,
      distanceToManeuverM: nextManeuver ? nextManeuver.routeOffsetM - offsetM : null,
      offRoute: this.offSinceMs != null && tMs - this.offSinceMs >= this.tuning.offRouteMs,
      arrived: remainingM <= this.tuning.arrivalM,
    };
  }
}

// The stretch of route from `offsetM` to `offsetM + lengthM`, starting exactly
// at the offset (interpolated) — what the AR overlay draws in front of the car.
export function routeSlice(route: Route, offsetM: number, lengthM: number): LatLng[] {
  const { geometry, cumulativeM } = route;
  const end = Math.min(route.distanceM, offsetM + lengthM);
  const out: LatLng[] = [];

  for (let i = 0; i < geometry.length - 1; i++) {
    const a = geometry[i]!;
    const b = geometry[i + 1]!;
    const ca = cumulativeM[i]!;
    const cb = cumulativeM[i + 1]!;
    if (cb < offsetM) continue;
    if (ca > end) break;

    if (out.length === 0) out.push(interpolate(a, b, ca, cb, Math.max(offsetM, ca)));
    if (cb <= end) out.push(b);
    else {
      out.push(interpolate(a, b, ca, cb, end));
      break;
    }
  }
  return out;
}

// Cumulative distances for a polyline — what a RoutingPort adapter needs to
// build a Route.
export function cumulativeDistances(geometry: readonly LatLng[]): number[] {
  const out = [0];
  for (let i = 1; i < geometry.length; i++) {
    out.push(out[i - 1]! + distanceM(geometry[i - 1]!, geometry[i]!));
  }
  return out;
}

interface Closest {
  segment: number;
  point: LatLng;
  alongM: number;
  distanceM: number;
}

function closestOnSegments(geometry: readonly LatLng[], fix: LatLng, from: number, to: number): Closest {
  let best: Closest = { segment: from, point: geometry[from]!, alongM: 0, distanceM: Infinity };
  for (let i = from; i <= to; i++) {
    const a = toEnu(fix, geometry[i]!);
    const b = toEnu(fix, geometry[i + 1]!);
    const dx = b.east - a.east;
    const dy = b.north - a.north;
    const len2 = dx * dx + dy * dy;
    // Fix is the ENU origin, so project (0,0) onto segment a→b.
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, -(a.east * dx + a.north * dy) / len2));
    const px = a.east + t * dx;
    const py = a.north + t * dy;
    const d = Math.hypot(px, py);
    if (d < best.distanceM) {
      best = {
        segment: i,
        point: fromEnu(fix, { east: px, north: py }),
        alongM: t * Math.sqrt(len2),
        distanceM: d,
      };
    }
  }
  return best;
}

function interpolate(a: LatLng, b: LatLng, ca: number, cb: number, at: number): LatLng {
  const t = cb === ca ? 0 : (at - ca) / (cb - ca);
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}
