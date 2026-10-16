// Where the route goes, relative to where the car points — the arrow every
// GPS shows. It works when the AR ribbon cannot be drawn (route behind the
// camera, parked across the street, pose not settled yet), so the driver is
// never left without a direction.

import { angleDiffDeg, bearingDeg, distanceM, type LatLng } from '@/domain/geo/geo';
import { routeSlice, type RouteProgress } from './route-progress';
import type { Route } from './route';

export interface HeadingGuide {
  // Turn needed to face the route ahead, degrees: negative = left, positive = right.
  readonly relativeDeg: number;
  // Straight-line distance to the aim point, metres.
  readonly distanceM: number;
}

// Aim at a point `lookAheadM` along the route from the car's projection on it.
// Far enough that GPS jitter does not spin the arrow, close enough to follow
// the next bend. When the car is off the road (car park, other side), the aim
// point is simply where the road is — the arrow leads back to it.
export function headingGuide(
  route: Route,
  progress: RouteProgress,
  position: LatLng,
  headingDeg: number,
  lookAheadM = 30,
): HeadingGuide | null {
  const ahead = routeSlice(route, progress.offsetM, lookAheadM);
  const aim = ahead[ahead.length - 1];
  if (!aim) return null;
  const d = distanceM(position, aim);
  if (d < 1) return null;
  return { relativeDeg: angleDiffDeg(bearingDeg(position, aim), headingDeg), distanceM: d };
}

// Why the AR ribbon is not on screen, in the order a person would fix it.
export type ArBlocker = 'gps' | 'imu' | 'heading' | 'route' | 'out-of-view' | null;

export function arBlocker(state: {
  hasPosition: boolean;
  hasPose: boolean;
  headingValid: boolean;
  hasProgress: boolean;
  ribbonVisible: boolean;
}): ArBlocker {
  if (!state.hasPosition) return 'gps';
  if (!state.hasPose) return 'imu';
  if (!state.headingValid) return 'heading';
  if (!state.hasProgress) return 'route';
  if (!state.ribbonVisible) return 'out-of-view';
  return null;
}

export const AR_BLOCKER_ES: Record<Exclude<ArBlocker, null>, string> = {
  gps: 'Esperando señal GPS',
  imu: 'Sin sensor de movimiento: la ruta no se puede dibujar sobre la cámara',
  heading: 'Rumbo desconocido: avanza unos metros',
  route: 'Ubicando el vehículo en la ruta',
  'out-of-view': 'La ruta no está frente a la cámara: sigue la flecha',
};
