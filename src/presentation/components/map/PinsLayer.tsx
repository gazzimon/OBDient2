// Numbered points on a map (search and fuel results): a mint dot with its
// number, the same in the chat's map card and on the Mapa tab.

import { useMemo } from 'react';
import { GeoJSONSource, Layer, type LngLatBounds } from '@maplibre/maplibre-react-native';
import type { MapPin } from '@/domain/assistant/tools';
import { COLORS } from '@/presentation/theme';

export function PinsLayer({ id, pins }: { id: string; pins: readonly MapPin[] }) {
  const data = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: pins.map((p) => ({
        type: 'Feature',
        properties: { n: String(p.n) },
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      })),
    }),
    [pins],
  );
  return (
    <GeoJSONSource id={id} data={data}>
      <Layer
        id={`${id}-dot`}
        type="circle"
        paint={{ 'circle-radius': 13, 'circle-color': COLORS.mint, 'circle-stroke-width': 2, 'circle-stroke-color': COLORS.bg }}
      />
      <Layer
        id={`${id}-n`}
        type="symbol"
        layout={{ 'text-field': ['get', 'n'], 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-allow-overlap': true }}
        paint={{ 'text-color': COLORS.bg }}
      />
    </GeoJSONSource>
  );
}

// West, south, east, north around the pins, with a little margin.
export function pinsBounds(pins: readonly MapPin[]): LngLatBounds | null {
  if (pins.length === 0) return null;
  let [w, s, e, n] = [180, 90, -180, -90];
  for (const p of pins) {
    w = Math.min(w, p.lng);
    e = Math.max(e, p.lng);
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
  }
  const pad = 0.002;
  return [w - pad, s - pad, e + pad, n + pad];
}
