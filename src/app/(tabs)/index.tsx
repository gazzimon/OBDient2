// Route planning: pick a destination (search or long-press), preview the
// route, start AR guidance. The origin is always "where I am now".

import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { Camera, GeoJSONSource, Layer, Map, NativeUserLocation, type CameraRef } from '@maplibre/maplibre-react-native';
import { container } from '@/data/container';
import type { Place } from '@/domain/navigation/route';
import { PillButton } from '@/presentation/components/layout/PillButton';
import { formatDistance, formatDuration } from '@/presentation/format';
import { useSensorsWhileFocused } from '@/presentation/hooks/useSensors';
import { navigation } from '@/presentation/services/navigation-controller';
import { COLORS } from '@/presentation/theme';
import { useEgoStore } from '@/store/egoStore';
import { useNavStore } from '@/store/navStore';
import { useSettingsStore } from '@/store/settingsStore';

const SEARCH_DEBOUNCE_MS = 400;

export default function RouteScreen() {
  useSensorsWhileFocused();
  const router = useRouter();
  const mapStyleUrl = useSettingsStore((s) => s.mapStyleUrl);
  const { destination, route, status, error } = useNavStore();
  const ego = useEgoStore((s) => s.ego);
  const locationOk = useEgoStore((s) => s.location === 'ok');
  const cameraRef = useRef<CameraRef>(null);
  const centered = useRef(false);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);

  // Debounced search, biased to the current position.
  useEffect(() => {
    if (query.trim().length < 3) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      container
        .geocoder()
        .search(query, useEgoStore.getState().ego?.position ?? null, ctrl.signal)
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);

  // "Where am I" first. Without a centre the map opens on 0,0 — open ocean,
  // a blue screen. MapLibre's own tracking only starts once it has the
  // location permission, which expo-location asks for after the map is up,
  // so do not rely on it: jump to the last known position right away (cached
  // by the OS, instant), then to the first real fix.
  const centerOn = (lat: number, lng: number) =>
    cameraRef.current?.jumpTo({ center: [lng, lat], zoom: 16 });

  useEffect(() => {
    Location.getLastKnownPositionAsync()
      .then((last) => {
        if (last && !centered.current) centerOn(last.coords.latitude, last.coords.longitude);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!ego || centered.current || route) return;
    centered.current = true;
    centerOn(ego.position.lat, ego.position.lng);
  }, [ego, route]);

  // Frame the whole route when it arrives.
  useEffect(() => {
    if (!route) return;
    let [w, s, e, n] = [180, 90, -180, -90];
    for (const p of route.geometry) {
      w = Math.min(w, p.lng);
      e = Math.max(e, p.lng);
      s = Math.min(s, p.lat);
      n = Math.max(n, p.lat);
    }
    cameraRef.current?.fitBounds([w, s, e, n], {
      padding: { top: 140, bottom: 260, left: 40, right: 40 },
      duration: 600,
    });
  }, [route]);

  const routeShape = useMemo<GeoJSON.Feature | null>(
    () =>
      route
        ? {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: route.geometry.map((p) => [p.lng, p.lat]) },
          }
        : null,
    [route],
  );

  // Short queries show nothing, without an effect having to clear the list.
  const visible = query.trim().length < 3 ? [] : results;

  const pick = (place: Place) => {
    setQuery('');
    setResults([]);
    void navigation.planTo(place);
  };

  const startDriving = async () => {
    await navigation.start();
    router.push('/drive');
  };

  return (
    <View className="flex-1 bg-brand-bg">
      <Map
        style={{ flex: 1 }}
        mapStyle={mapStyleUrl}
        logo={false}
        attribution
        attributionPosition={{ bottom: 8, left: 8 }}
        onLongPress={(e) => {
          const [lng, lat] = e.nativeEvent.lngLat;
          pick({ name: 'Punto en el mapa', detail: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, location: { lat, lng } });
        }}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{ zoom: 15 }}
          {...(route || !locationOk ? {} : { trackUserLocation: 'default' as const })}
        />
        {locationOk && <NativeUserLocation mode="course" />}
        {routeShape && (
          <GeoJSONSource id="route" data={routeShape}>
            <Layer
              id="route-casing"
              type="line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': COLORS.bg, 'line-width': 9 }}
            />
            <Layer
              id="route-line"
              type="line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': COLORS.mint, 'line-width': 5 }}
            />
          </GeoJSONSource>
        )}
        {destination && (
          <GeoJSONSource
            id="destination"
            data={{
              type: 'Feature',
              properties: {},
              geometry: { type: 'Point', coordinates: [destination.location.lng, destination.location.lat] },
            }}
          >
            <Layer
              id="destination-dot"
              type="circle"
              paint={{
                'circle-radius': 8,
                'circle-color': COLORS.mint,
                'circle-stroke-color': COLORS.bg,
                'circle-stroke-width': 3,
              }}
            />
          </GeoJSONSource>
        )}
      </Map>

      {/* Search */}
      <SafeAreaView edges={['top']} className="absolute top-0 left-0 right-0 px-4 pt-2">
        <View className="flex-row items-center bg-brand-surface border border-brand-border rounded-2xl px-4">
          <MaterialCommunityIcons name="magnify" size={18} color={COLORS.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="¿A dónde vamos?"
            placeholderTextColor={COLORS.muted}
            className="flex-1 text-brand-text font-mono text-sm py-3 ml-2"
            returnKeyType="search"
          />
          {searching && <ActivityIndicator size="small" color={COLORS.mint} />}
        </View>
        {visible.length > 0 && (
          <FlatList
            className="mt-2 bg-brand-surface border border-brand-border rounded-2xl max-h-72"
            keyboardShouldPersistTaps="handled"
            data={visible}
            keyExtractor={(p, i) => `${p.location.lat},${p.location.lng},${i}`}
            renderItem={({ item }) => (
              <Pressable onPress={() => pick(item)} className="px-4 py-3 border-b border-brand-border active:opacity-60">
                <Text className="text-brand-text font-mono text-sm" numberOfLines={1}>
                  {item.name}
                </Text>
                {item.detail !== '' && (
                  <Text className="text-brand-muted font-mono text-xs mt-0.5" numberOfLines={1}>
                    {item.detail}
                  </Text>
                )}
              </Pressable>
            )}
          />
        )}
        {!destination && visible.length === 0 && (
          <Text className="text-brand-muted font-mono text-[11px] mt-2 text-center">
            Busca un lugar o mantén presionado el mapa para fijar el destino
          </Text>
        )}
      </SafeAreaView>

      {/* Centre on me */}
      {ego && (
        <Pressable
          onPress={() => centerOn(ego.position.lat, ego.position.lng)}
          hitSlop={8}
          className="absolute right-4 w-11 h-11 rounded-full bg-brand-surface border border-brand-border items-center justify-center active:opacity-60"
          style={{ bottom: destination ? 236 : 24 }}
        >
          <MaterialCommunityIcons name="crosshairs-gps" size={20} color={COLORS.mint} />
        </Pressable>
      )}

      {/* Free driving: the driving view without a destination. */}
      {!destination && (
        <Pressable
          onPress={() => router.push('/drive')}
          className="absolute bottom-6 self-center flex-row items-center gap-2 bg-brand-surface border border-brand-teal rounded-full px-5 py-3 active:opacity-60"
          accessibilityRole="button"
        >
          <MaterialCommunityIcons name="steering" size={18} color={COLORS.mint} />
          <Text className="text-brand-mint font-mono-bold text-sm">Manejar</Text>
        </Pressable>
      )}

      {/* Route card */}
      {destination && (
        <View className="absolute bottom-4 left-4 right-4 bg-brand-surface border border-brand-border rounded-2xl p-4">
          <Text className="text-brand-muted font-mono text-xs">Destino</Text>
          <Text className="text-brand-text font-mono-bold text-base mt-1" numberOfLines={1}>
            {destination.name}
          </Text>
          {destination.detail !== '' && (
            <Text className="text-brand-muted font-mono text-xs mt-0.5" numberOfLines={1}>
              {destination.detail}
            </Text>
          )}

          {status === 'routing' && (
            <View className="flex-row items-center gap-2 mt-3">
              <ActivityIndicator size="small" color={COLORS.mint} />
              <Text className="text-brand-muted font-mono text-xs">Calculando ruta…</Text>
            </View>
          )}
          {route && (
            <View className="flex-row gap-6 mt-3">
              <Text className="text-brand-teal font-mono-bold text-2xl">{formatDuration(route.durationS)}</Text>
              <Text className="text-brand-text font-mono text-2xl">{formatDistance(route.distanceM)}</Text>
            </View>
          )}
          {error && <Text className="text-brand-red font-mono text-xs mt-3">{error}</Text>}
          {!ego && status !== 'routing' && (
            <Text className="text-brand-amber font-mono text-[11px] mt-2">Esperando GPS…</Text>
          )}

          <View className="flex-row gap-3 mt-4">
            <View className="flex-1">
              <PillButton label="Cancelar" variant="secondary" onPress={() => navigation.stop()} />
            </View>
            <View className="flex-1">
              <PillButton label="Iniciar" onPress={startDriving} disabled={!route} />
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
