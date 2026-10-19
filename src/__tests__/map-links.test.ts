import { findMapLink, isShortLink, parseMapLink } from '@/domain/navigation/map-links';
import { NavigationTools } from '@/domain/navigation/navigation-tools';
import type { GeocodingPort, Place } from '@/domain/navigation/route';
import { followLink } from '@/data/routing/follow-link';
import { asksForNotes, isSmallTalk } from '@/domain/assistant/phrase-router';
import { OfflineAssistant, SMALL_TALK_REPLY } from '@/domain/assistant/offline-assistant';

// The real link from the phone test (2026-10-18), after its redirect.
const SHARED_PLACE =
  'https://www.google.com/maps/place/Taller+aire+brys+y+mec%C3%A1nica+ligera,+entre+Andresito+y+una+cuadra+de+jaureche+ala+derecha+media,+C.+127,+N3300+Posadas,+Misiones/data=!4m2!3m1!1s0x9457bf4ea564b399:0xd5e7f05a198d0cef!18m1!1e1?utm_source=mstt_1&entry=gps';

describe('map links', () => {
  it('finds the link in a message', () => {
    expect(findMapLink('llevame acá https://maps.app.goo.gl/xrxgRAH8TYsoYBk76 porfa')).toBe('https://maps.app.goo.gl/xrxgRAH8TYsoYBk76');
    expect(findMapLink('(https://www.google.com/maps/@-34.6,-58.4,15z).')).toBe('https://www.google.com/maps/@-34.6,-58.4,15z');
    expect(findMapLink('geo:-34.6037,-58.3816?z=17')).toBe('geo:-34.6037,-58.3816?z=17');
    expect(findMapLink('https://waze.com/ul?ll=-34.6,-58.38&navigate=yes')).toContain('waze.com/ul');
    expect(findMapLink('https://www.google.com/search?q=mapa')).toBeNull();
    expect(findMapLink('Uruguay 1223')).toBeNull();
    expect(isShortLink('https://maps.app.goo.gl/x')).toBe(true);
  });

  it('a shared place without a pin: its name, and its address to search', () => {
    expect(parseMapLink(SHARED_PLACE)).toEqual({
      location: null,
      name: 'Taller aire brys y mecánica ligera',
      query: 'Calle 127, Posadas, Misiones',
    });
  });

  it('the pin wins over the map center', () => {
    const url = 'https://www.google.com/maps/place/YPF/@-34.60,-58.40,15z/data=!3m1!4b1!4m6!3m5!3d-34.6037!4d-58.3816';
    expect(parseMapLink(url)).toEqual({ location: { lat: -34.6037, lng: -58.3816 }, name: 'YPF', query: null });
  });

  it('coordinates in q=, geo: and waze ll=', () => {
    expect(parseMapLink('https://maps.google.com/?q=-27.367,-55.896')?.location).toEqual({ lat: -27.367, lng: -55.896 });
    expect(parseMapLink('geo:-27.367,-55.896')?.location).toEqual({ lat: -27.367, lng: -55.896 });
    expect(parseMapLink('https://waze.com/ul?ll=-27.367,-55.896&navigate=yes')?.location).toEqual({ lat: -27.367, lng: -55.896 });
  });

  it('a text query becomes the search', () => {
    expect(parseMapLink('https://www.google.com/maps/search/?api=1&query=Uruguay+1223')).toEqual({ location: null, name: 'Uruguay 1223', query: 'Uruguay 1223' });
  });

  it('nothing usable is null', () => {
    expect(parseMapLink('https://www.google.com/maps')).toBeNull();
  });
});

describe('follow link', () => {
  it('returns where the short link lands, HEAD first', async () => {
    const methods: string[] = [];
    const url = await followLink('https://maps.app.goo.gl/x', undefined, async (_u, init) => {
      methods.push(init?.method ?? '');
      return { ok: true, status: 200, url: SHARED_PLACE };
    });
    expect(url).toBe(SHARED_PLACE);
    expect(methods).toEqual(['HEAD']);
  });
  it('tries GET when HEAD does not move', async () => {
    const methods: string[] = [];
    const url = await followLink('https://maps.app.goo.gl/x', undefined, async (u, init) => {
      methods.push(init?.method ?? '');
      return { ok: true, status: 200, url: init?.method === 'GET' ? SHARED_PLACE : u };
    });
    expect(url).toBe(SHARED_PLACE);
    expect(methods).toEqual(['HEAD', 'GET']);
  });
});

describe('NavigationTools.loadLink', () => {
  const POSADAS = { lat: -27.367, lng: -55.896 };
  const calle127: Place = { name: 'Calle 127', detail: 'Posadas, Misiones, Argentina', location: { lat: -27.38, lng: -55.939 } };
  function tools(found: Place[], follow = async () => SHARED_PLACE) {
    const queries: string[] = [];
    const geocoder: GeocodingPort = {
      search: async (q) => {
        queries.push(q);
        return found;
      },
    };
    const state = { status: 'idle' as const, destination: null, route: null, progress: null, error: null };
    const t = new NavigationTools({
      geocoder: () => geocoder,
      position: async () => POSADAS,
      planTo: async () => undefined,
      start: async () => undefined,
      stop: () => undefined,
      openDrive: () => undefined,
      state: () => state,
      followLink: follow,
    });
    return { t, queries };
  }

  it('the shared place: name from the link, address searched, approximate, result 1', async () => {
    const { t, queries } = tools([calle127]);
    const r = await t.loadLink('https://maps.app.goo.gl/xrxgRAH8TYsoYBk76');
    expect(queries).toEqual(['Calle 127, Posadas, Misiones']);
    expect(r).toMatchObject({ ok: true, name: 'Taller aire brys y mecánica ligera', approximate: true });
    expect(r?.ok && r.detail).toContain('Calle 127');
    // set_destination 1 now picks it (the route planning is faked).
    const shown = await t.execute({ name: 'set_destination', result: 1 }, new AbortController().signal);
    expect(shown.ok || (!shown.ok && shown.error !== 'invalid_arguments')).toBe(true);
  });

  it('a link with the pin is exact, without searching', async () => {
    const { t, queries } = tools([], async () => 'https://www.google.com/maps/place/YPF/data=!3d-27.37!4d-55.9');
    const r = await t.loadLink('mirá https://maps.app.goo.gl/abc');
    expect(r).toMatchObject({ ok: true, name: 'YPF', approximate: false });
    expect(queries).toEqual([]);
  });

  it('no link is null; a link that cannot be followed says why', async () => {
    const { t } = tools([], async () => {
      throw new Error('Network request failed');
    });
    expect(await t.loadLink('Uruguay 1223')).toBeNull();
    expect(await t.loadLink('https://maps.app.goo.gl/abc')).toMatchObject({ ok: false });
  });

  it('an address the geocoder does not find', async () => {
    const { t } = tools([]);
    expect(await t.loadLink('https://maps.app.goo.gl/abc')).toMatchObject({ ok: false, reason: expect.stringContaining('Calle 127') });
  });
});

describe('notes phrases', () => {
  it.each(['Leé las notas', 'pasale las notas al asistente', '¿podés revisar las notas?', 'mandá la nota'])('"%s" asks for the notes', (t) => {
    expect(asksForNotes(t)).toBe(true);
  });
  it.each(['tomá nota de esto', 'las notas del service'])('"%s" does not', (t) => {
    expect(asksForNotes(t)).toBe(false);
  });
  it.each(['Hola', '¡Buenas tardes!', 'gracias', 'ok dale'])('"%s" is small talk', (t) => {
    expect(isSmallTalk(t)).toBe(true);
  });
  it.each(['hola, no arranca el auto', 'no', 'desde ayer', 'siempre'])('"%s" is not', (t) => {
    expect(isSmallTalk(t)).toBe(false);
  });
  it('a greeting offline is answered and not noted', async () => {
    const a = new OfflineAssistant({ supportedPids: () => [], execute: async () => ({ ok: false, error: 'not_connected', message: '' }) });
    const ctx = { connected: false, protocol: null, supportedPids: 0, moving: false, speedKmh: null, navigating: false };
    expect(await a.handle({ id: 'n', at: 0, text: 'Hola', photos: 0 }, ctx)).toEqual({ kind: 'answer', intent: 'small_talk', text: SMALL_TALK_REPLY });
  });
});
