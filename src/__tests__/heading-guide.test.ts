import { destination } from '@/domain/geo/geo';
import { arBlocker, headingGuide } from '@/domain/navigation/heading-guide';
import { RouteTracker, cumulativeDistances } from '@/domain/navigation/route-progress';
import type { Route } from '@/domain/navigation/route';

const A = { lat: -34.6037, lng: -58.3816 };

function northRoute(): Route {
  const geometry = [A, destination(A, 0, 200)];
  const cumulativeM = cumulativeDistances(geometry);
  return { geometry, cumulativeM, distanceM: cumulativeM[1]!, durationS: 30, maneuvers: [] };
}

describe('headingGuide', () => {
  it('points straight ahead when the car faces along the road', () => {
    const r = northRoute();
    const p = new RouteTracker(r).update(A, 0, 0);
    expect(headingGuide(r, p, A, 0)!.relativeDeg).toBeCloseTo(0, 0);
  });

  it('says turn right when the road lies to the right', () => {
    const r = northRoute();
    const p = new RouteTracker(r).update(A, 0, 0);
    expect(headingGuide(r, p, A, 270)!.relativeDeg).toBeCloseTo(90, 0);
  });

  it('says turn around when the road is behind', () => {
    const r = northRoute();
    const p = new RouteTracker(r).update(A, 0, 0);
    expect(Math.abs(headingGuide(r, p, A, 180)!.relativeDeg)).toBeCloseTo(180, 0);
  });

  it('leads back to the road from a car park beside it', () => {
    const r = northRoute();
    const parked = destination(destination(A, 0, 50), 90, 40); // 40 m east of the road
    const p = new RouteTracker(r).update(parked, 0, 0);
    const g = headingGuide(r, p, parked, 0)!;
    expect(g.relativeDeg).toBeLessThan(-20); // road is to the left (west)
  });
});

describe('arBlocker', () => {
  const ok = { hasPosition: true, hasPose: true, headingValid: true, hasProgress: true, ribbonVisible: true };
  it('reports the first missing piece', () => {
    expect(arBlocker(ok)).toBeNull();
    expect(arBlocker({ ...ok, ribbonVisible: false })).toBe('out-of-view');
    expect(arBlocker({ ...ok, hasPose: false, ribbonVisible: false })).toBe('imu');
    expect(arBlocker({ ...ok, hasPosition: false })).toBe('gps');
  });
});
