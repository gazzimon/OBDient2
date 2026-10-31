// One trip on the Mapa tab's map: the path coloured by speed (green slow, amber
// medium, red fast), start, end and stops. It lived in its own screen with its
// own map until 2026-10-31.

import { useMemo } from 'react';
import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import type { Trip } from '@/domain/trips/trip-builder';
import { speedSegments } from '@/domain/trips/trip-views';
import { COLORS } from '@/presentation/theme';

export const BAND_COLOR = { slow: COLORS.mint, mid: COLORS.amber, fast: COLORS.red } as const;

export function tripBounds(trip: Trip): [number, number, number, number] | null {
  if (trip.path.length === 0) return null;
  let [w, s, e, n] = [180, 90, -180, -90];
  for (const p of trip.path) {
    w = Math.min(w, p.lng);
    e = Math.max(e, p.lng);
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
  }
  return [w, s, e, n];
}

export function TripLayers({ trip }: { trip: Trip }) {
  const lines = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: speedSegments(trip).map((s) => ({
        type: 'Feature',
        properties: { color: BAND_COLOR[s.band] },
        geometry: { type: 'LineString', coordinates: s.coords },
      })),
    }),
    [trip],
  );
  const marks = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (trip.path.length === 0) return null;
    const a = trip.path[0]!;
    const b = trip.path[trip.path.length - 1]!;
    const pt = (lng: number, lat: number, color: string) => ({
      type: 'Feature' as const,
      properties: { color },
      geometry: { type: 'Point' as const, coordinates: [lng, lat] },
    });
    return {
      type: 'FeatureCollection',
      features: [pt(a.lng, a.lat, COLORS.mint), pt(b.lng, b.lat, COLORS.red), ...trip.stops.map((s) => pt(s.lng, s.lat, COLORS.amber))],
    };
  }, [trip]);
  return (
    <>
      <GeoJSONSource id="trip-lines" data={lines}>
        <Layer id="trip-casing" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': COLORS.bg, 'line-width': 8 }} />
        <Layer id="trip-line" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': ['get', 'color'], 'line-width': 5 }} />
      </GeoJSONSource>
      {marks && (
        <GeoJSONSource id="trip-marks" data={marks}>
          <Layer id="trip-marks-dot" type="circle" paint={{ 'circle-radius': 7, 'circle-color': ['get', 'color'], 'circle-stroke-width': 2, 'circle-stroke-color': COLORS.bg }} />
        </GeoJSONSource>
      )}
    </>
  );
}
