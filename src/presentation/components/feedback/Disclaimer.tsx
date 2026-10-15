// First-run safety acknowledgment.
// AR guidance is drawn over the live road, so the user must accept, once, that
// it is an aid that can be wrong and that the phone stays mounted and untouched
// while driving. Persisted in settingsStore (MMKV).

import { Modal, View, Text, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '@/presentation/theme';
import { useSettingsStore } from '@/store/settingsStore';

const DISCLAIMER_BODY =
  'OBDient2 dibuja la ruta sobre la imagen de la cámara como ayuda. Puede estar desalineada o equivocada: ' +
  'el tránsito, las señales y tu propia vista siempre mandan. Monta el teléfono en un soporte fijo antes de ' +
  'arrancar, que no tape tu visión, y no lo manipules mientras conduces.';

export function DisclaimerGate() {
  const accepted = useSettingsStore((s) => s.disclaimerAccepted);
  const accept = useSettingsStore((s) => s.setDisclaimerAccepted);

  return (
    <Modal
      visible={!accepted}
      transparent
      animationType="fade"
      statusBarTranslucent
      // Android back button must not dismiss the gate without acknowledgment.
      onRequestClose={() => {}}
    >
      <View className="flex-1 bg-black/80 items-center justify-center px-6">
        <View className="w-full max-w-[420px] bg-brand-surface border border-brand-border rounded-2xl p-6">
          <View className="items-center mb-4">
            <MaterialCommunityIcons name="alert-outline" size={32} color={COLORS.mint} />
            <Text className="text-brand-text font-mono-bold text-base mt-3 text-center">
              Asistencia, no piloto automático
            </Text>
          </View>
          <Text className="text-brand-muted font-mono text-xs leading-5 mb-6">{DISCLAIMER_BODY}</Text>
          <Pressable
            onPress={() => accept(true)}
            className="bg-brand-pill rounded-xl py-3 items-center active:opacity-70"
          >
            <Text className="font-mono-bold text-sm" style={{ color: COLORS.bg }}>
              Entendido
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
