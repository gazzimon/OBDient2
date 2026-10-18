import type { LatLng } from '@/domain/geo/geo';
import { NavigationTools } from '@/domain/navigation/navigation-tools';
import { findByText, findNearby } from '@/domain/navigation/places';
import type { GeocodingPort, Place, Route, SearchOptions } from '@/domain/navigation/route';
import type { NavStatus } from '@/store/navStore';
import type { RouteProgress } from '@/domain/navigation/route-progress';
import { parseToolCall } from '@/domain/assistant/tools';

const OBELISCO: LatLng = { lat: -34.6037, lng: -58.3816 };
const at = (dLatKm: number): LatLng => ({ lat: OBELISCO.lat + dLatKm / 111, lng: OBELISCO.lng });
const place = (name: string, km: number): Place => ({ name, detail: 'CABA', location: at(km) });

// A geocoder answering per search term; records the boxes it was asked for.
function geocoder(byTerm: Record<string, Place[]>) {
  const boxes: (readonly number[])[] = [];
  const g: GeocodingPort = {
    search: async (q: string, _near: LatLng | null, _s?: AbortSignal, o?: SearchOptions) => {
      if (o?.bbox) boxes.push(o.bbox);
      const inBox = (p: Place) => !o?.bbox || (p.location.lat >= o.bbox[1] && p.location.lat <= o.bbox[3]);
      return (byTerm[q] ?? []).filter(inBox);
    },
  };
  return { g, boxes };
}

describe('places', () => {
  it('nearest of a category: by brand inside a box, merged, deduped, nearest first', async () => {
    const { g } = geocoder({
      YPF: [place('YPF', 2.2), place('YPF', 3.0)],
      Shell: [place('Shell', 1.6), place('Shell', 1.6)],
      Axion: [place('Axion', 1.5)],
    });
    const r = await findNearby(g, 'fuel', OBELISCO);
    expect(r.map((p) => `${p.name} ${p.distanceKm}`)).toEqual(['Axion 1.5', 'Shell 1.6', 'YPF 2.2', 'YPF 3']);
  });

  it('few places near: the box grows', async () => {
    const { g, boxes } = geocoder({ farmacia: [place('Farmacia', 12)] });
    const r = await findNearby(g, 'pharmacy', OBELISCO);
    expect(r.map((p) => p.name)).toEqual(['Farmacia']);
    expect(boxes.length).toBe(2);
  });

  it('free text: near results first, a far namesake last', async () => {
    const { g } = geocoder({ 'Plaza Italia': [place('Plaza Italia (Mendoza)', 900), place('Plaza Italia', 4)] });
    const r = await findByText(g, 'Plaza Italia', OBELISCO);
    expect(r.map((p) => p.name)).toEqual(['Plaza Italia', 'Plaza Italia (Mendoza)']);
  });
});

describe('NavigationTools', () => {
  const route: Route = { geometry: [OBELISCO, at(1.5)], cumulativeM: [0, 1500], distanceM: 1500, durationS: 360, maneuvers: [] };

  function tools(opts: { routeFails?: boolean } = {}) {
    const state = {
      status: 'idle' as NavStatus,
      destination: null as Place | null,
      route: null as Route | null,
      progress: null as RouteProgress | null,
      error: null as string | null,
    };
    const calls: string[] = [];
    const { g } = geocoder({ YPF: [place('YPF', 2.2)], Shell: [place('Shell', 1.6)], Axion: [place('Axion', 1.5)] });
    const t = new NavigationTools({
      geocoder: () => g,
      position: async () => OBELISCO,
      planTo: async (p) => {
        calls.push(`plan ${p.name}`);
        Object.assign(state, opts.routeFails ? { status: 'error', error: 'Sin conexión' } : { status: 'ready', destination: p, route });
      },
      start: async () => {
        calls.push('start');
        state.status = 'navigating';
      },
      stop: () => {
        calls.push('stop');
        Object.assign(state, { status: 'idle', route: null, destination: null });
      },
      openDrive: () => calls.push('drive'),
      state: () => state,
      now: () => new Date(2026, 9, 18, 20, 0).getTime(),
    });
    return { t, state, calls };
  }
  const signal = new AbortController().signal;

  it('nearest fuel → navigate → how far → stop', async () => {
    const { t, state, calls } = tools();
    const found = await t.execute({ name: 'search_place', query: null, category: 'fuel' }, signal);
    expect(found).toMatchObject({ ok: true, data: { results: [{ result: 1, name: 'Axion', distanceKm: 1.5 }, {}, {}] } });

    const go = await t.execute({ name: 'set_destination', result: 1 }, signal);
    expect(go).toEqual({
      ok: true,
      data: { destination: 'Axion', detail: 'CABA', distanceKm: 1.5, durationMin: 6, arrival: '20:06' },
      summary: 'Navegando a Axion',
    });
    expect(calls).toEqual(['plan Axion', 'start', 'drive']);

    state.progress = { remainingM: 750, offRoute: false, nextManeuver: null, distanceToManeuverM: null } as unknown as RouteProgress;
    expect(await t.execute({ name: 'route_status' }, signal)).toMatchObject({
      ok: true,
      data: { navigating: true, destination: 'Axion', remainingKm: 0.8, remainingMin: 3, arrival: '20:03' },
    });

    expect(await t.execute({ name: 'stop_navigation' }, signal)).toMatchObject({ ok: true, data: { stopped: true } });
    expect(await t.execute({ name: 'route_status' }, signal)).toMatchObject({ ok: true, data: { navigating: false } });
  });

  it('set_destination without a search, or a route that fails, says why', async () => {
    const fresh = tools();
    expect(await fresh.t.execute({ name: 'set_destination', result: 1 }, signal)).toMatchObject({ ok: false, error: 'invalid_arguments' });

    const broken = tools({ routeFails: true });
    await broken.t.execute({ name: 'search_place', query: null, category: 'fuel' }, signal);
    expect(await broken.t.execute({ name: 'set_destination', result: 1 }, signal)).toEqual({
      ok: false,
      error: 'not_supported',
      message: 'Sin conexión',
    });
    expect(broken.calls).not.toContain('drive');
  });

  it('the model must give a query or a category, and a valid one', () => {
    expect(parseToolCall('search_place', '{}', [])).toMatchObject({ ok: false, error: 'invalid_arguments' });
    expect(parseToolCall('search_place', '{"category":"pizza"}', [])).toMatchObject({ ok: false });
    expect(parseToolCall('search_place', '{"query":"Obelisco"}', [])).toMatchObject({ ok: true, call: { query: 'Obelisco', category: null } });
    expect(parseToolCall('set_destination', '{"result":9}', [])).toMatchObject({ ok: false });
  });
});
