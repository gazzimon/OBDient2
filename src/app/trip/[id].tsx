// One trip: its path on the map coloured by speed (green slow, amber medium,
// red fast), start, end and stops, the figures, and share (GPX) or delete.

import { useMemo } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Camera, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { speedSegments, toGpx, tripName, dayLabel } from '@/domain/trips/trip-views';
import { formatDistance, formatDuration } from '@/presentation/format';
import { trips, useTrips } from '@/presentation/services/my-trips';
import { COLORS } from '@/presentation/theme';
import { useSettingsStore } from '@/store/settingsStore';

const BAND_COLOR = { slow: COLORS.mint, mid: COLORS.amber, fast: COLORS.red } as const;
const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export default function TripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const trip = useTrips().find((t) => t.id === id) ?? null;
  const mapStyleUrl = useSettingsStore((s) => s.mapStyleUrl);

  const lines = useMemo<GeoJSON.FeatureCollection | null>(
    () =>
      trip && {
        type: 'FeatureCollection',
        features: speedSegments(trip).map((s) => ({
          type: 'Feature',
          properties: { color: BAND_COLOR[s.band] },
          geometry: { type: 'LineString', coordinates: s.coords },
        })),
      },
    [trip],
  );
  const marks = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!trip || trip.path.length === 0) return null;
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
  const bounds = useMemo(() => {
    if (!trip || trip.path.length === 0) return null;
    let [w, s, e, n] = [180, 90, -180, -90];
    for (const p of trip.path) {
      w = Math.min(w, p.lng);
      e = Math.max(e, p.lng);
      s = Math.min(s, p.lat);
      n = Math.max(n, p.lat);
    }
    return [w, s, e, n] as [number, number, number, number];
  }, [trip]);

  if (!trip) {
    return (
      <SafeAreaView className="flex-1 bg-brand-bg items-center justify-center">
        <Text className="text-brand-muted font-mono text-sm">Este viaje ya no está.</Text>
      </SafeAreaView>
    );
  }

  const share = async () => {
    try {
      const f = new File(Paths.cache, `${trip.id}.gpx`);
      if (f.exists) f.delete();
      f.create();
      f.write(toGpx(trip));
      await Sharing.shareAsync(f.uri, { mimeType: 'application/gpx+xml', dialogTitle: tripName(trip) });
    } catch {
      Alert.alert('No se pudo compartir el viaje.');
    }
  };
  const remove = () =>
    Alert.alert('¿Borrar este viaje?', 'No se puede deshacer.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar',
        style: 'destructive',
        onPress: () => {
          trips.remove(trip.id);
          router.back();
        },
      },
    ]);

  const stats: [string, string][] = [
    ['Distancia', formatDistance(trip.distanceM)],
    ['En movimiento', formatDuration(trip.movingS)],
    ['Promedio', `${trip.avgKmh} km/h`],
    ['Máxima', `${trip.maxKmh} km/h`],
    ['Combustible', trip.fuelL != null ? `≈${trip.fuelL.toFixed(1).replace('.', ',')} L` : '—'],
    ['Paradas', String(trip.stops.length)],
  ];

  return (
    <SafeAreaView className="flex-1 bg-brand-bg" edges={['top', 'bottom']}>
      <View className="flex-row items-center px-4 py-3 border-b border-brand-border">
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Volver" className="mr-3 active:opacity-60">
          <MaterialCommunityIcons name="arrow-left" size={22} color={COLORS.text} />
        </Pressable>
        <View className="flex-1">
          <Text className="text-brand-text font-mono-bold text-sm" numberOfLines={1}>
            {tripName(trip)}
          </Text>
          <Text className="text-brand-muted font-mono text-[11px]">
            {dayLabel(trip.startedAt)} · {hhmm(trip.startedAt)}–{hhmm(trip.endedAt)}
          </Text>
        </View>
      </View>
      <View style={{ height: 300 }}>
        <Map style={{ flex: 1 }} mapStyle={mapStyleUrl} logo={false} attribution attributionPosition={{ bottom: 6, left: 6 }}>
          {bounds && <Camera bounds={bounds} padding={{ top: 40, bottom: 40, left: 40, right: 40 }} />}
          {lines && (
            <GeoJSONSource id="trip-lines" data={lines}>
              <Layer id="trip-casing" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': COLORS.bg, 'line-width': 8 }} />
              <Layer id="trip-line" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': ['get', 'color'], 'line-width': 5 }} />
            </GeoJSONSource>
          )}
          {marks && (
            <GeoJSONSource id="trip-marks" data={marks}>
              <Layer id="trip-marks-dot" type="circle" paint={{ 'circle-radius': 7, 'circle-color': ['get', 'color'], 'circle-stroke-width': 2, 'circle-stroke-color': COLORS.bg }} />
            </GeoJSONSource>
          )}
        </Map>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <View className="flex-row flex-wrap gap-2 mb-4">
          {stats.map(([k, v]) => (
            <View key={k} className="bg-brand-surface rounded-2xl px-3 py-2" style={{ width: '31%' }}>
              <Text className="text-brand-muted font-mono text-[10px]">{k}</Text>
              <Text className="text-brand-text font-mono-bold text-sm">{v}</Text>
            </View>
          ))}
        </View>
        <View className="flex-row gap-3 mb-3">
          <Legend color={COLORS.mint} label="< 30 km/h" />
          <Legend color={COLORS.amber} label="30–70" />
          <Legend color={COLORS.red} label="> 70" />
        </View>
        {trip.stops.map((s) => (
          <Text key={s.from} className="text-brand-muted font-mono text-xs mb-1">
            ⏸ Parada de {Math.round((s.to - s.from) / 60_000)} min, {hhmm(s.from)}
          </Text>
        ))}
        {trip.codes?.length ? (
          <Text className="text-brand-amber font-mono text-xs mt-2">Códigos leídos en este viaje: {trip.codes.join(', ')}</Text>
        ) : null}
        <Pressable onPress={() => void share()} className="flex-row items-center justify-center gap-2 h-12 rounded-2xl mt-5 active:opacity-70" style={{ backgroundColor: COLORS.mint }}>
          <MaterialCommunityIcons name="share-variant-outline" size={20} color={COLORS.bg} />
          <Text className="font-mono-bold text-sm" style={{ color: COLORS.bg }}>
            Compartir (GPX)
          </Text>
        </Pressable>
        <Pressable onPress={remove} className="items-center justify-center h-12 mt-2 active:opacity-60">
          <Text className="text-brand-red font-mono text-sm">Borrar viaje</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View className="flex-row items-center gap-1">
      <View className="w-4 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      <Text className="text-brand-muted font-mono text-[10px]">{label}</Text>
    </View>
  );
}
