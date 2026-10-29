import { intentAnswer } from '@/domain/assistant/offline';
import { routePhrase } from '@/domain/assistant/phrase-router';
import { parseToolCall } from '@/domain/assistant/tools';
import { destination as move } from '@/domain/geo/geo';
import { NavigationTools, type NavigationToolDeps } from '@/domain/navigation/navigation-tools';
import type { Place } from '@/domain/navigation/route';
import { ago, bestFix, describeSpot, ParkingLog, type ParkingSpot } from '@/domain/parking/parking';

const AT = 1_800_000_000_000;
const CAR = { lat: -27.3671, lng: -55.8961 };
const spot = (over: Partial<ParkingSpot> = {}): ParkingSpot => ({ ...CAR, accuracyM: 12, at: AT, fixAt: AT, vin: 'V1', car: 'Chevrolet 2024', reason: 'lost', ...over });

describe('parking: the fix', () => {
  it('a recent precise fix wins; old or vague ones are not a parking spot', () => {
    const recentVague = { ...CAR, accuracyM: 60, at: AT - 30_000 };
    const recentGood = { ...CAR, accuracyM: 8, at: AT + 5_000 };
    expect(bestFix([recentVague, recentGood, null], AT)).toBe(recentGood);
    expect(bestFix([{ ...CAR, accuracyM: 8, at: AT - 11 * 60_000 }], AT)).toBeNull();
    expect(bestFix([{ ...CAR, accuracyM: 900, at: AT }], AT)).toBeNull();
  });

  it('without a recent one, the closest in time', () => {
    const fiveMin = { ...CAR, accuracyM: 20, at: AT - 5 * 60_000 };
    const eightMin = { ...CAR, accuracyM: 5, at: AT - 8 * 60_000 };
    expect(bestFix([eightMin, fiveMin], AT)).toBe(fiveMin);
  });
});

describe('parking: the log', () => {
  it('one spot per car, newest first; "ya lo encontré" removes it', () => {
    let saved: ParkingSpot[] = [];
    const log = new ParkingLog({ load: () => saved, save: (s) => void (saved = [...s]) });
    log.save(spot({ vin: 'V1', at: AT }));
    log.save(spot({ vin: 'V2', at: AT + 1 }));
    log.save(spot({ vin: 'V1', at: AT + 2 }));
    expect(saved.map((s) => [s.vin, s.at])).toEqual([
      ['V1', AT + 2],
      ['V2', AT + 1],
    ]);
    expect(log.latest()?.at).toBe(AT + 2);
    expect(log.forVin('V2')?.at).toBe(AT + 1);
    log.remove(AT + 2);
    expect(log.latest()?.vin).toBe('V2');
  });
});

describe('parking: what it says', () => {
  it('how long ago, how far and which way', () => {
    const here = move(CAR, 225, 350); // the car is 350 m to the north-east of here
    expect(describeSpot(spot(), here, AT + 130 * 60_000)).toMatchObject({ ago: 'hace 2 h 10 min', where: 'a 350 m al noreste', near: false });
    expect(describeSpot(spot(), move(CAR, 0, 10), AT).where).toBe('acá cerca');
    expect(describeSpot(spot(), null, AT).where).toBeNull();
    expect(ago(30_000)).toBe('recién');
    expect(ago(26 * 3_600_000)).toBe('hace 1 día');
  });
});

describe('parking: the assistant', () => {
  it.each(['¿dónde estacioné?', 'donde deje el auto', '¿dónde quedó mi auto?', 'dónde lo estacionamos'])('"%s" → parked', (t) => {
    expect(routePhrase(t)).toBe('parked');
  });
  it.each(['¿dónde dejé las llaves?', 'busco un estacionamiento'])('does not take "%s"', (t) => {
    expect(routePhrase(t)).toBeNull();
  });

  const planned: Place[] = [];
  const deps = (parked: ParkingSpot | null): NavigationToolDeps => ({
    geocoder: () => ({ search: async () => [], reverse: async () => ({ street: 'Av. Mitre 1200', city: 'Posadas', state: 'Misiones' }) }),
    position: async () => move(CAR, 225, 350),
    planTo: async (p) => void planned.push(p),
    start: async () => undefined,
    stop: () => undefined,
    openDrive: () => undefined,
    state: () => ({ status: 'idle', destination: null, route: null, progress: null, error: null }),
    parked: () => parked,
    now: () => AT + 130 * 60_000,
  });
  const signal = new AbortController().signal;

  it('where_parked: the spot, the street, and result 1 to go there', async () => {
    expect(parseToolCall('where_parked', '{}', [])).toEqual({ ok: true, call: { name: 'where_parked' } });
    const tools = new NavigationTools(deps(spot()));
    const out = await tools.execute({ name: 'where_parked' }, signal);
    expect(out).toMatchObject({
      ok: true,
      data: { car: 'Chevrolet 2024', left: 'hace 2 h 10 min', where: 'a 350 m al noreste', distanceM: 350, address: 'Av. Mitre 1200, Posadas' },
      summary: 'a 350 m al noreste, hace 2 h 10 min',
    });
    expect(intentAnswer('parked', out)).toBe('Tu Chevrolet 2024 quedó a 350 m al noreste (Av. Mitre 1200, Posadas), hace 2 h 10 min. Lo ves en la pestaña Ruta, con la P.');
    await tools.execute({ name: 'set_destination', result: 1 }, signal);
    expect(planned).toEqual([expect.objectContaining({ name: 'Tu Chevrolet 2024', location: CAR })]);
  });

  it('where_parked without a saved spot says how it gets saved', async () => {
    const out = await new NavigationTools(deps(null)).execute({ name: 'where_parked' }, signal);
    expect(out).toMatchObject({ ok: false, error: 'not_supported' });
  });
});
