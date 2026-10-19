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
import { findMapLink, isShortLink, parseMapLink } from '@/domain/navigation/map-links';
import { findByText, withDistance, type FoundPlace } from '@/domain/navigation/places';
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
  // The map with the destination and its route, to check it is the right place.
  readonly openMap: () => void;
  readonly state: () => {
    status: NavStatus;
    destination: Place | null;
    route: Route | null;
    progress: RouteProgress | null;
    error: string | null;
  };
  // Follows a short link (maps.app.goo.gl) to the real one.
  readonly followLink?: (url: string, signal?: AbortSignal) => Promise<string>;
  readonly now?: () => number;
}

// A map link the app read before the model sees the message.
export type LinkResult =
  | { readonly ok: true; readonly name: string; readonly detail: string; readonly approximate: boolean; readonly distanceKm: number | null }
  | { readonly ok: false; readonly reason: string };

type NavCall = Extract<ToolCall, { name: 'search_place' | 'set_destination' | 'start_navigation' | 'route_status' | 'stop_navigation' }>;

export const NAVIGATION_TOOL_NAMES: ReadonlySet<ToolCall['name']> = new Set([
  'search_place',
  'set_destination',
  'start_navigation',
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
          return await this.show((call as Extract<NavCall, { name: 'set_destination' }>).result);
        case 'start_navigation':
          return await this.startGuidance();
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

  // The destination of a map link becomes result 1 of the last search, so the
  // usual set_destination → "¿es ahí?" → start_navigation follows.
  async loadLink(text: string, signal?: AbortSignal): Promise<LinkResult | null> {
    let url = findMapLink(text);
    if (!url) return null;
    try {
      if (isShortLink(url)) {
        if (!this.deps.followLink) return { ok: false, reason: 'no se pueden abrir enlaces cortos' };
        url = await this.deps.followLink(url, signal);
      }
      const link = parseMapLink(url);
      if (!link) return { ok: false, reason: 'el enlace no trae un lugar' };
      const near = await this.deps.position();
      if (link.location) {
        const place = withDistance({ name: link.name ?? 'Punto del enlace', detail: '', location: link.location }, near);
        this.results = [place];
        return { ok: true, name: place.name, detail: '', approximate: false, distanceKm: place.distanceKm };
      }
      const found = link.query ? await findByText(this.deps.geocoder(), link.query, near, signal) : [];
      const first = found[0];
      if (!first) return { ok: false, reason: `no encontré la dirección "${link.query ?? ''}"` };
      const named = { ...first, name: link.name ?? first.name, detail: [first.name, first.detail].filter(Boolean).join(', ') };
      this.results = [named, ...found.slice(1)];
      return { ok: true, name: named.name, detail: named.detail, approximate: true, distanceKm: named.distanceKm };
    } catch (err) {
      if (signal?.aborted) return { ok: false, reason: 'cancelado' };
      return { ok: false, reason: `sin respuesta (${err instanceof Error ? err.message : String(err)})` };
    }
  }

  private async search(call: Extract<NavCall, { name: 'search_place' }>, signal: AbortSignal): Promise<ToolOutcome> {
    const near = await this.deps.position();
    this.results = await findByText(this.deps.geocoder(), call.query, near, signal);
    const results = this.results.map((p, i) => ({ result: i + 1, name: p.name, detail: p.detail, distanceKm: p.distanceKm }));
    return {
      ok: true,
      data: { results },
      summary: results.length ? `${results.length} resultados para "${call.query}"` : `Sin resultados para "${call.query}"`,
    };
  }

  // Plan the route and show it on the map; guidance waits for the user's yes.
  private async show(n: number): Promise<ToolOutcome> {
    const place = this.results[n - 1];
    if (!place) return fail('invalid_arguments', 'No hay un resultado con ese número: buscá primero con search_place.');
    await this.deps.planTo(place);
    const s = this.deps.state();
    if (s.status !== 'ready' || !s.route) return fail('not_supported', s.error ?? 'No se pudo calcular la ruta.');
    this.deps.openMap();
    return {
      ok: true,
      data: {
        destination: place.name,
        detail: place.detail,
        distanceKm: km(s.route.distanceM),
        durationMin: Math.round(s.route.durationS / 60),
        arrival: this.clock(s.route.durationS),
        started: false,
      },
      summary: `En el mapa: ${place.name}`,
    };
  }

  private async startGuidance(): Promise<ToolOutcome> {
    const s = this.deps.state();
    if (s.status === 'navigating') return { ok: true, data: { started: true, already: true }, summary: 'Ya estaba navegando' };
    if (s.status !== 'ready' || !s.route) return fail('invalid_arguments', 'No hay un destino en el mapa: usá set_destination primero.');
    await this.deps.start();
    this.deps.openDrive();
    return { ok: true, data: { started: true, destination: s.destination?.name ?? null }, summary: 'Navegación iniciada' };
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
