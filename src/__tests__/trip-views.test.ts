import type { Trip } from '@/domain/trips/trip-builder';
import { dayLabel, speedSegments, toGpx, tripName } from '@/domain/trips/trip-views';

const trip: Trip = {
  id: 't1',
  startedAt: Date.UTC(2026, 9, 20, 11, 0),
  endedAt: Date.UTC(2026, 9, 20, 11, 20),
  distanceM: 4100,
  movingS: 1100,
  maxKmh: 72,
  avgKmh: 13,
  fuelL: 0.4,
  path: [
    { lat: -27.37, lng: -55.89, t: Date.UTC(2026, 9, 20, 11, 0), kmh: 20 },
    { lat: -27.371, lng: -55.89, t: Date.UTC(2026, 9, 20, 11, 1), kmh: 25 },
    { lat: -27.372, lng: -55.89, t: Date.UTC(2026, 9, 20, 11, 2), kmh: 75 },
    { lat: -27.373, lng: -55.89, t: Date.UTC(2026, 9, 20, 11, 3), kmh: 80 },
  ],
  stops: [{ lat: -27.37, lng: -55.89, from: Date.UTC(2026, 9, 20, 11, 5), to: Date.UTC(2026, 9, 20, 11, 10) }],
  vin: null,
  startName: 'Casa',
  endName: 'Av. Uruguay 2651 & <Co>',
};

describe('trip views', () => {
  it('writes a valid GPX with track, speed and stops, escaping names', () => {
    const gpx = toGpx(trip);
    expect(gpx).toContain('<trkpt lat="-27.370000" lon="-55.890000">');
    expect(gpx).toContain('<speed>5.56</speed>');
    expect(gpx).toContain('<name>Parada 5 min</name>');
    expect(gpx).toContain('Casa → Av. Uruguay 2651 &amp; &lt;Co&gt;');
    expect(gpx.match(/<trkpt /g)).toHaveLength(4);
  });

  it('splits the path by speed without gaps', () => {
    const segs = speedSegments(trip);
    expect(segs.map((s) => s.band)).toEqual(['slow', 'mid', 'fast']);
    expect(segs[1]!.coords[0]).toEqual(segs[0]!.coords[segs[0]!.coords.length - 1]);
  });

  it('names and days read naturally', () => {
    expect(tripName({ ...trip, startName: null })).toBe('Av. Uruguay 2651 & <Co>');
    const now = new Date(2026, 9, 20, 15).getTime();
    expect(dayLabel(new Date(2026, 9, 20, 9).getTime(), now)).toBe('Hoy');
    expect(dayLabel(new Date(2026, 9, 19, 9).getTime(), now)).toBe('Ayer');
    expect(dayLabel(new Date(2026, 9, 17, 9).getTime(), now)).toBe('sábado 17 de octubre');
  });
});
