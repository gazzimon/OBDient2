// First-run sign-in offer (ADR-0008, email code), after the safety notice. Optional: the
// app navigates and reads the car without an account (ADR-0001); the account
// is what unlocks the assistant. "Ahora no" is remembered; Settings → Cuenta
// signs in later.

import { Modal, Pressable, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '@/presentation/theme';
import { EmailSignIn } from '@/presentation/components/feedback/EmailSignIn';
import { useAccount } from '@/presentation/hooks/useAccount';
import { useSettingsStore } from '@/store/settingsStore';

export function AccountGate() {
  const disclaimerAccepted = useSettingsStore((s) => s.disclaimerAccepted);
  const dismissed = useSettingsStore((s) => s.accountPromptDismissed);
  const dismiss = useSettingsStore((s) => s.setAccountPromptDismissed);
  const { status, busy } = useAccount();

  return (
    <Modal
      visible={disclaimerAccepted && !dismissed && status === 'signed-out'}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => dismiss(true)}
    >
      <View className="flex-1 bg-black/80 items-center justify-center px-6">
        <View className="w-full max-w-[420px] bg-brand-surface border border-brand-border rounded-2xl p-6">
          <View className="items-center mb-4">
            <MaterialCommunityIcons name="account-circle-outline" size={32} color={COLORS.mint} />
            <Text className="text-brand-text font-mono-bold text-base mt-3 text-center">Tu cuenta</Text>
          </View>
          <Text className="text-brand-muted font-mono text-xs leading-5 mb-4">
            Con tu cuenta usás el asistente: preguntale por tu auto y lee los datos del adaptador. Te mandamos un código
            por correo; en un teléfono nuevo también te pedimos aprobarlo. La navegación y el adaptador OBD funcionan
            igual sin cuenta.
          </Text>
          <EmailSignIn />
          <Pressable onPress={() => dismiss(true)} disabled={busy} className="py-3 mt-2 items-center active:opacity-60">
            <Text className="text-brand-muted font-mono text-sm">Ahora no</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
