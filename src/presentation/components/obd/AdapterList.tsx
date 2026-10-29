// The Bluetooth devices a scan found, adapters first: tap one to connect.

import { Pressable, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ScannedDevice } from '@/data/adapters/ble-transport';
import { looksLikeObd } from '@/data/obd/obd-manager';
import { COLORS } from '@/presentation/theme';

// A scan found no adapter: the usual reasons, cheapest first.
export function NotFoundHelp() {
  return (
    <View className="bg-brand-surface rounded-2xl p-4 mt-3">
      <Text className="text-brand-text font-mono-bold text-xs mb-2">No apareció ningún adaptador</Text>
      <Text className="text-brand-muted font-mono text-[11px] leading-5">
        - ¿Está bien enchufado? El conector OBD suele estar bajo el volante, a la izquierda.{'\n'}- ¿Está dado el
        contacto? Con el auto apagado del todo, el adaptador puede no encender.{'\n'}- ¿Prendió la luz del adaptador?
        {'\n'}- No lo empareja Android: se conecta desde acá. Si otra app lo está usando, cerrala.
      </Text>
    </View>
  );
}

export function AdapterList({ devices, onPick }: { devices: readonly ScannedDevice[]; onPick: (d: ScannedDevice) => void }) {
  return (
    <View className="mt-4 gap-2">
      {devices.map((d) => (
        <Pressable
          key={d.id}
          onPress={() => onPick(d)}
          className="flex-row items-center bg-brand-surface rounded-2xl px-4 py-3 active:opacity-60"
        >
          <MaterialCommunityIcons
            name={looksLikeObd(d.name) ? 'car-connected' : 'bluetooth'}
            size={18}
            color={looksLikeObd(d.name) ? COLORS.mint : COLORS.muted}
          />
          <View className="ml-3 flex-1">
            <Text className="text-brand-text font-mono text-sm">{d.name ?? 'Sin nombre'}</Text>
            <Text className="text-brand-muted font-mono text-[10px]">{d.id}</Text>
          </View>
          {d.rssi != null && <Text className="text-brand-muted font-mono text-[10px]">{d.rssi} dBm</Text>}
        </Pressable>
      ))}
    </View>
  );
}
