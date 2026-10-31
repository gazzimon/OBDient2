// OBD adapter: scan, connect, and the live telemetry the AR uses.

import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import type { RequestStyle } from '@/data/obd/telemetry-poller';
import { PillButton } from '@/presentation/components/layout/PillButton';
import { SectionHeader } from '@/presentation/components/layout/SectionHeader';
import { COLORS } from '@/presentation/theme';
import { useOBDStore } from '@/store/obdStore';
import { AdapterList, NotFoundHelp } from '@/presentation/components/obd/AdapterList';
import { useAdapterScan } from '@/presentation/hooks/useAdapterScan';
import { connectionKeeper } from '@/presentation/services/connection-keeper';

const STYLE_LABEL: Record<RequestStyle, string> = {
  stpx: 'STPX (STN, rápido)',
  count: 'conteo de respuestas (CAN)',
  plain: 'estándar (lento)',
};

export default function VehicleScreen() {
  const { connectionState, deviceName, session, speedRateHz, requestStyle, adapterResets, error } =
    useOBDStore();
  const { devices, scanning, nothingFound, scanError, scan, connect } = useAdapterScan();
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-brand-bg" edges={['top']}>
      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingBottom: 24 }}>
        {connectionState === 'connected' && session ? (
          <>
            <SectionHeader title="Adaptador" />
                        <Info label="Adaptador" value={deviceName ?? '—'} />
            <Info label="Velocidad" value={`${speedRateHz.toFixed(1)} Hz`} />
            <Info label="Chip" value={session.identity.stn ?? `${session.identity.elm || 'ELM327'} (sin comandos STN)`} />
            <Info label="Protocolo" value={session.protocol} />
            <Info label="PIDs de motor" value={session.supportedPids.length ? session.supportedPids.join(', ') : 'sin descubrir'} />
            <Info label="Petición de velocidad" value={requestStyle ? STYLE_LABEL[requestStyle] : '—'} />
            {adapterResets > 0 && (
              <Info label="Reinicios por bajo voltaje" value={`${adapterResets} (recuperados)`} />
            )}

            <View className="mt-6">
              <PillButton label="Desconectar" variant="destructive" onPress={() => void connectionKeeper.userDisconnect()} />
            </View>
          </>
        ) : (
          <>
            <SectionHeader title="Adaptador OBD" />
            <Text className="text-brand-muted font-mono text-xs leading-5 mb-4">
              Opcional. Con el adaptador conectado, la velocidad viene del auto y la AR compensa frenadas y
              aceleraciones. Sin él, la navegación funciona con GPS.
            </Text>
            {connectionState === 'connecting' ? (
              <View className="flex-row items-center gap-3 py-4">
                <ActivityIndicator color={COLORS.mint} />
                <Text className="text-brand-text font-mono text-sm">Conectando con {deviceName ?? 'el adaptador'}…</Text>
              </View>
            ) : (
              <PillButton label={scanning ? 'Buscando…' : 'Buscar adaptador'} onPress={scan} loading={scanning} />
            )}
            {(error ?? scanError) && <Text className="text-brand-red font-mono text-xs mt-3">{error ?? scanError}</Text>}

            {nothingFound && <NotFoundHelp />}
            <AdapterList devices={devices} onPick={(d) => void connect(d)} />
          </>
        )}
        <View className="mt-6 gap-2">
          <SectionHeader title="Herramientas del taller" />
          <PillButton label="En vivo" onPress={() => router.push('/dashboard')} />
          <PillButton label="Informe PDF" variant="secondary" onPress={() => router.push('/report')} />
          <PillButton label="Historial de fallas" variant="secondary" onPress={() => router.push('/faults')} />
          <PillButton label="Sonido del motor" variant="secondary" onPress={() => router.push('/engine-sound')} />
          <PillButton label="Prueba 0–100" variant="secondary" onPress={() => router.push('/performance')} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between py-2 border-b border-brand-border">
      <Text className="text-brand-muted font-mono text-xs">{label}</Text>
      <Text className="text-brand-text font-mono text-xs flex-1 text-right ml-4" numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}
