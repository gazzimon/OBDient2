// Sign in with an email code (ADR-0008): the user types the address, Magic
// emails a code and shows its own screen to enter it (and, on a new phone,
// asks to approve the device by email).

import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { PillButton } from '@/presentation/components/layout/PillButton';
import { useAccount } from '@/presentation/hooks/useAccount';
import { COLORS } from '@/presentation/theme';

export function EmailSignIn() {
  const { status, busy, error, signIn } = useAccount();
  const [email, setEmail] = useState('');
  const ready = email.trim().length > 4 && status !== 'loading';
  return (
    <View>
      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="tu@correo.com"
        placeholderTextColor={COLORS.muted}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        editable={!busy}
        onSubmitEditing={() => ready && void signIn(email)}
        className="bg-brand-bg border border-brand-border rounded-xl px-4 py-3 text-brand-text font-mono text-sm mb-3"
      />
      <PillButton label="Enviarme un código" loading={busy} disabled={!ready} onPress={() => void signIn(email)} />
      {error && <Text className="text-brand-red font-mono text-xs mt-2">{error}</Text>}
    </View>
  );
}
