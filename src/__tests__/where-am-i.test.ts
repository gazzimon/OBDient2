import { NavigationTools } from '@/domain/navigation/navigation-tools';
import type { GeocodingPort, Whereabouts } from '@/domain/navigation/route';
import { stateBlock } from '@/domain/assistant/prompt';

const POSADAS = { lat: -27.3671, lng: -55.8961 };
const HERE: Whereabouts = { street: 'San Lorenzo 1836', city: 'Posadas', state: 'Misiones' };

function tools(opts: { position?: { lat: number; lng: number } | null; reverse?: () => Promise<Whereabouts | null> } = {}) {
  let calls = 0;
  let t = 0;
  let pos = opts.position === undefined ? POSADAS : opts.position;
  const geocoder: GeocodingPort = {
    search: async () => [],
    reverse: async () => {
      calls++;
      return opts.reverse ? opts.reverse() : HERE;
    },
  };
  const state = { status: 'idle' as const, destination: null, route: null, progress: null, error: null };
  const nav = new NavigationTools({
    geocoder: () => geocoder,
    position: async () => pos,
    planTo: async () => undefined,
    start: async () => undefined,
    stop: () => undefined,
    openDrive: () => undefined,
    state: () => state,
    now: () => t,
  });
  return {
    nav,
    calls: () => calls,
    advance: (ms: number) => (t += ms),
    move: (p: { lat: number; lng: number }) => (pos = p),
  };
}
const signal = new AbortController().signal;

describe('where am I', () => {
  it('street and town from the GPS', async () => {
    const { nav } = tools();
    expect(await nav.execute({ name: 'where_am_i' }, signal)).toMatchObject({
      ok: true,
      data: HERE,
      summary: 'San Lorenzo 1836, Posadas, Misiones',
    });
  });

  it('says so without GPS', async () => {
    const { nav } = tools({ position: null });
    expect(await nav.execute({ name: 'where_am_i' }, signal)).toMatchObject({ ok: false });
  });

  it('the town is cached until the car moves away or time passes', async () => {
    const t = tools();
    expect(await t.nav.locality()).toBe('Posadas, Misiones');
    expect(await t.nav.locality()).toBe('Posadas, Misiones');
    expect(t.calls()).toBe(1);
    t.move({ lat: -27.45, lng: -55.9 }); // ~9 km
    await t.nav.locality();
    expect(t.calls()).toBe(2);
    t.advance(11 * 60_000);
    await t.nav.locality();
    expect(t.calls()).toBe(3);
    expect(t.nav.lastLocality()).toBe('Posadas, Misiones');
  });

  it('offline keeps the last town, never throws', async () => {
    let fail = false;
    const t = tools({ reverse: async () => (fail ? Promise.reject(new Error('offline')) : HERE) });
    await t.nav.locality();
    fail = true;
    t.advance(11 * 60_000);
    expect(await t.nav.locality()).toBe('Posadas, Misiones');
  });

  it('the town goes in the state block, never the street', () => {
    const block = stateBlock({ connected: false, protocol: null, supportedPids: 0, moving: false, speedKmh: null, navigating: false, place: 'Posadas, Misiones' });
    expect(block).toBe('[estado: adaptador desconectado · auto detenido · sin navegación · en Posadas, Misiones]');
  });
});
