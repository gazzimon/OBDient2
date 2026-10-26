import { parseToolCall } from '@/domain/assistant/tools';
import { NavigationTools, type FuelStation, type RemotePlaces } from '@/domain/navigation/navigation-tools';
import type { GeocodingPort } from '@/domain/navigation/route';
import { ServiceLog, type ServiceEntry } from '@/domain/service/service-log';
import { ServiceTools } from '@/data/service/service-tools';

const signal = new AbortController().signal;
const POSADAS = { lat: -27.3671, lng: -55.8961 };

describe('new tools: strict arguments', () => {
  it.each([
    ['fuel_prices', '{}', { name: 'fuel_prices', product: null }],
    ['fuel_prices', '{"product":"gnc"}', { name: 'fuel_prices', product: 'gnc' }],
    ['dollar_rate', '{}', { name: 'dollar_rate' }],
    ['weather', '{"place":"Oberá"}', { name: 'weather', place: 'Oberá' }],
    ['car_price', '{"query":"Onix 1.4 LTZ","year":2015}', { name: 'car_price', query: 'Onix 1.4 LTZ', year: 2015 }],
    ['log_service', '{"car":"Onix 2016","item":"cambio de aceite","km":45000}', { name: 'log_service', car: 'Onix 2016', item: 'cambio de aceite', km: 45000, note: null }],
    ['read_service_log', '{}', { name: 'read_service_log', car: null }],
  ])('%s %s', (name, args, call) => {
    expect(parseToolCall(name, args, [])).toEqual({ ok: true, call });
  });
  it.each([
    ['fuel_prices', '{"product":"kerosene"}'],
    ['car_price', '{"query":"Onix","year":"2015"}'],
    ['log_service', '{"item":"aceite"}'], // no car: it must be confirmed
    ['log_service', '{"car":"Onix","item":"aceite","km":-5}'],
    ['dollar_rate', '{"x":1}'],
  ])('%s %s is refused', (name, args) => {
    expect(parseToolCall(name, args, []).ok).toBe(false);
  });
});

describe('service log', () => {
  function tools(vin: string | null = null) {
    let entries: ServiceEntry[] = [];
    let t = Date.parse('2026-10-19T15:00:00Z');
    let n = 0;
    const log = new ServiceLog({ load: () => entries, save: (e) => (entries = [...e]) });
    return { tools: new ServiceTools({ log, vin: () => vin, now: () => (t += 86_400_000), newId: () => `s${n++}` }), entries: () => entries };
  }

  it('writes with the confirmed car and the VIN the adapter knew', () => {
    const t = tools('8AGEA76C0RR000099');
    const r = t.tools.execute({ name: 'log_service', car: 'Chevrolet Onix 2016', item: 'Cambio de aceite', km: 45000, note: null });
    expect(r).toMatchObject({ ok: true, data: { saved: { car: 'Chevrolet Onix 2016', vin: '8AGEA76C0RR000099', km: 45000, date: '2026-10-20' } } });
    expect(t.entries()).toHaveLength(1);
  });

  it('reads newest first, by car words, and lists the cars it knows', () => {
    const t = tools();
    t.tools.execute({ name: 'log_service', car: 'Chevrolet Onix 2016', item: 'aceite', km: 45000, note: null });
    t.tools.execute({ name: 'log_service', car: 'VW Gol Trend', item: 'frenos', km: null, note: 'pastillas' });
    t.tools.execute({ name: 'log_service', car: 'chevrolet onix 2016', item: 'filtro de aire', km: 46000, note: null });
    const all = t.tools.execute({ name: 'read_service_log', car: null });
    expect(all.ok && (all.data as { cars: string[] }).cars).toEqual(['chevrolet onix 2016', 'VW Gol Trend']);
    const onix = t.tools.execute({ name: 'read_service_log', car: 'onix' });
    expect(onix.ok && (onix.data as { entries: { item: string }[] }).entries.map((e) => e.item)).toEqual(['filtro de aire', 'aceite']);
  });
});

describe('fuel and weather through NavigationTools', () => {
  const station = (brand: string, km: number, price?: number): FuelStation => ({
    brand,
    company: 'x',
    address: `${brand} 1`,
    town: 'Posadas',
    distanceKm: km,
    location: { lat: -27.36 - km / 100, lng: -55.89 },
    prices: price ? { nafta: { price, daysOld: 3 } } : {},
  });
  function nav(remote: RemotePlaces, geocoder: GeocodingPort = { search: async () => [] }) {
    const state = { status: 'idle' as const, destination: null, route: null, progress: null, error: null };
    const planned: string[] = [];
    const t = new NavigationTools({
      geocoder: () => geocoder,
      position: async () => POSADAS,
      planTo: async (p) => {
        planned.push(p.name);
      },
      start: async () => undefined,
      stop: () => undefined,
      openDrive: () => undefined,
      state: () => state,
      remote,
    });
    return { t, planned };
  }

  it('stations are numbered results; the cheapest is added if it was not among the nearest', async () => {
    const cheapest = station('Puma', 6, 2200);
    const { t, planned } = nav({
      fuel: async () => ({ ok: true, data: { nearest: [station('YPF', 0.1), station('Axion', 0.2, 2359)], cheapest, updated: 'hoy' } }),
      weather: async () => ({ ok: true, data: {} }),
    });
    const r = await t.execute({ name: 'fuel_prices', product: 'nafta' }, signal);
    expect(r).toMatchObject({ ok: true, data: { cheapest: 3, dataUpdated: 'hoy' } });
    expect(r.ok && (r.data as { stations: { result: number; brand: string }[] }).stations.map((s) => `${s.result} ${s.brand}`)).toEqual(['1 YPF', '2 Axion', '3 Puma']);
    await t.execute({ name: 'set_destination', result: 3 }, signal);
    expect(planned).toEqual(['Puma, Puma 1']);
  });

  it('server down: the reason reaches the model', async () => {
    const { t } = nav({
      fuel: async () => ({ ok: false, error: 'timeout', message: 'Sin conexión' }),
      weather: async () => ({ ok: false, error: 'timeout', message: 'Sin conexión' }),
    });
    expect(await t.execute({ name: 'fuel_prices', product: null }, signal)).toEqual({ ok: false, error: 'timeout', message: 'Sin conexión' });
  });

  it('weather here, or at a named town', async () => {
    const asked: { lat: number; lng: number }[] = [];
    const OBERA = { lat: -27.48, lng: -55.12 };
    const { t } = nav(
      { fuel: async () => ({ ok: false, error: 'timeout', message: '' }), weather: async (at) => (asked.push(at), { ok: true, data: { now: { sky: 'lluvia' } } }) },
      { search: async () => [{ name: 'Oberá', detail: 'Misiones', location: OBERA }] },
    );
    expect(await t.execute({ name: 'weather', place: null }, signal)).toMatchObject({ ok: true, data: { place: 'donde está el auto', now: { sky: 'lluvia' } } });
    expect(await t.execute({ name: 'weather', place: 'Oberá' }, signal)).toMatchObject({ ok: true, data: { place: 'Oberá, Misiones' } });
    expect(asked).toEqual([POSADAS, OBERA]);
  });
});
