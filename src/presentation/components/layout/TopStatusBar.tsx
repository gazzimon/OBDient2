// Always on top of the tabs (2026-10-29): which adapter and car are connected,
// and who is signed in. Each side opens a sheet with what you can do about
// it, so connecting, disconnecting, signing in and out never need a trip to
// Ajustes. Deleting the account stays in Ajustes: not one tap away.

import { useState, type ReactNode } from 'react';
import { Modal, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { linkStatus, type LinkTone } from '@/domain/obd/link-status';
import { maskVin } from '@/domain/privacy/redact';
import { carLabel } from '@/domain/vehicle/car-brief';
import { EmailSignIn } from '@/presentation/components/feedback/EmailSignIn';
import { PillButton } from '@/presentation/components/layout/PillButton';
import { useAccount } from '@/presentation/hooks/useAccount';
import { connectionKeeper } from '@/presentation/services/connection-keeper';
import { COLORS } from '@/presentation/theme';
import { useOBDStore } from '@/store/obdStore';
import { useSettingsStore } from '@/store/settingsStore';

// The model year only moves once a year: a value at load keeps render pure.
const LOADED_AT = Date.now();

const TONE_COLOR: Record<LinkTone, string> = { ok: COLORS.mint, busy: COLORS.amber, off: COLORS.muted };

function Dot({ tone }: { tone: LinkTone }) {
  const color = TONE_COLOR[tone];
  // Filled when connected, a ring while it works, hollow when off: not only colour.
  return (
    <View
      style={{
        width: 10,
        height: 10,
        borderRadius: 5,
        borderWidth: tone === 'busy' ? 3 : 1.5,
        borderColor: color,
        backgroundColor: tone === 'ok' ? color : 'transparent',
      }}
    />
  );
}

function useLink() {
  const obd = useOBDStore();
  const remembered = useSettingsStore((s) => s.lastDeviceName);
  const rememberedId = useSettingsStore((s) => s.lastDeviceId);
  const vinRead = obd.vin !== undefined;
  const car = vinRead ? carLabel(obd.vin ?? null, LOADED_AT) : undefined;
  const status = linkStatus({
    state: obd.connectionState,
    retrying: obd.retrying,
    stoppedByUser: obd.stoppedByUser,
    deviceName: obd.deviceName,
    rememberedName: remembered,
    remembered: rememberedId != null,
    car,
    vinRead,
  });
  return { obd, status, rememberedId };
}

export function TopStatusBar() {
  const { status } = useLink();
  const { status: account, profile, busy } = useAccount();
  const [sheet, setSheet] = useState<'adapter' | 'account' | null>(null);
  const signedIn = account === 'signed-in' && profile != null;
  // Sideways (camera on the Tablero) every pixel is the view: no bar.
  const { width, height } = useWindowDimensions();
  if (width > height) return null;

  return (
    <SafeAreaView edges={['top']} className="bg-brand-bg border-b border-brand-border">
      <View className="flex-row items-center justify-between px-4 h-10 gap-3">
        <Pressable
          onPress={() => setSheet('adapter')}
          accessibilityRole="button"
          accessibilityLabel={`Adaptador: ${status.text}`}
          hitSlop={6}
          className="flex-row items-center gap-2 flex-1 active:opacity-60"
        >
          <Dot tone={status.tone} />
          <Text numberOfLines={1} className="font-mono text-xs flex-shrink" style={{ color: status.tone === 'off' ? COLORS.muted : COLORS.text }}>
            {status.text}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setSheet('account')}
          accessibilityRole="button"
          accessibilityLabel={signedIn ? `Cuenta: ${profile.email}` : 'Entrar con tu cuenta'}
          hitSlop={6}
          className="flex-row items-center gap-2 max-w-[45%] active:opacity-60"
        >
          {signedIn ? (
            <>
              <View className="w-6 h-6 rounded-full bg-brand-surface border border-brand-border items-center justify-center">
                <Text className="text-brand-mint font-mono-bold text-[11px]">{profile.email.charAt(0).toUpperCase()}</Text>
              </View>
              <Text numberOfLines={1} className="text-brand-muted font-mono text-[11px] flex-shrink">
                {profile.email.split('@')[0]}
              </Text>
            </>
          ) : (
            <>
              <MaterialCommunityIcons name="account-circle-outline" size={18} color={COLORS.mint} />
              <Text className="text-brand-mint font-mono text-xs">Entrar</Text>
            </>
          )}
        </Pressable>
      </View>
      <Sheet visible={sheet === 'adapter'} onClose={() => setSheet(null)}>
        <AdapterSheet onClose={() => setSheet(null)} />
      </Sheet>
      {/* Magic's code screen is drawn under any Modal: the sheet steps aside while it is up. */}
      <Sheet visible={sheet === 'account' && !busy} onClose={() => setSheet(null)}>
        <AccountSheet onClose={() => setSheet(null)} />
      </Sheet>
    </SafeAreaView>
  );
}

function Sheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/60" onPress={onClose} accessibilityLabel="Cerrar" />
      <SafeAreaView edges={['bottom']} className="bg-brand-surface rounded-t-3xl border-t border-brand-border px-5 pt-5 pb-3">
        {children}
      </SafeAreaView>
    </Modal>
  );
}

function AdapterSheet({ onClose }: { onClose: () => void }) {
  const { obd, status, rememberedId } = useLink();
  const router = useRouter();
  const connected = obd.connectionState === 'connected';
  const goVehicle = () => {
    onClose();
    router.navigate('/vehicle');
  };
  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-2">
        <Dot tone={status.tone} />
        <Text className="text-brand-text font-mono-bold text-sm flex-1">{status.text}</Text>
      </View>
      {connected ? (
        <>
          {obd.vin && <Text className="text-brand-muted font-mono text-xs">VIN {maskVin(obd.vin)}</Text>}
          <Text className="text-brand-muted font-mono text-xs">
            {obd.session?.protocol ?? ''} · velocidad {obd.speedRateHz.toFixed(1)} Hz
          </Text>
          <PillButton label="Ver el adaptador" variant="secondary" onPress={goVehicle} />
          <PillButton
            label="Desconectar"
            variant="destructive"
            onPress={() => {
              void connectionKeeper.userDisconnect();
              onClose();
            }}
          />
        </>
      ) : (
        <>
          <Text className="text-brand-muted font-mono text-xs leading-5">
            {rememberedId
              ? 'La app lo busca sola al abrirse, al volver a ella y cuando se corta. Si el auto está apagado, dá contacto.'
              : 'Enchufá el adaptador en el conector OBD (bajo el volante), dá contacto y buscalo.'}
          </Text>
          {rememberedId && obd.connectionState === 'disconnected' && (
            <PillButton
              label="Buscar de nuevo"
              onPress={() => {
                connectionKeeper.retryNow();
                onClose();
              }}
            />
          )}
          <PillButton label={rememberedId ? 'Elegir otro adaptador' : 'Buscar adaptador'} variant={rememberedId ? 'secondary' : 'primary'} onPress={goVehicle} />
        </>
      )}
    </View>
  );
}

function AccountSheet({ onClose }: { onClose: () => void }) {
  const { status, profile, busy, error, signOut } = useAccount();
  const router = useRouter();
  if (status === 'signed-in' && profile) {
    return (
      <View className="gap-3">
        <Text className="text-brand-muted font-mono text-[10px]">Cuenta</Text>
        <Text className="text-brand-text font-mono-bold text-sm">{profile.email}</Text>
        <Text className="text-brand-muted font-mono text-xs leading-5">
          Con esta cuenta usás el asistente. Para entrar con otra, cerrá sesión y entrá de nuevo.
        </Text>
        <PillButton label="Cerrar sesión" variant="secondary" loading={busy} onPress={() => void signOut().then(onClose)} />
        <Pressable
          onPress={() => {
            onClose();
            router.navigate('/settings');
          }}
          className="py-2 items-center active:opacity-60"
        >
          <Text className="text-brand-muted font-mono text-xs">Borrar la cuenta: Ajustes → Cuenta</Text>
        </Pressable>
        {error && <Text className="text-brand-red font-mono text-xs">{error}</Text>}
      </View>
    );
  }
  return (
    <View className="gap-3">
      <Text className="text-brand-text font-mono-bold text-sm">Entrá con tu correo</Text>
      <Text className="text-brand-muted font-mono text-xs leading-5">
        Con tu cuenta usás el asistente. Te llega un código por correo. Sin cuenta, todo lo demás funciona igual.
      </Text>
      <EmailSignIn />
    </View>
  );
}
