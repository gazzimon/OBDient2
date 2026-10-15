// RoutingPort over the OSRM HTTP API (v1).
//
// The public demo server (router.project-osrm.org) is for development only —
// its usage policy forbids production traffic. Distributed builds must point
// `baseUrl` at a self-hosted OSRM (e.g. on the Z440) or a commercial provider
// that speaks the same API. See docs/ADR/0003.

import { cumulativeDistances } from '@/domain/navigation/route-progress';
import type {
  Maneuver,
  ManeuverModifier,
  ManeuverType,
  Route,
  RouteRequest,
  RoutingPort,
} from '@/domain/navigation/route';

export class RoutingError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'RoutingError';
  }
}

interface OsrmStep {
  distance: number;
  name: string;
  maneuver: {
    type: string;
    modifier?: string;
    location: [number, number];
    exit?: number;
  };
}

interface OsrmResponse {
  code: string;
  message?: string;
  routes?: {
    distance: number;
    duration: number;
    geometry: { type: 'LineString'; coordinates: [number, number][] };
    legs: { steps: OsrmStep[] }[];
  }[];
}

type Fetch = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export class OsrmRouting implements RoutingPort {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchFn: Fetch = fetch,
  ) {}

  async route(req: RouteRequest, signal?: AbortSignal): Promise<Route> {
    const coords = `${req.origin.lng},${req.origin.lat};${req.destination.lng},${req.destination.lat}`;
    const params = ['overview=full', 'geometries=geojson', 'steps=true', 'alternatives=false'];
    if (req.headingDeg != null) {
      // Constrain the departure to the direction the car points (±60°).
      params.push(`bearings=${Math.round(req.headingDeg) % 360},60;`);
    }
    const url = `${this.baseUrl.replace(/\/$/, '')}/route/v1/driving/${coords}?${params.join('&')}`;

    let body: OsrmResponse;
    try {
      const res = await this.fetchFn(url, signal ? { signal } : undefined);
      body = (await res.json()) as OsrmResponse;
      if (!res.ok && !body.code) throw new RoutingError(`HTTP ${res.status}`);
    } catch (err) {
      if (err instanceof RoutingError) throw err;
      throw new RoutingError('Routing service unreachable', err);
    }
    return parseOsrm(body);
  }
}

export function parseOsrm(body: OsrmResponse): Route {
  if (body.code !== 'Ok' || !body.routes?.length) {
    throw new RoutingError(body.code === 'NoRoute' ? 'No route between these points' : body.message ?? body.code);
  }
  const r = body.routes[0]!;
  const geometry = r.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
  if (geometry.length < 2) throw new RoutingError('Route geometry too short');
  const cumulativeM = cumulativeDistances(geometry);

  const maneuvers: Maneuver[] = [];
  let offset = 0;
  for (const step of r.legs.flatMap((l) => l.steps)) {
    const [lng, lat] = step.maneuver.location;
    maneuvers.push({
      type: mapType(step.maneuver.type),
      modifier: mapModifier(step.maneuver.modifier),
      location: { lat, lng },
      roadName: step.name ?? '',
      exit: step.maneuver.exit ?? null,
      routeOffsetM: offset,
    });
    offset += step.distance;
  }

  // OSRM step distances and the polyline length differ by a few metres; the
  // polyline is what progress is measured on, so it defines the total.
  const total = cumulativeM[cumulativeM.length - 1]!;
  const k = offset > 0 ? total / offset : 1;
  return {
    geometry,
    cumulativeM,
    distanceM: total,
    durationS: r.duration,
    maneuvers: maneuvers.map((m) => ({ ...m, routeOffsetM: m.routeOffsetM * k })),
  };
}

function mapType(t: string): ManeuverType {
  switch (t) {
    case 'depart':
    case 'arrive':
    case 'turn':
    case 'merge':
    case 'fork':
    case 'roundabout':
      return t;
    case 'rotary':
    case 'roundabout turn':
    case 'exit roundabout':
    case 'exit rotary':
      return 'roundabout';
    case 'on ramp':
      return 'on-ramp';
    case 'off ramp':
      return 'off-ramp';
    case 'end of road':
      return 'end-of-road';
    default: // 'continue', 'new name', 'notification', 'use lane'
      return 'continue';
  }
}

function mapModifier(m: string | undefined): ManeuverModifier | null {
  switch (m) {
    case 'uturn':
    case 'right':
    case 'straight':
    case 'left':
      return m;
    case 'sharp right':
      return 'sharp-right';
    case 'slight right':
      return 'slight-right';
    case 'slight left':
      return 'slight-left';
    case 'sharp left':
      return 'sharp-left';
    default:
      return null;
  }
}
