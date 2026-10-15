import { OsrmRouting, RoutingError, parseOsrm } from '@/data/routing/osrm-routing';

const body = {
  code: 'Ok',
  routes: [
    {
      distance: 520,
      duration: 75,
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [-58.3816, -34.6037],
          [-58.3816, -34.6010],
          [-58.3794, -34.6010],
        ] as [number, number][],
      },
      legs: [
        {
          steps: [
            { distance: 300, name: 'Av. 9 de Julio', maneuver: { type: 'depart', location: [-58.3816, -34.6037] as [number, number] } },
            { distance: 200, name: 'Av. Corrientes', maneuver: { type: 'turn', modifier: 'right', location: [-58.3816, -34.601] as [number, number] } },
            { distance: 0, name: '', maneuver: { type: 'arrive', location: [-58.3794, -34.601] as [number, number] } },
          ],
        },
      ],
    },
  ],
};

describe('OSRM adapter', () => {
  it('maps geometry, maneuvers and offsets', () => {
    const r = parseOsrm(body);
    expect(r.geometry).toHaveLength(3);
    expect(r.geometry[0]).toEqual({ lat: -34.6037, lng: -58.3816 });
    expect(r.maneuvers.map((m) => m.type)).toEqual(['depart', 'turn', 'arrive']);
    expect(r.maneuvers[1]!.modifier).toBe('right');
    // Offsets are rescaled to the polyline length so progress and maneuvers agree.
    expect(r.maneuvers[2]!.routeOffsetM).toBeCloseTo(r.distanceM, 3);
  });

  it('reports NoRoute clearly', () => {
    expect(() => parseOsrm({ code: 'NoRoute' })).toThrow('No route between these points');
  });

  it('builds the request with lng,lat order and the departure bearing', async () => {
    let url = '';
    const routing = new OsrmRouting('https://osrm.example/', async (u) => {
      url = u;
      return { ok: true, status: 200, json: async () => body };
    });
    await routing.route({ origin: { lat: 1, lng: 2 }, destination: { lat: 3, lng: 4 }, headingDeg: 370 });
    expect(url).toContain('/route/v1/driving/2,1;4,3?');
    expect(url).toContain('bearings=10,60;');
  });

  it('wraps network failures', async () => {
    const routing = new OsrmRouting('https://osrm.example', async () => {
      throw new Error('offline');
    });
    await expect(routing.route({ origin: { lat: 1, lng: 2 }, destination: { lat: 3, lng: 4 } })).rejects.toBeInstanceOf(
      RoutingError,
    );
  });
});
