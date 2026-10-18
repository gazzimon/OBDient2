// Confirmation before the assistant clears trouble codes (ADR-0007 §5): the
// only destructive tool. Says what is lost, how long the car had run since the
// last clear, and warns (does not block) when the engine is running: many cars
// refuse then, and the assistant explains the refusal.

import { Modal, Pressable, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { container } from '@/data/container';
import { COLORS } from '@/presentation/theme';
import { useConfirmStore } from '@/store/confirmStore';
import { useOBDStore } from '@/store/obdStore';

export function ClearDtcsModal() {
  const request = useConfirmStore((s) => s.request);
  const answer = useConfirmStore((s) => s.answer);
  const rpm = useOBDStore((s) => s.parameters.RPM?.value ?? 0);
  const visible = request?.call.name === 'clear_dtcs';

  // What the history knows: the last reading's distance since clear, and the last clear.
  const events = visible ? container.faults.list() : [];
  const lastCodes = events.find((e) => e.type === 'codes');
  const lastClear = events.find((e) => e.type === 'cleared');
  const km = lastCodes?.type === 'codes' ? lastCodes.distSinceClearKm : null;

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={() => answer(false)}>
      <View className="flex-1 bg-black/80 items-center justify-center px-6">
        <View className="w-full max-w-[420px] bg-brand-surface border border-brand-border rounded-2xl p-6">
          <View className="items-center mb-4">
            <MaterialCommunityIcons name="delete-alert-outline" size={32} color={COLORS.red} />
            <Text className="text-brand-text font-mono-bold text-base mt-3 text-center">¿Borrar los códigos de falla?</Text>
          </View>
          <Text className="text-brand-muted font-mono text-xs leading-5 mb-3">
            Se borran los códigos, el freeze frame y el estado de los monitores de emisiones, y se apaga el testigo. Si la
            falla sigue, el código vuelve. Los monitores tardan varios días de manejo en completarse de nuevo: no lo hagas
            justo antes de una verificación técnica (VTV).
          </Text>
          {km != null && (
            <Text className="text-brand-text font-mono text-xs mb-1">Desde el último borrado: {Math.round(km).toLocaleString('es-AR')} km</Text>
          )}
          {lastClear && (
            <Text className="text-brand-text font-mono text-xs mb-1">
              Último borrado con la app: {new Date(lastClear.at).toLocaleDateString('es-AR')}
            </Text>
          )}
          {rpm > 0 && (
            <View className="flex-row items-start gap-2 mt-2">
              <MaterialCommunityIcons name="engine-outline" size={14} color={COLORS.amber} style={{ marginTop: 2 }} />
              <Text className="text-brand-amber font-mono text-xs leading-5 flex-1">
                El motor está en marcha. Muchos autos solo borran con el contacto puesto y el motor apagado.
              </Text>
            </View>
          )}
          <View className="flex-row gap-3 mt-6">
            <Pressable onPress={() => answer(false)} className="flex-1 border border-brand-border rounded-xl py-3 items-center active:opacity-70">
              <Text className="text-brand-text font-mono-bold text-sm">Cancelar</Text>
            </Pressable>
            <Pressable onPress={() => answer(true)} className="flex-1 rounded-xl py-3 items-center active:opacity-70" style={{ backgroundColor: COLORS.red }}>
              <Text className="font-mono-bold text-sm" style={{ color: COLORS.bg }}>
                Borrar
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
