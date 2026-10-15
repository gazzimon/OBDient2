// Small-area geodesy for navigation and AR.
//
// Everything AR draws lies within a few hundred metres of the car, so a local
// tangent plane (East-North-Up) around the current position is exact enough:
// the equirectangular error at 500 m is centimetres, far below GPS noise.

export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

// Metres in a local East-North-Up frame. `up` is 0 for everything we draw:
// the road is assumed to be the ground plane under the car.
export interface Enu {
  readonly east: number;
  readonly north: number;
  readonly up: number;
}

const EARTH_RADIUS_M = 6_371_008.8;
const DEG = Math.PI / 180;

export const toRad = (deg: number): number => deg * DEG;
export const toDeg = (rad: number): number => rad / DEG;

// Great-circle distance in metres.
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Initial bearing from a to b, degrees clockwise from true north, [0, 360).
export function bearingDeg(a: LatLng, b: LatLng): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return normalizeDeg(toDeg(Math.atan2(y, x)));
}

// Point reached travelling `meters` from `origin` on `bearing` (degrees).
export function destination(origin: LatLng, bearing: number, meters: number): LatLng {
  const δ = meters / EARTH_RADIUS_M;
  const θ = toRad(bearing);
  const φ1 = toRad(origin.lat);
  const λ1 = toRad(origin.lng);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 =
    λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: toDeg(φ2), lng: toDeg(λ2) };
}

// Local tangent plane around `origin`.
export function toEnu(origin: LatLng, point: LatLng): Enu {
  return {
    east: toRad(point.lng - origin.lng) * Math.cos(toRad(origin.lat)) * EARTH_RADIUS_M,
    north: toRad(point.lat - origin.lat) * EARTH_RADIUS_M,
    up: 0,
  };
}

export function fromEnu(origin: LatLng, enu: Pick<Enu, 'east' | 'north'>): LatLng {
  return {
    lat: origin.lat + toDeg(enu.north / EARTH_RADIUS_M),
    lng: origin.lng + toDeg(enu.east / (EARTH_RADIUS_M * Math.cos(toRad(origin.lat)))),
  };
}

export function normalizeDeg(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

// Signed smallest difference a - b, in (-180, 180].
export function angleDiffDeg(a: number, b: number): number {
  const d = normalizeDeg(a - b);
  return d > 180 ? d - 360 : d;
}
