// The assistant's navigation tools (search_place, set_destination,
// route_status, stop_navigation): "llevame a la estación de servicio más
// cercana", "¿cuánto falta?". They drive the same navigation the Ruta tab uses.
//
// Dependencies are injected so the logic is tested without a phone; the app
// instance (presentation/services/navigation-tools.ts) wires the real
// geocoder, GPS and navigation controller.

import type { LatLng } from '@/domain/geo/geo';
import type { ToolCall, ToolOutcome } from '@/domain/assistant/tools';
import { instructionEs } from '@/domain/navigation/guidance';
import { findByText, findNearby, PLACE_CATEGORIES, type FoundPlace } from '@/domain/navigation/places';
import type { GeocodingPort, Place, Route } from '@/domain/navigation/route';
import type { RouteProgress } from '@/domain/navigation/route-progress';
import type { NavStatus } from '@/store/navStore';

export interface NavigationToolDeps {
  readonly geocoder: () => GeocodingPort;
  readonly position: () => Promise<LatLng | null>;
  readonly planTo: (place: Place) => Promise<void>;
  readonly start: () => Promise<void>;
  readonly stop: () => void;
  // The driving view (AR), where guidance is shown.
  readonly openDrive: () => void;
  readonly state: () => {
    status: NavStatus;
    destination: Place | null;
    route: Route | null;
    progress: RouteProgress | null;
    error: string | null;
  };
  readonly now?: () => number;
}

type NavCall = Extract<ToolCall, { name: 'search_place' | 'set_destination' | 'route_status' | 'stop_navigation' }>;

export const NAVIGATION_TOOL_NAMES: ReadonlySet<ToolCall['name']> = new Set([
  'search_place',
  'set_destination',
  'route_status',
  'stop_navigation',
]);

export class NavigationTools {
  // The last search's results: set_destination picks one by number.
  private results: FoundPlace[] = [];

  constructor(private readonly deps: NavigationToolDeps) {}

  async execute(call: ToolCall, signal: AbortSignal): Promise<ToolOutcome> {
    try {
      switch ((call as NavCall).name) {
        case 'search_place':
          return await this.search(call as Extract<NavCall, { name: 'search_place' }>, signal);
        case 'set_destination':
          return await this.go((call as Extract<NavCall, { name: 'set_destination' }>).result);
        case 'route_status':
          return this.status();
        case 'stop_navigation':
          return this.stopNavigation();
        default:
          return fail('not_supported', 'No es una herramienta de navegación.');
      }
    } catch (err) {
      if (signal.aborted) return fail('cancelled', 'Cancelado.');
      // Geocoder or router unreachable (no signal, server down).
      return fail('timeout', `Sin respuesta del servicio de mapas: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async search(call: Extract<NavCall, { name: 'search_place' }>, signal: AbortSignal): Promise<ToolOutcome> {
    const near = await this.deps.position();
    if (call.category && !near) return fail('not_supported', 'Sin ubicación: no puedo buscar lo más cercano.');
    this.results = call.category
      ? await findNearby(this.deps.geocoder(), call.category, near!, signal)
      : await findByText(this.deps.geocoder(), call.query!, near, signal);
    const what = call.category ? PLACE_CATEGORIES[call.category].label : `"${call.query}"`;
    const results = this.results.map((p, i) => ({ result: i + 1, name: p.name, detail: p.detail, distanceKm: p.distanceKm }));
    return {
      ok: true,
      data: { results },
      summary: results.length ? `${results.length} resultados para ${what}` : `Sin resultados para ${what}`,
    };
  }

  private async go(n: number): Promise<ToolOutcome> {
    const place = this.results[n - 1];
    if (!place) return fail('invalid_arguments', 'No hay un resultado con ese número: buscá primero con search_place.');
    await this.deps.planTo(place);
    const s = this.deps.state();
    if (s.status !== 'ready' || !s.route) return fail('not_supported', s.error ?? 'No se pudo calcular la ruta.');
    await this.deps.start();
    this.deps.openDrive();
    const route = s.route;
    return {
      ok: true,
      data: {
        destination: place.name,
        detail: place.detail,
        distanceKm: km(route.distanceM),
        durationMin: Math.round(route.durationS / 60),
        arrival: this.clock(route.durationS),
      },
      summary: `Navegando a ${place.name}`,
    };
  }

  private status(): ToolOutcome {
    const s = this.deps.state();
    if (!s.route || s.status === 'idle' || s.status === 'error') {
      return { ok: true, data: { navigating: false }, summary: 'Sin navegación' };
    }
    const remainingM = s.progress?.remainingM ?? s.route.distanceM;
    // The router's time, scaled to what is left.
    const remainingS = s.route.distanceM > 0 ? (s.route.durationS * remainingM) / s.route.distanceM : 0;
    const next = s.progress?.nextManeuver;
    return {
      ok: true,
      data: {
        navigating: s.status === 'navigating',
        arrived: s.status === 'arrived',
        destination: s.destination?.name ?? null,
        remainingKm: km(remainingM),
        remainingMin: Math.round(remainingS / 60),
        arrival: this.clock(remainingS),
        offRoute: s.progress?.offRoute ?? false,
        next: next && s.progress?.distanceToManeuverM != null
          ? { instruction: instructionEs(next), inKm: km(s.progress.distanceToManeuverM) }
          : null,
      },
      summary: `Faltan ${km(remainingM)} km`,
    };
  }

  private stopNavigation(): ToolOutcome {
    if (this.deps.state().status === 'idle') return { ok: true, data: { stopped: false }, summary: 'No había navegación' };
    this.deps.stop();
    return { ok: true, data: { stopped: true }, summary: 'Navegación terminada' };
  }

  private clock(inSeconds: number): string {
    const t = new Date((this.deps.now ?? Date.now)() + inSeconds * 1000);
    return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  }
}

function km(m: number): number {
  return Math.round(m / 100) / 10;
}

function fail(error: Extract<ToolOutcome, { ok: false }>['error'], message: string): ToolOutcome {
  return { ok: false, error, message };
}
