import { CAR_AT, carPadding, remainingPath, zoomForSpeed } from '@/domain/navigation/drive-camera';
import type { Route } from '@/domain/navigation/route';
import type { RouteProgress } from '@/domain/navigation/route-progress';

const route: Route = {
  geometry: [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 1 },
    { lat: 0, lng: 2 },
    { lat: 0, lng: 3 },
  ],
  cumulativeM: [0, 1, 2, 3],
  distanceM: 3,
  durationS: 3,
  maneuvers: [],
};

describe('zoomForSpeed', () => {
  it('is closest in town and farthest on the road', () => {
    expect(zoomForSpeed(0)).toBe(17.6);
    expect(zoomForSpeed(20)).toBe(17.6);
    expect(zoomForSpeed(140)).toBe(15.8);
    expect(zoomForSpeed(60)).toBeCloseTo(16.7);
  });

  it('treats a missing speed as stopped', () => {
    expect(zoomForSpeed(Number.NaN)).toBe(17.6);
  });
});

describe('carPadding', () => {
  it('puts the centre of the rest of the map at CAR_AT', () => {
    const h = 400;
    const top = carPadding(h);
    expect(top + (h - top) / 2).toBeCloseTo(h * CAR_AT, 0);
  });
});

describe('remainingPath', () => {
  it('is the whole route before any progress', () => {
    expect(remainingPath(route, null)).toHaveLength(4);
  });

  it('starts at the car and keeps only what is ahead', () => {
    const progress = { segmentIndex: 1, snapped: { lat: 0, lng: 1.5 } } as RouteProgress;
    expect(remainingPath(route, progress)).toEqual([
      [1.5, 0],
      [2, 0],
      [3, 0],
    ]);
  });
});
