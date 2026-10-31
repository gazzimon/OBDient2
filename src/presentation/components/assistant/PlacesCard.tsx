// What the assistant found (places, fuel stations), right in the chat: a small
// map with the numbered points, the list, and one big "Ver en el mapa".
// When the answer says "te muestro…", this is what it shows.
//
// Only the newest card draws a live map (a map view per message would weigh
// on low-end phones); older ones keep the list and the button.

import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Camera, Map } from '@maplibre/maplibre-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { MapPin } from '@/domain/assistant/tools';
import { PinsLayer, pinsBounds } from '@/presentation/components/map/PinsLayer';
import { navigation } from '@/presentation/services/navigation-controller';
import { COLORS } from '@/presentation/theme';
import { useNavStore } from '@/store/navStore';
import { useSettingsStore } from '@/store/settingsStore';

const km = (d: number | null) => (d == null ? '' : ` · ${String(Math.round(d * 10) / 10).replace('.', ',')} km`);

export function PlacesCard({ id, pins, live }: { id: string; pins: readonly MapPin[]; live: boolean }) {
  const mapStyleUrl = useSettingsStore((s) => s.mapStyleUrl);
  const bounds = pinsBounds(pins);

  const showAll = () => {
    useNavStore.getState().setCandidates(pins);
    router.navigate('/mapa');
  };
  const go = (p: MapPin) => {
    void navigation.planTo({ name: p.name, detail: p.detail, location: { lat: p.lat, lng: p.lng } });
    router.navigate('/mapa');
  };

  return (
    <View className="mb-3 rounded-2xl overflow-hidden border border-brand-border bg-brand-surface">
      {live && bounds && (
        <View style={{ height: 170 }} pointerEvents="none">
          <Map style={{ flex: 1 }} mapStyle={mapStyleUrl} logo={false} compass={false} attribution={false} dragPan={false} touchZoom={false} touchRotate={false} touchPitch={false}>
            {pins.length === 1 ? (
              <Camera center={[pins[0]!.lng, pins[0]!.lat]} zoom={15} />
            ) : (
              <Camera bounds={bounds} padding={{ top: 24, bottom: 24, left: 24, right: 24 }} />
            )}
            <PinsLayer id={`pins-${id}`} pins={pins} />
          </Map>
        </View>
      )}
      {pins.map((p) => (
        <Pressable
          key={p.n}
          onPress={() => go(p)}
          accessibilityLabel={`Ir a ${p.name}`}
          className="flex-row items-center px-3 py-2.5 border-t border-brand-border active:opacity-60"
        >
          <View className="w-6 h-6 rounded-full items-center justify-center mr-3" style={{ backgroundColor: COLORS.mint }}>
            <Text className="font-mono-bold text-xs" style={{ color: COLORS.bg }}>
              {p.n}
            </Text>
          </View>
          <View className="flex-1">
            <Text className="text-brand-text font-mono text-xs" numberOfLines={1}>
              {p.name}
            </Text>
            <Text className="text-brand-muted font-mono text-[10px]" numberOfLines={1}>
              {p.detail}
              {km(p.distanceKm)}
            </Text>
          </View>
          <MaterialCommunityIcons name="navigation-variant-outline" size={18} color={COLORS.mint} />
        </Pressable>
      ))}
      <Pressable
        onPress={showAll}
        className="flex-row items-center justify-center gap-2 h-12 active:opacity-70"
        style={{ backgroundColor: COLORS.mint }}
        accessibilityRole="button"
      >
        <MaterialCommunityIcons name="map-outline" size={20} color={COLORS.bg} />
        <Text className="font-mono-bold text-sm" style={{ color: COLORS.bg }}>
          Ver en el mapa
        </Text>
      </Pressable>
    </View>
  );
}
