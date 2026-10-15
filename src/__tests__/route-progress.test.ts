import { destination, distanceM, type LatLng } from '@/domain/geo/geo';
import { RouteTracker, cumulativeDistances, routeSlice } from '@/domain/navigation/route-progress';
import type { Maneuver, Route } from '@/domain/navigation/route';

const A = { lat: -34.6037, lng: -58.3816 };

// L-shaped route: 300 m north, then 200 m east.
function lRoute(): Route {
  const corner = destination(A, 0, 300);
  const end = destination(corner, 90, 200);
  const geometry = [A, destination(A, 0, 150), corner, destination(corner, 90, 100), end];
  const cumulativeM = cumulativeDistances(geometry);
  const m = (type: Maneuver['type'], location: LatLng, routeOffsetM: number): Maneuver => ({
    type,
    modifier: type === 'turn' ? 'right' : null,
    location,
    roadName: '',
    exit: null,
    routeOffsetM,
  });
  return {
    geometry,
    cumulativeM,
    distanceM: cumulativeM[cumulativeM.length - 1]!,
    durationS: 60,
    maneuvers: [m('depart', A, 0), m('turn', corner, 300), m('arrive', end, 500)],
  };
}

describe('RouteTracker', () => {
  it('snaps a fix beside the road and measures progress', () => {
    const t = new RouteTracker(lRoute());
    const fix = destination(destination(A, 0, 100), 90, 5); // 100 m along, 5 m east
    const p = t.update(fix, 0, 0);
    expect(p.offsetM).toBeCloseTo(100, 0);
    expect(p.crossTrackM).toBeCloseTo(5, 0);
    expect(p.remainingM).toBeCloseTo(400, 0);
    expect(p.nextManeuver?.type).toBe('turn');
    expect(p.distanceToManeuverM).toBeCloseTo(200, 0);
    expect(p.offRoute).toBe(false);
  });

  it('needs the car to stay off the route for a while before calling it', () => {
    const t = new RouteTracker(lRoute());
    const far = destination(destination(A, 0, 100), 270, 80);
    expect(t.update(far, 0, 0).offRoute).toBe(false);
    expect(t.update(far, 0, 3000).offRoute).toBe(false);
    expect(t.update(far, 0, 4000).offRoute).toBe(true);
    // Back on the road clears it.
    expect(t.update(destination(A, 0, 110), 0, 4100).offRoute).toBe(false);
  });

  it('widens the off-route band by the GPS accuracy', () => {
    const t = new RouteTracker(lRoute());
    const fix = destination(destination(A, 0, 100), 270, 50);
    for (let t0 = 0; t0 <= 10_000; t0 += 1000) expect(t.update(fix, 30, t0).offRoute).toBe(false);
  });

  it('detects arrival', () => {
    const r = lRoute();
    const t = new RouteTracker(r);
    expect(t.update(r.geometry[r.geometry.length - 1]!, 0, 0).arrived).toBe(true);
  });
});

describe('routeSlice', () => {
  it('starts at the offset and follows the corner', () => {
    const r = lRoute();
    const slice = routeSlice(r, 250, 100);
    expect(distanceM(slice[0]!, destination(A, 0, 250))).toBeLessThan(0.5);
    const total = slice.slice(1).reduce((acc, p, i) => acc + distanceM(slice[i]!, p), 0);
    expect(total).toBeCloseTo(100, 0);
  });
});
