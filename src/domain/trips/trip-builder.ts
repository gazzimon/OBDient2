// "Mis viajes": a trip summary for the person, built from one sample per
// second while the adapter is connected (decision 2026-10-19: recorded with the
// app open and the OBD connected; without OBD nothing is recorded).
//
// Not the technical trip log (domain/recording): that keeps every raw sensor
// sample for debugging. This keeps what a driver wants to see later: where,
// when, how far, how fast, how much fuel, where it stopped.
//
// - Distance from the speed × time, like an odometer (the OBD speed when it is
//   fresh): the GPS can freeze with the screen off — seen on the road
//   2026-10-20, trips of several km left with ~0 m and thrown away — and the
//   speed keeps arriving. Positions only draw the path.
// - Starts when the car moves (≥ 5 km/h).
// - A stop is ≥ 2 min below 3 km/h: it is kept as a stop, adds no distance.
// - Ends after 15 min stopped, or when the adapter goes (engine off).
// - One point every ~20 m (or 30 s): ~50 KB per hour of driving.
// - Shorter than 200 m or 1 min of driving: not a trip (moving the car in
//   the garage).

export interface TripSample {
  readonly t: number;
  readonly lat: number;
  readonly lng: number;
  readonly kmh: number;
  // Fuel flow from the MAF, litres per hour; null when not read.
  readonly fuelLph: number | null;
}

export interface TripPoint {
  readonly lat: number;
  readonly lng: number;
  readonly t: number;
  readonly kmh: number;
}

export interface TripStop {
  readonly lat: number;
  readonly lng: number;
  readonly from: number;
  readonly to: number;
}

export interface Trip {
  readonly id: string;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly distanceM: number;
  // Time actually moving (stops left out).
  readonly movingS: number;
  readonly maxKmh: number;
  readonly avgKmh: number;
  // Estimated from the MAF; null when it was never read.
  readonly fuelL: number | null;
  readonly path: readonly TripPoint[];
  readonly stops: readonly TripStop[];
  readonly vin: string | null;
  // Filled after the trip: place names, codes seen during it.
  readonly startName?: string | null;
  readonly endName?: string | null;
  readonly codes?: readonly string[];
}

export const MOVING_KMH = 5;
const STILL_KMH = 3;
export const STOP_AFTER_MS = 2 * 60_000;
export const END_AFTER_MS = 15 * 60_000;
const POINT_EVERY_M = 20;
const POINT_EVERY_MS = 30_000;
const MIN_TRIP_M = 200;
const MIN_TRIP_S = 60;
// Longer than this between samples, the app was paused (screen off, another
// app): the speed in between is unknown, so only the straight line between the
// two positions counts.
const MAX_GAP_MS = 10_000;

export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// The trip in progress, as plain data (saved now and then, so a killed app
// does not lose it).
export interface TripDraft {
  readonly id: string;
  readonly vin: string | null;
  startedAt: number;
  lastMovingAt: number;
  lastT: number;
  last: { lat: number; lng: number } | null;
  distanceM: number;
  movingS: number;
  maxKmh: number;
  fuelL: number | null;
  path: TripPoint[];
  stops: TripStop[];
  // Below STILL_KMH since then (null while moving).
  stillSince: number | null;
  stillAt: { lat: number; lng: number } | null;
}

export type BuilderEvent = { readonly type: 'started' } | { readonly type: 'ended'; readonly trip: Trip | null };

export class TripBuilder {
  private draft: TripDraft | null = null;

  constructor(
    private readonly newId: () => string,
    private readonly vin: () => string | null = () => null,
  ) {}

  get current(): TripDraft | null {
    return this.draft;
  }

  // Picks up a trip saved before the app was closed.
  resume(draft: TripDraft): void {
    this.draft = draft;
  }

  push(s: TripSample): BuilderEvent | null {
    const d = this.draft;
    if (!d) {
      if (s.kmh < MOVING_KMH) return null;
      this.draft = {
        id: this.newId(),
        vin: this.vin(),
        startedAt: s.t,
        lastMovingAt: s.t,
        lastT: s.t,
        last: { lat: s.lat, lng: s.lng },
        distanceM: 0,
        movingS: 0,
        maxKmh: s.kmh,
        fuelL: s.fuelLph != null ? 0 : null,
        path: [{ lat: s.lat, lng: s.lng, t: s.t, kmh: s.kmh }],
        stops: [],
        stillSince: null,
        stillAt: null,
      };
      return { type: 'started' };
    }

    const dt = s.t - d.lastT;
    d.lastT = s.t;
    const gap = dt <= 0 || dt > MAX_GAP_MS;

    if (s.kmh < STILL_KMH) {
      if (d.stillSince == null) {
        d.stillSince = s.t;
        d.stillAt = { lat: s.lat, lng: s.lng };
      }
      if (s.t - d.stillSince >= END_AFTER_MS) return { type: 'ended', trip: this.finish() };
      // Stopped: no distance, no fuel (idling is real but the trip is not moving).
      return null;
    }

    // Moving again after a long enough stop: that was a stop.
    if (d.stillSince != null && d.stillAt && s.t - d.stillSince >= STOP_AFTER_MS) {
      d.stops.push({ ...d.stillAt, from: d.stillSince, to: s.t });
    }
    d.stillSince = null;
    d.stillAt = null;

    if (!gap) {
      d.distanceM += (s.kmh / 3.6) * (dt / 1000);
      d.movingS += dt / 1000;
      if (d.fuelL != null && s.fuelLph != null) d.fuelL += (s.fuelLph * dt) / 3_600_000;
    }
    else if (d.last) d.distanceM += distanceM(d.last, s);
    if (d.fuelL == null && s.fuelLph != null) d.fuelL = 0;
    d.last = { lat: s.lat, lng: s.lng };
    d.lastMovingAt = s.t;
    d.maxKmh = Math.max(d.maxKmh, s.kmh);

    const prev = d.path[d.path.length - 1]!;
    if (distanceM(prev, s) >= POINT_EVERY_M || s.t - prev.t >= POINT_EVERY_MS) {
      d.path.push({ lat: s.lat, lng: s.lng, t: s.t, kmh: s.kmh });
    }
    return null;
  }

  // The adapter went (engine off) or recording stopped: close the trip.
  finish(): Trip | null {
    const d = this.draft;
    this.draft = null;
    if (!d || d.distanceM < MIN_TRIP_M || d.movingS < MIN_TRIP_S) return null;
    const path = d.path[d.path.length - 1]!.t < d.lastMovingAt && d.last ? [...d.path, { ...d.last, t: d.lastMovingAt, kmh: 0 }] : d.path;
    return {
      id: d.id,
      startedAt: d.startedAt,
      endedAt: d.lastMovingAt,
      distanceM: Math.round(d.distanceM),
      movingS: Math.round(d.movingS),
      maxKmh: Math.round(d.maxKmh),
      avgKmh: d.movingS > 0 ? Math.round((d.distanceM / d.movingS) * 3.6) : 0,
      fuelL: d.fuelL != null ? Math.round(d.fuelL * 100) / 100 : null,
      path,
      stops: d.stops,
      vin: d.vin,
    };
  }
}
