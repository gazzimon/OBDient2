// Fault history (M2.5 / M3.3): what codes each car had, when they showed up
// and went away, freeze frames, and every clear. Newest first. It fills as the
// assistant reads the car; no adapter is needed to look at it.

import { useCallback, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { container } from '@/data/container';
import type { FaultEvent } from '@/domain/faults/fault-history';
import { COLORS } from '@/presentation/theme';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

const KIND: Record<string, string> = { stored: 'guardados', pending: 'pendientes', permanent: 'permanentes' };

function describe(e: FaultEvent): { icon: IconName; color: string; title: string; lines: string[] } {
  const km = (v: number | null) => (v == null ? null : `${Math.round(v).toLocaleString('es-AR')} km desde el borrado`);
  switch (e.type) {
    case 'codes':
      return {
        icon: e.codes.length ? 'engine-outline' : 'check-circle-outline',
        color: e.codes.length ? COLORS.amber : COLORS.mint,
        title: e.codes.length ? `Códigos ${KIND[e.kind]}: ${e.codes.map((c) => c.code).join(', ')}` : `Sin códigos ${KIND[e.kind]}`,
        lines: [
          e.lastSeenAt > e.at ? `Visto por última vez: ${new Date(e.lastSeenAt).toLocaleString('es-AR')}` : null,
          km(e.distSinceClearKm),
          e.codes.some((c) => c.owner === 'manufacturer') ? 'Incluye códigos del fabricante' : null,
        ].filter((l): l is string => l != null),
      };
    case 'freeze_frame':
      return {
        icon: 'camera-timer',
        color: COLORS.muted,
        title: `Freeze frame de ${e.dtc.code}`,
        lines: [Object.entries(e.values).map(([k, v]) => `${k} ${v.value} ${v.unit}`).join(' · ')],
      };
    case 'cleared':
      return {
        icon: 'delete-sweep-outline',
        color: COLORS.red,
        title: e.codesBefore.length ? `Borrado: ${e.codesBefore.map((c) => c.code).join(', ')}` : 'Códigos borrados',
        lines: [km(e.distSinceClearBeforeKm)?.replace('desde el borrado', 'desde el borrado anterior') ?? null].filter(
          (l): l is string => l != null,
        ),
      };
  }
}

export default function FaultsScreen() {
  const router = useRouter();
  const [events, setEvents] = useState<readonly FaultEvent[]>([]);
  useFocusEffect(useCallback(() => setEvents(container.faults.list()), []));

  return (
    <SafeAreaView className="flex-1 bg-brand-bg" edges={['top']}>
      <View className="flex-row items-center gap-3 px-4 py-3 border-b border-brand-border">
        <Pressable onPress={() => router.back()} hitSlop={8} className="active:opacity-60">
          <MaterialCommunityIcons name="arrow-left" size={22} color={COLORS.text} />
        </Pressable>
        <Text className="text-brand-text font-mono-bold text-base">Historial de fallas</Text>
      </View>
      <FlatList
        className="flex-1 px-4"
        contentContainerStyle={{ paddingVertical: 12 }}
        data={events as FaultEvent[]}
        keyExtractor={(e, i) => `${e.type}-${e.at}-${i}`}
        ListEmptyComponent={
          <Text className="text-brand-muted font-mono text-xs leading-5 mt-6 text-center">
            Todavía no hay registros. Se completa solo cuando el asistente lee o borra los códigos del auto.
          </Text>
        }
        renderItem={({ item }) => {
          const d = describe(item);
          return (
            <View className="flex-row gap-3 bg-brand-surface rounded-2xl px-4 py-3 mb-2">
              <MaterialCommunityIcons name={d.icon} size={18} color={d.color} style={{ marginTop: 1 }} />
              <View className="flex-1">
                <Text className="text-brand-text font-mono text-sm">{d.title}</Text>
                <Text className="text-brand-muted font-mono text-[10px] mt-0.5">
                  {new Date(item.at).toLocaleString('es-AR')}
                  {item.vin ? ` · ${item.vin}` : ''}
                </Text>
                {d.lines.map((l) => (
                  <Text key={l} className="text-brand-muted font-mono text-[10px] leading-4">
                    {l}
                  </Text>
                ))}
              </View>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}
