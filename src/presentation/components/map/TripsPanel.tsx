// Mapa › Mis viajes: a simple list by day — "Origen → Destino · km · min" — and,
// for the trip picked, its figures under the map that draws it. Share (GPX) and
// delete wait behind "…".

import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Trip } from '@/domain/trips/trip-builder';
import { dayLabel, toGpx, tripName } from '@/domain/trips/trip-views';
import { formatDistance, formatDuration } from '@/presentation/format';
import { trips } from '@/presentation/services/my-trips';
import { BAND_COLOR } from './TripLayers';
import { COLORS } from '@/presentation/theme';

const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

type Row = { kind: 'day'; label: string } | { kind: 'trip'; trip: Trip };

function rows(list: readonly Trip[]): Row[] {
  const out: Row[] = [];
  let day: string | null = null;
  for (const t of list) {
    const label = dayLabel(t.startedAt);
    if (label !== day) out.push({ kind: 'day', label: (day = label) });
    out.push({ kind: 'trip', trip: t });
  }
  return out;
}

export function TripsPanel({ list, picked, onPick }: { list: readonly Trip[]; picked: Trip | null; onPick: (t: Trip | null) => void }) {
  if (picked) return <TripDetail trip={picked} onBack={() => onPick(null)} />;
  if (list.length === 0) {
    return (
      <Text className="text-brand-muted font-mono text-xs leading-5 py-3">
        Todavía no hay viajes. Cada vez que manejás (con el adaptador conectado o con Manejar abierto) queda guardado acá.
      </Text>
    );
  }
  return (
    <FlatList
      data={rows(list)}
      keyExtractor={(r) => (r.kind === 'day' ? `d:${r.label}` : r.trip.id)}
      renderItem={({ item }) =>
        item.kind === 'day' ? (
          <Text className="text-brand-muted font-mono text-[10px] mt-2 mb-1">{item.label.toUpperCase()}</Text>
        ) : (
          <Pressable onPress={() => onPick(item.trip)} className="flex-row items-center gap-2 py-2.5 border-b border-brand-border active:opacity-60">
            <View className="flex-1">
              <Text className="text-brand-text font-mono text-xs" numberOfLines={1}>
                {tripName(item.trip)}
              </Text>
              <Text className="text-brand-muted font-mono text-[10px] mt-0.5">
                {hhmm(item.trip.startedAt)} · {formatDistance(item.trip.distanceM)} · {formatDuration(item.trip.movingS)}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={18} color={COLORS.muted} />
          </Pressable>
        )
      }
    />
  );
}

function TripDetail({ trip, onBack }: { trip: Trip; onBack: () => void }) {
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
  const more = () =>
    Alert.alert(tripName(trip), undefined, [
      { text: 'Compartir (GPX)', onPress: () => void share() },
      {
        text: 'Borrar viaje',
        style: 'destructive',
        onPress: () => {
          trips.remove(trip.id);
          onBack();
        },
      },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  const stats: [string, string][] = [
    ['Distancia', formatDistance(trip.distanceM)],
    ['En movimiento', formatDuration(trip.movingS)],
    ['Máxima', `${trip.maxKmh} km/h`],
    ...(trip.fuelL != null ? ([['Combustible', `≈${trip.fuelL.toFixed(1).replace('.', ',')} L`]] as [string, string][]) : []),
  ];
  return (
    <View>
      <View className="flex-row items-center gap-2">
        <Pressable onPress={onBack} hitSlop={8} accessibilityLabel="Volver a Mis viajes" className="active:opacity-60">
          <MaterialCommunityIcons name="arrow-left" size={20} color={COLORS.text} />
        </Pressable>
        <View className="flex-1">
          <Text className="text-brand-text font-mono-bold text-sm" numberOfLines={1}>
            {tripName(trip)}
          </Text>
          <Text className="text-brand-muted font-mono text-[10px]">
            {dayLabel(trip.startedAt)} · {hhmm(trip.startedAt)}–{hhmm(trip.endedAt)}
          </Text>
        </View>
        <Pressable onPress={more} hitSlop={8} accessibilityLabel="Más opciones" className="active:opacity-60">
          <MaterialCommunityIcons name="dots-horizontal" size={22} color={COLORS.text} />
        </Pressable>
      </View>
      <View className="flex-row flex-wrap gap-2 mt-3">
        {stats.map(([k, v]) => (
          <View key={k} className="bg-brand-bg rounded-xl px-3 py-2" style={{ minWidth: '30%' }}>
            <Text className="text-brand-muted font-mono text-[10px]">{k}</Text>
            <Text className="text-brand-text font-mono-bold text-xs">{v}</Text>
          </View>
        ))}
      </View>
      <View className="flex-row gap-3 mt-3">
        <Legend color={BAND_COLOR.slow} label="< 30 km/h" />
        <Legend color={BAND_COLOR.mid} label="30–70" />
        <Legend color={BAND_COLOR.fast} label="> 70" />
      </View>
      {trip.codes?.length ? <Text className="text-brand-amber font-mono text-[11px] mt-2">Códigos leídos en este viaje: {trip.codes.join(', ')}</Text> : null}
    </View>
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
