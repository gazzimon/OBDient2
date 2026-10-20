// A saved trip, shown and shared: the GPX file (opens in Google Earth,
// OsmAnd, Strava, Traccar) and the path split by speed for the map.

import type { Trip } from './trip-builder';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function tripName(t: Trip): string {
  if (t.startName && t.endName) return `${t.startName} → ${t.endName}`;
  return t.endName ?? t.startName ?? 'Viaje';
}

export function toGpx(t: Trip): string {
  const pts = t.path
    .map((p) => `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}"><time>${new Date(p.t).toISOString()}</time><speed>${(p.kmh / 3.6).toFixed(2)}</speed></trkpt>`)
    .join('\n');
  const stops = t.stops
    .map((s) => `  <wpt lat="${s.lat.toFixed(6)}" lon="${s.lng.toFixed(6)}"><time>${new Date(s.from).toISOString()}</time><name>Parada ${Math.round((s.to - s.from) / 60_000)} min</name></wpt>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="OBDient2" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(tripName(t))}</name><time>${new Date(t.startedAt).toISOString()}</time></metadata>
${stops ? `${stops}\n` : ''}  <trk>
    <name>${esc(tripName(t))}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}

export type SpeedBand = 'slow' | 'mid' | 'fast';

export function speedBand(kmh: number): SpeedBand {
  return kmh < 30 ? 'slow' : kmh < 70 ? 'mid' : 'fast';
}

// Consecutive points of the same band joined into one line (each line shares
// its first point with the end of the previous one, so there are no gaps).
export function speedSegments(t: Trip): { band: SpeedBand; coords: [number, number][] }[] {
  const out: { band: SpeedBand; coords: [number, number][] }[] = [];
  for (let i = 1; i < t.path.length; i++) {
    const a = t.path[i - 1]!;
    const b = t.path[i]!;
    const band = speedBand((a.kmh + b.kmh) / 2);
    const last = out[out.length - 1];
    if (last && last.band === band) last.coords.push([b.lng, b.lat]);
    else out.push({ band, coords: [[a.lng, a.lat], [b.lng, b.lat]] });
  }
  return out;
}

// "lunes 20 de octubre"
export function dayLabel(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const today = new Date(now);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Ayer';
  const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return `${DAYS[d.getDay()]} ${d.getDate()} de ${MONTHS[d.getMonth()]}${d.getFullYear() !== today.getFullYear() ? ` de ${d.getFullYear()}` : ''}`;
}
