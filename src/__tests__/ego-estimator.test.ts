import { EgoEstimator } from '@/domain/fusion/ego-estimator';
import { bearingDeg, destination, distanceM } from '@/domain/geo/geo';

const A = { lat: -34.6037, lng: -58.3816 };

describe('EgoEstimator', () => {
  it('dead-reckons between GPS fixes with OBD speed', () => {
    const ego = new EgoEstimator();
    ego.onGps({ position: A, accuracyM: 5, courseDeg: 45, speedMps: 10, tMs: 0 });
    ego.tick(0, 0);
    for (let t = 50; t <= 1000; t += 50) {
      ego.onObdSpeed({ kmh: 36, tMs: t });
      ego.tick(t, 0);
    }
    const s = ego.tick(1000, 0)!;
    expect(s.speedSource).toBe('obd');
    expect(distanceM(A, s.position)).toBeCloseTo(10, 0);
    expect(bearingDeg(A, s.position)).toBeCloseTo(45, 0);
  });

  it('falls back to GPS speed when OBD goes stale', () => {
    const ego = new EgoEstimator();
    ego.onObdSpeed({ kmh: 50, tMs: 0 });
    ego.onGps({ position: A, accuracyM: 5, courseDeg: 0, speedMps: 7, tMs: 4000 });
    const s = ego.tick(4000, 0)!;
    expect(s.speedSource).toBe('gps');
    expect(s.speedMps).toBe(7);
  });

  it('integrates the gyro: positive yaw rate turns left (heading decreases)', () => {
    const ego = new EgoEstimator();
    ego.onGps({ position: A, accuracyM: 5, courseDeg: 90, speedMps: 10, tMs: 0 });
    ego.tick(0, 0);
    for (let t = 100; t <= 1000; t += 100) ego.tick(t, 10);
    expect(ego.tick(1000, 10)!.headingDeg).toBeCloseTo(80, 0);
  });

  it('absorbs a GPS jump gradually instead of snapping', () => {
    const ego = new EgoEstimator();
    ego.onGps({ position: A, accuracyM: 5, courseDeg: null, speedMps: 0, tMs: 0 });
    ego.tick(0, 0);
    ego.onGps({ position: destination(A, 90, 10), accuracyM: 5, courseDeg: null, speedMps: 0, tMs: 100 });
    const first = ego.tick(100, 0)!;
    expect(distanceM(A, first.position)).toBeLessThan(2);
    let s = first;
    for (let t = 200; t <= 3000; t += 100) s = ego.tick(t, 0)!;
    expect(distanceM(A, s.position)).toBeCloseTo(10, 0);
  });

  it('reports history in the ego frame (x forward, y left)', () => {
    const ego = new EgoEstimator();
    ego.onGps({ position: A, accuracyM: 5, courseDeg: 0, speedMps: 10, tMs: 0 });
    for (let t = 0; t <= 2000; t += 50) {
      ego.onObdSpeed({ kmh: 36, tMs: t });
      ego.tick(t, 0);
    }
    const h = ego.egoFrameHistory(500, 4);
    expect(h).toHaveLength(4);
    expect(h[3]!.x).toBeCloseTo(0, 1);
    expect(h[0]!.x).toBeCloseTo(-15, 0); // 1.5 s behind at 10 m/s
    expect(Math.abs(h[0]!.y)).toBeLessThan(0.5);
  });

  it('stopped: the gyro does not turn the car (the phone is being handled)', () => {
    const ego = new EgoEstimator();
    ego.onGps({ position: A, accuracyM: 5, courseDeg: 90, speedMps: 10, tMs: 0 });
    ego.tick(0, 0);
    ego.onGps({ position: A, accuracyM: 5, courseDeg: null, speedMps: 0.15, tMs: 100 });
    for (let t = 100; t <= 3000; t += 50) ego.tick(t, 25);
    expect(ego.tick(3000, 25)!.headingDeg).toBeCloseTo(90, 0);
  });

  it('stopped: fixes inside their accuracy do not move the car', () => {
    const ego = new EgoEstimator();
    ego.onGps({ position: A, accuracyM: 6, courseDeg: null, speedMps: 0.1, tMs: 0 });
    ego.tick(0, 0);
    for (let i = 1; i <= 20; i++) {
      const noisy = destination(A, (i * 77) % 360, 4);
      ego.onGps({ position: noisy, accuracyM: 6, courseDeg: null, speedMps: 0.2, tMs: i * 1000 });
      for (let t = i * 1000; t < (i + 1) * 1000; t += 100) ego.tick(t, 0);
    }
    expect(distanceM(A, ego.tick(21000, 0)!.position)).toBeLessThan(0.01);
  });
});
