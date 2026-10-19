// The driving map's camera (Modo manejo): tilted, the car fixed low on the
// screen, the map turning and moving under it. Pure numbers for DriveMap.

import type { Route } from './route';
import type { RouteProgress } from './route-progress';

export const DRIVE_PITCH = 60;
// Where the car sits, as a share of the map's height from the top.
export const CAR_AT = 0.72;

const NEAR = { kmh: 20, zoom: 17.6 };
const FAR = { kmh: 100, zoom: 15.8 };

// Closer in town, farther out on the road.
export function zoomForSpeed(kmh: number): number {
  if (!Number.isFinite(kmh) || kmh <= NEAR.kmh) return NEAR.zoom;
  if (kmh >= FAR.kmh) return FAR.zoom;
  const t = (kmh - NEAR.kmh) / (FAR.kmh - NEAR.kmh);
  return NEAR.zoom + t * (FAR.zoom - NEAR.zoom);
}

// Top padding that puts the map's centre (the car) at CAR_AT of the height.
export function carPadding(height: number): number {
  return Math.max(0, Math.round(height * (2 * CAR_AT - 1)));
}

// The part of the route still ahead: from the car's point on it to the end.
export function remainingPath(route: Route, progress: RouteProgress | null): [number, number][] {
  const all = route.geometry.map((p): [number, number] => [p.lng, p.lat]);
  if (!progress) return all;
  const ahead = all.slice(progress.segmentIndex + 1);
  return [[progress.snapped.lng, progress.snapped.lat], ...ahead];
}
