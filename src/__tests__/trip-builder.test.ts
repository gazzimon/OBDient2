import { END_AFTER_MS, STOP_AFTER_MS, TripBuilder, type TripSample } from '@/domain/trips/trip-builder';

// ~10 m per second north at 36 km/h.
const DEG_PER_10M = 10 / 111_000;
let n = 0;
const builder = () => new TripBuilder(() => `t${++n}`, () => 'VIN1');

function drive(b: TripBuilder, from: number, seconds: number, startLat: number, kmh = 36, fuelLph: number | null = 6) {
  let lat = startLat;
  for (let i = 0; i < seconds; i++) {
    lat += (kmh / 36) * DEG_PER_10M;
    b.push({ t: from + i * 1000, lat, lng: -58, kmh, fuelLph });
  }
  return lat;
}

function still(b: TripBuilder, from: number, ms: number, lat: number) {
  const out = [];
  for (let t = 0; t < ms; t += 1000) out.push(b.push({ t: from + t, lat, lng: -58, kmh: 0, fuelLph: 0.8 } as TripSample));
  return out.filter(Boolean);
}

describe('TripBuilder', () => {
  it('records a trip: distance, time, speeds, fuel, simplified path', () => {
    const b = builder();
    drive(b, 0, 120, -34);
    const trip = b.finish()!;
    expect(trip.distanceM).toBeGreaterThan(1150);
    expect(trip.distanceM).toBeLessThan(1250);
    expect(trip.movingS).toBe(119);
    expect(trip.maxKmh).toBe(36);
    expect(trip.avgKmh).toBe(36);
    expect(trip.fuelL).toBeCloseTo((6 * 119) / 3600, 2);
    expect(trip.vin).toBe('VIN1');
    // A point every ~20 m, not every second.
    expect(trip.path.length).toBeGreaterThan(50);
    expect(trip.path.length).toBeLessThan(70);
  });

  it('keeps a stop of 2+ minutes and adds no distance while stopped', () => {
    const b = builder();
    const lat = drive(b, 0, 60, -34);
    still(b, 60_000, STOP_AFTER_MS + 5000, lat);
    drive(b, 60_000 + STOP_AFTER_MS + 5000, 60, lat);
    const trip = b.finish()!;
    expect(trip.stops).toHaveLength(1);
    expect(trip.stops[0]!.to - trip.stops[0]!.from).toBeGreaterThanOrEqual(STOP_AFTER_MS);
    expect(trip.distanceM).toBeLessThan(1250);
  });

  it('a short wait (traffic light) is not a stop', () => {
    const b = builder();
    const lat = drive(b, 0, 60, -34);
    still(b, 60_000, 40_000, lat);
    drive(b, 100_000, 60, lat);
    expect(b.finish()!.stops).toHaveLength(0);
  });

  it('ends by itself after 15 minutes stopped', () => {
    const b = builder();
    const lat = drive(b, 0, 90, -34);
    const events = still(b, 90_000, END_AFTER_MS + 2000, lat);
    expect(events).toEqual([expect.objectContaining({ type: 'ended', trip: expect.objectContaining({ distanceM: expect.any(Number) }) })]);
    expect(b.current).toBeNull();
  });

  it('moving the car in the garage is not a trip', () => {
    const b = builder();
    drive(b, 0, 10, -34);
    expect(b.finish()).toBeNull();
  });

  it('without the MAF there is no fuel figure', () => {
    const b = builder();
    drive(b, 0, 120, -34, 36, null);
    expect(b.finish()!.fuelL).toBeNull();
  });
});
