// "Dónde estacioné" on the Ruta tab: where the car was left, how long ago and
// how far, a walking route in the phone's maps app, and "Ya lo encontré".

import { Linking, Pressable, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { LatLng } from '@/domain/geo/geo';
import { describeSpot, meters, type ParkingSpot } from '@/domain/parking/parking';
import { PillButton } from '@/presentation/components/layout/PillButton';
import { COLORS } from '@/presentation/theme';

// Worse than this, the card says how far off it can be.
const VAGUE_M = 50;

export function ParkedCard({
  spot,
  here,
  now,
  onFound,
  onClose,
}: {
  spot: ParkingSpot;
  here: LatLng | null;
  now: number;
  onFound: () => void;
  onClose: () => void;
}) {
  const view = describeSpot(spot, here, now);
  const walk = () =>
    void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${spot.lat},${spot.lng}&travelmode=walking`);
  return (
    <View className="absolute bottom-4 left-4 right-4 bg-brand-surface border border-brand-border rounded-2xl p-4">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <View className="w-6 h-6 rounded-md items-center justify-center" style={{ backgroundColor: COLORS.amber }}>
            <Text className="font-mono-bold text-xs" style={{ color: COLORS.bg }}>
              P
            </Text>
          </View>
          <Text className="text-brand-text font-mono-bold text-sm">{spot.car ? `Tu ${spot.car}` : 'Tu auto'}</Text>
        </View>
        <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Cerrar">
          <MaterialCommunityIcons name="close" size={18} color={COLORS.muted} />
        </Pressable>
      </View>
      <Text className="text-brand-text font-mono text-base mt-2">{view.where ?? 'Esperando GPS para la distancia…'}</Text>
      <Text className="text-brand-muted font-mono text-xs mt-1">
        Quedó {view.ago}
        {spot.accuracyM > VAGUE_M ? ` · puede errar ±${meters(spot.accuracyM)}` : ''}
      </Text>
      <Text className="text-brand-muted font-mono text-[10px] leading-4 mt-2">
        Es dónde estaba el teléfono cuando se cortó el Bluetooth con el adaptador.
      </Text>
      <View className="flex-row gap-3 mt-4">
        <View className="flex-1">
          <PillButton label="Ya lo encontré" variant="secondary" onPress={onFound} />
        </View>
        <View className="flex-1">
          <PillButton label={view.near ? 'Está acá' : 'Ir caminando'} onPress={walk} disabled={view.near} />
        </View>
      </View>
    </View>
  );
}
