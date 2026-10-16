import { cameraAxes } from '@/domain/fusion/pose-estimator';
import { destination, toRad } from '@/domain/geo/geo';
import { replayTrip } from '@/domain/recording/replay';
import type { TripRecord } from '@/domain/recording/trip-log';

const G = 9.80665;
const A = { lat: -34.6037, lng: -58.3816 };

// Phone in landscape top-left, pitched down `pitch` degrees, car accelerating
// at `aLong`. `sign` = +1 for a sensor that reads "up" (specific force).
function accel(pitch: number, aLong: number, sign: 1 | -1): [number, number, number] {
  const axes = cameraAxes('top-left');
  const θ = toRad(pitch);
  const cam = { x: 0, y: -Math.cos(θ), z: -Math.sin(θ) };
  const f = (k: 'x' | 'y' | 'z') =>
    (cam.x * axes.right[k] + cam.y * axes.down[k] + cam.z * axes.forward[k]) * G + axes.forward[k] * aLong;
  return [f('x') * sign, f('y') * sign, f('z') * sign];
}

// 10 s parked, 5 s accelerating at 2 m/s², then cruising north at 10 m/s.
function speedAt(t: number): number {
  if (t <= 10_000) return 0;
  if (t <= 15_000) return ((t - 10_000) / 1000) * 2;
  return 10;
}
function distAt(t: number): number {
  if (t <= 10_000) return 0;
  if (t <= 15_000) return ((t - 10_000) / 1000) ** 2;
  return 25 + ((t - 15_000) / 1000) * 10;
}

function syntheticTrip(sensorSign: 1 | -1): TripRecord[] {
  const recs: TripRecord[] = [];
  for (let t = 0; t <= 30_000; t += 20) {
    const aLong = t > 10_000 && t <= 15_000 ? 2 : 0;
    recs.push({ k: 'imu', t, a: accel(4, aLong, sensorSign), g: [0, 0, 0] });
    if (t % 1000 === 0) {
      const v = speedAt(t);
      recs.push({ k: 'gps', t, ...destination(A, 0, distAt(t)), acc: 5, crs: v > 0 ? 0 : null, spd: v });
    }
    if (t % 100 === 0) recs.push({ k: 'obd', t, kmh: speedAt(t) * 3.6 });
  }
  recs.push({ k: 'ev', t: 30_000, name: 'arrived' });
  return recs;
}

describe('replayTrip', () => {
  it('summarises a healthy trip without findings', () => {
    const s = replayTrip(syntheticTrip(1));
    expect(s.durationS).toBeCloseTo(30, 0);
    expect(s.distanceM).toBeCloseTo(175, -1);
    expect(s.imu.rateHz).toBeCloseTo(50, 0);
    expect(s.obd.rateHz).toBeCloseTo(10, 0);
    expect(s.sensorSign.sign).toBe(1);
    expect(s.restingPose!.pitchDeg).toBeCloseTo(4, 0);
    expect(s.headingErrorDeg!.mean).toBeLessThan(2);
    expect(s.events).toEqual({ arrived: 1 });
    expect(s.warnings).toEqual([]);
  });

  it('flags an inverted sensor so calibration can fix it', () => {
    const s = replayTrip(syntheticTrip(-1), 1);
    expect(s.sensorSign.sign).toBe(-1);
    expect(s.warnings.some((w) => w.includes('Invertir sensor'))).toBe(true);
    // Replaying with the right sign confirms the fix before touching the phone.
    expect(replayTrip(syntheticTrip(-1), -1).warnings).toEqual([]);
  });
});
