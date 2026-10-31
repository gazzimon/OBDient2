// Mapa (2026-10-31): one map with three views. Ir: pick a destination (search or
// long-press), preview the route, start driving; the origin is always "where I am
// now". Mis viajes: the trips, drawn on this same map. Estacioné: where the car
// was left (only once a spot was saved).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { Camera, GeoJSONSource, Layer, Map, NativeUserLocation, type CameraRef } from '@maplibre/maplibre-react-native';
import { container } from '@/data/container';
import type { Place } from '@/domain/navigation/route';
import type { ParkingSpot } from '@/domain/parking/parking';
import type { Trip } from '@/domain/trips/trip-builder';
import { ParkedCard } from '@/presentation/components/map/ParkedCard';
import { TripLayers, tripBounds } from '@/presentation/components/map/TripLayers';
import { TripsPanel } from '@/presentation/components/map/TripsPanel';
import { useTrips } from '@/presentation/services/my-trips';
import { parkingRecorder } from '@/presentation/services/parking-recorder';
import { PinsLayer, pinsBounds } from '@/presentation/components/map/PinsLayer';
import { PillButton } from '@/presentation/components/layout/PillButton';
import { formatDistance, formatDuration } from '@/presentation/format';
import { useSensorsWhileFocused } from '@/presentation/hooks/useSensors';
import { navigation } from '@/presentation/services/navigation-controller';
import { COLORS } from '@/presentation/theme';
import { useEgoStore } from '@/store/egoStore';
import { useNavStore } from '@/store/navStore';
import { useSettingsStore } from '@/store/settingsStore';

const SEARCH_DEBOUNCE_MS = 400;
// The parked card's "hace … min" moves on by itself.
const PARKED_TICK_MS = 30_000;

type MapView = 'ir' | 'viajes' | 'estacione';

const VIEW_LABEL: Record<MapView, string> = { ir: 'Ir', viajes: 'Mis viajes', estacione: 'Estacioné' };

export default function MapScreen() {
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
  const [view, setView] = useState<MapView>('ir');
  const tripList = useTrips();
  const [picked, setPicked] = useState<Trip | null>(null);
  const pickTrip = (trip: Trip | null) => {
    setPicked(trip);
    const b = trip ? tripBounds(trip) : null;
    if (!b) return;
    centered.current = true;
    cameraRef.current?.fitBounds(b, { padding: { top: 140, bottom: 340, left: 40, right: 40 }, duration: 600 });
  };
  const choose = (v: MapView) => {
    setView(v);
    if (v !== 'viajes') setPicked(null);
    if (v === 'estacione') showParked();
  };

  // "Dónde estacioné": the last spot saved when the adapter link went.
  const [parked, setParked] = useState<ParkingSpot | null>(null);
  const [parkedNow, setParkedNow] = useState<number | null>(null);
  const reloadParked = useCallback(() => setParked(container.parking.latest()), []);
  // A spot found ("Ya lo encontré") or gone: back to Ir.
  useFocusEffect(reloadParked);
  useEffect(() => parkingRecorder.onSaved(reloadParked), [reloadParked]);
  useEffect(() => {
    if (parkedNow == null) return;
    const timer = setInterval(() => setParkedNow(Date.now()), PARKED_TICK_MS);
    return () => clearInterval(timer);
  }, [parkedNow]);
  const showParked = () => {
    if (!parked) return;
    setParkedNow(Date.now());
    centered.current = true;
    const me = useEgoStore.getState().ego?.position;
    if (me) {
      cameraRef.current?.fitBounds(
        [Math.min(me.lng, parked.lng), Math.min(me.lat, parked.lat), Math.max(me.lng, parked.lng), Math.max(me.lat, parked.lat)],
        { padding: { top: 160, bottom: 300, left: 60, right: 60 }, duration: 600 },
      );
    } else {
      cameraRef.current?.flyTo({ center: [parked.lng, parked.lat], zoom: 17, duration: 600 });
    }
  };

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

  // The assistant's places ("Ver en el mapa"): framed, numbered, pick one.
  const candidates = useNavStore((s) => s.candidates);
  useEffect(() => {
    const b = pinsBounds(candidates);
    if (!b || destination) return;
    centered.current = true;
    cameraRef.current?.fitBounds(b, { padding: { top: 160, bottom: 300, left: 50, right: 50 }, duration: 600 });
  }, [candidates, destination]);

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
          {...(route || !locationOk || picked ? {} : { trackUserLocation: 'default' as const })}
        />
        {locationOk && <NativeUserLocation mode="course" />}
        {view === 'viajes' && picked && <TripLayers trip={picked} />}
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
        {!destination && candidates.length > 0 && <PinsLayer id="candidates" pins={candidates} />}
        {parked && !destination && (
          <GeoJSONSource
            id="parked"
            data={{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [parked.lng, parked.lat] } }}
          >
            <Layer
              id="parked-dot"
              type="circle"
              paint={{ 'circle-radius': 11, 'circle-color': COLORS.amber, 'circle-stroke-color': COLORS.bg, 'circle-stroke-width': 3 }}
            />
            <Layer
              id="parked-label"
              type="symbol"
              layout={{ 'text-field': 'P', 'text-size': 13, 'text-allow-overlap': true }}
              paint={{ 'text-color': COLORS.bg }}
            />
          </GeoJSONSource>
        )}
      </Map>

      {/* Search */}
      <SafeAreaView edges={['top']} className="absolute top-0 left-0 right-0 px-4 pt-2">
        <View className="flex-row items-center gap-2">
          <View className="flex-1 flex-row items-center bg-brand-surface border border-brand-border rounded-2xl px-4">
            <MaterialCommunityIcons name="magnify" size={18} color={COLORS.muted} />
            <TextInput
              value={query}
              onChangeText={(q) => {
                setQuery(q);
                if (view !== 'ir') choose('ir');
              }}
              placeholder="¿A dónde vamos?"
              placeholderTextColor={COLORS.muted}
              className="flex-1 text-brand-text font-mono text-sm py-3 ml-2"
              returnKeyType="search"
            />
            {searching && <ActivityIndicator size="small" color={COLORS.mint} />}
          </View>
        </View>
        {/* The three views; Estacioné only once a spot was saved. */}
        {!destination && candidates.length === 0 && (
          <View className="flex-row self-center gap-1 bg-brand-surface border border-brand-border rounded-full p-1 mt-2">
            {(['ir', 'viajes', ...(parked ? ['estacione' as const] : [])] as MapView[]).map((v) => (
              <Pressable
                key={v}
                onPress={() => choose(v)}
                accessibilityRole="tab"
                accessibilityState={{ selected: view === v }}
                className="px-4 py-1.5 rounded-full active:opacity-60"
                style={{ backgroundColor: view === v ? COLORS.border : 'transparent' }}
              >
                <Text className="font-mono text-xs" style={{ color: view === v ? COLORS.text : COLORS.muted }}>
                  {VIEW_LABEL[v]}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
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
        {view === 'ir' && !destination && visible.length === 0 && (
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
          style={{ bottom: destination ? 236 : view === 'viajes' ? 340 : 24 }}
        >
          <MaterialCommunityIcons name="crosshairs-gps" size={20} color={COLORS.mint} />
        </Pressable>
      )}

      {/* The assistant's places: pick one to plan the route. */}
      {!destination && candidates.length > 0 && (
        <View className="absolute bottom-4 left-4 right-4 bg-brand-surface border border-brand-border rounded-2xl overflow-hidden">
          <View className="flex-row items-center justify-between px-4 pt-3 pb-1">
            <Text className="text-brand-muted font-mono text-xs">Lugares del asistente</Text>
            <Pressable onPress={() => useNavStore.getState().setCandidates([])} hitSlop={8} accessibilityLabel="Cerrar">
              <MaterialCommunityIcons name="close" size={18} color={COLORS.muted} />
            </Pressable>
          </View>
          {candidates.map((c) => (
            <Pressable
              key={c.n}
              onPress={() => pick({ name: c.name, detail: c.detail, location: { lat: c.lat, lng: c.lng } })}
              className="flex-row items-center px-4 py-2.5 border-t border-brand-border active:opacity-60"
            >
              <View className="w-6 h-6 rounded-full items-center justify-center mr-3" style={{ backgroundColor: COLORS.mint }}>
                <Text className="font-mono-bold text-xs" style={{ color: COLORS.bg }}>
                  {c.n}
                </Text>
              </View>
              <Text className="text-brand-text font-mono text-xs flex-1" numberOfLines={1}>
                {c.name}
              </Text>
              <Text className="text-brand-mint font-mono text-xs ml-2">Ir</Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* Where the car was left. */}
      {view === 'estacione' && parked && parkedNow != null && !destination && candidates.length === 0 && (
        <ParkedCard
          spot={parked}
          here={ego?.position ?? null}
          now={parkedNow}
          onClose={() => {
            setParkedNow(null);
            setView('ir');
          }}
          onFound={() => {
            container.parking.remove(parked.at);
            setParkedNow(null);
            setView('ir');
            reloadParked();
          }}
        />
      )}

      {/* Mis viajes: the list, or the trip drawn on the map. */}
      {view === 'viajes' && !destination && candidates.length === 0 && (
        <View className="absolute bottom-4 left-4 right-4 bg-brand-surface border border-brand-border rounded-2xl px-4 pt-3 pb-3" style={{ maxHeight: '45%' }}>
          <TripsPanel list={tripList} picked={picked} onPick={pickTrip} />
        </View>
      )}

      {/* Free driving: the driving view without a destination. */}
      {view === 'ir' && !destination && candidates.length === 0 && (
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
