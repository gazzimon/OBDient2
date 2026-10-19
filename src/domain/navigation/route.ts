// A drivable route from origin to destination, as the guidance needs it.
// Provider-neutral: OSRM, Valhalla or anything else maps into this shape.

import type { LatLng } from '@/domain/geo/geo';

export type ManeuverType =
  | 'depart'
  | 'turn'
  | 'continue'
  | 'merge'
  | 'fork'
  | 'on-ramp'
  | 'off-ramp'
  | 'roundabout'
  | 'end-of-road'
  | 'arrive';

export type ManeuverModifier =
  | 'uturn'
  | 'sharp-right'
  | 'right'
  | 'slight-right'
  | 'straight'
  | 'slight-left'
  | 'left'
  | 'sharp-left';

export interface Maneuver {
  readonly type: ManeuverType;
  readonly modifier: ManeuverModifier | null;
  readonly location: LatLng;
  // Street the driver is on AFTER the maneuver (may be empty).
  readonly roadName: string;
  // Roundabout exit number, when the maneuver is a roundabout.
  readonly exit: number | null;
  // Distance along the route from its start to this maneuver, metres.
  readonly routeOffsetM: number;
}

export interface Route {
  readonly geometry: readonly LatLng[];
  // Cumulative distance at each geometry vertex; same length as geometry.
  readonly cumulativeM: readonly number[];
  readonly distanceM: number;
  readonly durationS: number;
  readonly maneuvers: readonly Maneuver[];
}

export interface RouteRequest {
  readonly origin: LatLng;
  readonly destination: LatLng;
  // Current heading, so the route does not start with a U-turn behind the car.
  readonly headingDeg?: number;
}

export interface RoutingPort {
  route(request: RouteRequest, signal?: AbortSignal): Promise<Route>;
}

export interface Place {
  readonly name: string;
  readonly detail: string;
  readonly location: LatLng;
  // A street's box [west, north, east, south], when the geocoder gives it:
  // two crossing streets' boxes meet at the corner.
  readonly bounds?: readonly [number, number, number, number];
}

export interface SearchOptions {
  // OpenStreetMap tag filter, e.g. "amenity:fuel".
  readonly osmTag?: string;
  // Only inside this box: [west, south, east, north].
  readonly bbox?: readonly [number, number, number, number];
  readonly limit?: number;
}

export interface GeocodingPort {
  search(query: string, near: LatLng | null, signal?: AbortSignal, options?: SearchOptions): Promise<Place[]>;
}
