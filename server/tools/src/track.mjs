// Live position (Traccar, decision 2026-10-20): the app sends where the car
// is; this checks it and hands it to Traccar's OsmAnd port on this machine
// (127.0.0.1:5055). Traccar is never reached from the internet directly, so
// nobody can invent positions for a device.
//
//   POST /tools/v1/track { device, points: [{ t, lat, lng, kmh?, bearing?, acc?, obd? }] }
//
// Up to 20 points at once: the ones queued while the phone had no signal.
// `obd` carries a few readings as Traccar attributes (shown in its web).

import { validPoint } from './queries/geo.mjs';

export const MAX_POINTS = 20;
const DAY_MS = 86_400_000;
const OBD_KEYS = ['rpm', 'coolant', 'fuelLph', 'voltage', 'load'];

export class BadTrack extends Error {}

// One checked point → the OsmAnd query (speed in knots, time in seconds).
export function osmandQuery(device, p, now, driver = null) {
  const t = Number(p.t);
  if (!Number.isFinite(t) || Math.abs(t - now) > DAY_MS) throw new BadTrack('bad_time');
  if (!validPoint({ lat: Number(p.lat), lng: Number(p.lng) })) throw new BadTrack('bad_position');
  const q = new URLSearchParams({
    id: device,
    lat: String(Number(p.lat)),
    lon: String(Number(p.lng)),
    timestamp: String(Math.round(t / 1000)),
  });
  const num = (v, lo, hi) => (v == null ? null : Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi ? Number(v) : NaN);
  const kmh = num(p.kmh, 0, 400);
  const bearing = num(p.bearing, 0, 360);
  const acc = num(p.acc, 0, 10_000);
  if ([kmh, bearing, acc].some((v) => Number.isNaN(v))) throw new BadTrack('bad_value');
  if (kmh != null) q.set('speed', (kmh / 1.852).toFixed(2));
  if (bearing != null) q.set('bearing', bearing.toFixed(0));
  if (acc != null) q.set('accuracy', acc.toFixed(0));
  // VIN = the car, driver = the account's email (decision 2026-10-20).
  if (typeof p.vin === 'string' && /^[A-HJ-NPR-Z0-9]{11,17}$/.test(p.vin)) q.set('vin', p.vin);
  if (driver) q.set('driverUniqueId', driver);
  if (p.obd && typeof p.obd === 'object') {
    for (const k of OBD_KEYS) {
      const v = Number(p.obd[k]);
      if (p.obd[k] != null && Number.isFinite(v) && Math.abs(v) < 100_000) q.set(k, String(v));
    }
  }
  return q.toString();
}

export function checkTrack(body, now, driver = null) {
  const device = typeof body.device === 'string' ? body.device.trim() : '';
  // Traccar's OsmAnd port rejects '-' in ids (400, checked with 6.16): letters, digits, '_'.
  if (!/^[A-Za-z0-9_]{4,40}$/.test(device)) throw new BadTrack('bad_device');
  const points = Array.isArray(body.points) ? body.points : [];
  if (points.length === 0 || points.length > MAX_POINTS) throw new BadTrack('bad_points');
  return points.map((p) => osmandQuery(device, p ?? {}, now, driver));
}
