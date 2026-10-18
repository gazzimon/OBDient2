// First-run sign-in offer (ADR-0008), after the safety notice. Optional: the
// app navigates and reads the car without an account (ADR-0001); the account
// is what unlocks the assistant. "Ahora no" is remembered; Settings → Cuenta
// signs in later.

import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '@/presentation/theme';
import { useAccount } from '@/presentation/hooks/useAccount';
import { useSettingsStore } from '@/store/settingsStore';

export function AccountGate() {
  const disclaimerAccepted = useSettingsStore((s) => s.disclaimerAccepted);
  const dismissed = useSettingsStore((s) => s.accountPromptDismissed);
  const dismiss = useSettingsStore((s) => s.setAccountPromptDismissed);
  const { status, busy, error, signIn } = useAccount();

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
          <Text className="text-brand-muted font-mono text-xs leading-5 mb-6">
            Con tu cuenta de Google usás el asistente: preguntale por tu auto y lee los datos del adaptador. La
            navegación y el adaptador OBD funcionan igual sin cuenta.
          </Text>
          {error && <Text className="text-brand-red font-mono text-xs mb-3">{error}</Text>}
          <Pressable
            onPress={() => void signIn()}
            disabled={busy}
            className="bg-brand-pill rounded-xl py-3 items-center active:opacity-70 flex-row justify-center gap-2"
          >
            {busy ? (
              <ActivityIndicator color={COLORS.bg} />
            ) : (
              <MaterialCommunityIcons name="google" size={18} color={COLORS.bg} />
            )}
            <Text className="font-mono-bold text-sm" style={{ color: COLORS.bg }}>
              Continuar con Google
            </Text>
          </Pressable>
          <Pressable onPress={() => dismiss(true)} disabled={busy} className="py-3 mt-2 items-center active:opacity-60">
            <Text className="text-brand-muted font-mono text-sm">Ahora no</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
