// Confirmation before a DID sweep (did_probe, mode scan; docs/plans/herramienta-did-probe.md):
// every sweep is confirmed, with the module, how many DIDs and how long it takes.
// Read-only, but it asks a module hundreds of questions, so the user decides.

import { Modal, Pressable, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { confirmationText, DEFAULT_RANGE, rangePlan } from '@/domain/obd/did-probe';
import { COLORS } from '@/presentation/theme';
import { useConfirmStore } from '@/store/confirmStore';

export function ProbeScanModal() {
  const request = useConfirmStore((s) => s.request);
  const answer = useConfirmStore((s) => s.answer);
  const call = request?.call.name === 'did_probe' && request.call.mode === 'scan' ? request.call : null;

  const from = call?.from ?? DEFAULT_RANGE.from;
  const to = call?.to ?? DEFAULT_RANGE.to;
  const plan = call ? rangePlan(from, to) : null;
  const count = plan?.ok ? plan.dids.length : 0;
  const outside = plan?.ok ? plan.outsideDefault : false;

  return (
    <Modal visible={call != null} transparent animationType="fade" statusBarTranslucent onRequestClose={() => answer(false)}>
      <View className="flex-1 bg-black/80 items-center justify-center px-6">
        <View className="w-full max-w-[420px] bg-brand-surface border border-brand-border rounded-2xl p-6">
          <View className="items-center mb-4">
            <MaterialCommunityIcons name="magnify-scan" size={32} color={COLORS.mint} />
            <Text className="text-brand-text font-mono-bold text-base mt-3 text-center">¿Barrer los DIDs de este módulo?</Text>
          </View>
          <Text className="text-brand-text font-mono text-xs leading-5 mb-3">{call ? confirmationText(call.header, count) : ''}</Text>
          <Text className="text-brand-muted font-mono text-xs leading-5 mb-1">
            Rango {from}–{to}. La app compara los códigos de falla antes y después, porque algunos módulos registran un error
            de comunicación cuando les llegan muchas preguntas.
          </Text>
          {outside && (
            <View className="flex-row items-start gap-2 mt-2">
              <MaterialCommunityIcons name="alert-outline" size={14} color={COLORS.amber} style={{ marginTop: 2 }} />
              <Text className="text-brand-amber font-mono text-xs leading-5 flex-1">
                Es un rango del fabricante, fuera de los DIDs estándar (F100–F1FF).
              </Text>
            </View>
          )}
          <View className="flex-row gap-3 mt-6">
            <Pressable onPress={() => answer(false)} className="flex-1 border border-brand-border rounded-xl py-3 items-center active:opacity-70">
              <Text className="text-brand-text font-mono-bold text-sm">Cancelar</Text>
            </Pressable>
            <Pressable onPress={() => answer(true)} className="flex-1 rounded-xl py-3 items-center active:opacity-70" style={{ backgroundColor: COLORS.mint }}>
              <Text className="font-mono-bold text-sm" style={{ color: COLORS.bg }}>
                Barrer
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
