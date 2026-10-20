// "Mis viajes": the trips recorded by themselves, newest first (a simple
// list, decision 2026-10-20). Tap one for its map and details.

import { FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Trip } from '@/domain/trips/trip-builder';
import { dayLabel, tripName } from '@/domain/trips/trip-views';
import { formatDistance, formatDuration } from '@/presentation/format';
import { useTrips } from '@/presentation/services/my-trips';
import { COLORS } from '@/presentation/theme';

const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function tripSubtitle(t: Trip): string {
  const fuel = t.fuelL != null ? ` · ≈${String(t.fuelL.toFixed(1)).replace('.', ',')} L` : '';
  return `${formatDistance(t.distanceM)} · ${formatDuration(t.movingS)}${fuel}`;
}

export default function TripsScreen() {
  const list = useTrips();
  return (
    <SafeAreaView className="flex-1 bg-brand-bg" edges={['top', 'bottom']}>
      <View className="flex-row items-center px-4 py-3 border-b border-brand-border">
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Volver" className="mr-3 active:opacity-60">
          <MaterialCommunityIcons name="arrow-left" size={22} color={COLORS.text} />
        </Pressable>
        <Text className="text-brand-text font-mono-bold text-base flex-1">Mis viajes</Text>
      </View>
      <FlatList
        data={list as Trip[]}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={
          <View className="items-center mt-16 px-6">
            <MaterialCommunityIcons name="map-marker-path" size={36} color={COLORS.mint} />
            <Text className="text-brand-text font-mono-bold text-sm mt-3">Todavía no hay viajes</Text>
            <Text className="text-brand-muted font-mono text-xs text-center leading-5 mt-2">
              Se graban solos cuando manejás con el adaptador conectado y la app abierta.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/trip/${item.id}`)}
            className="bg-brand-surface border border-brand-border rounded-2xl px-4 py-3 mb-2 active:opacity-60"
          >
            <Text className="text-brand-muted font-mono text-[11px]">
              {dayLabel(item.startedAt)} · {hhmm(item.startedAt)}–{hhmm(item.endedAt)}
            </Text>
            <Text className="text-brand-text font-mono text-sm mt-1" numberOfLines={1}>
              {tripName(item)}
            </Text>
            <View className="flex-row items-center mt-1">
              <Text className="text-brand-mint font-mono text-xs flex-1">{tripSubtitle(item)}</Text>
              {item.codes?.length ? (
                <View className="flex-row items-center gap-1">
                  <MaterialCommunityIcons name="engine-outline" size={14} color={COLORS.amber} />
                  <Text className="text-brand-amber font-mono text-[11px]">{item.codes.join(', ')}</Text>
                </View>
              ) : null}
            </View>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}
