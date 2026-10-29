// OBD adapter: scan, connect, and the live telemetry the AR uses.

import { useState } from 'react';
import { ActivityIndicator, ScrollView, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { container } from '@/data/container';
import { formatBench } from '@/data/obd/adapter-bench';
import { formatCapture } from '@/data/obd/diagnostic-capture';
import { formatM7Bench } from '@/data/obd/m7-bench';
import { redactText } from '@/domain/privacy/redact';
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
  const [bench, setBench] = useState<string | null>(null);
  const [benching, setBenching] = useState(false);
  const [capture, setCapture] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [m7, setM7] = useState<string | null>(null);
  const { devices, scanning, nothingFound, scanError, scan, connect } = useAdapterScan();
  const router = useRouter();

  const runBench = async () => {
    setBenching(true);
    setBench(null);
    try {
      setBench(formatBench(await container.obd.runBench()));
    } catch (err) {
      setBench(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBenching(false);
    }
  };

  const runCapture = async () => {
    setCapturing(true);
    setCapture(null);
    try {
      setCapture(formatCapture(await container.obd.runCapture()));
    } catch (err) {
      setCapture(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCapturing(false);
    }
  };

  const runM7 = async () => {
    setMeasuring(true);
    setM7(null);
    try {
      setM7(formatM7Bench(await container.obd.runM7Bench()));
    } catch (err) {
      setM7(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setMeasuring(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-brand-bg" edges={['top']}>
      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingBottom: 24 }}>
        {connectionState === 'connected' && session ? (
          <>
            <SectionHeader title="Adaptador" />
            <Text className="text-brand-muted font-mono text-[10px] mb-2">Los relojes en vivo están en la pestaña Tablero.</Text>
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
              <SectionHeader title="Banco del adaptador" />
              <Text className="text-brand-muted font-mono text-[10px] leading-4 mb-3">
                Identifica el chip y mide la velocidad real con cada método de petición. Pausa la telemetría unos
                segundos: hazlo con el auto detenido y el motor en marcha.
              </Text>
              <PillButton
                label={benching ? 'Midiendo…' : 'Ejecutar banco'}
                onPress={runBench}
                loading={benching}
                disabled={capturing || measuring}
                variant="secondary"
              />
              {bench && (
                <View className="bg-brand-surface rounded-2xl p-3 mt-3">
                  <Text selectable className="text-brand-text font-mono text-[10px] leading-4">
                    {bench}
                  </Text>
                  <View className="mt-3">
                    <PillButton
                      label="Compartir resultado"
                      variant="secondary"
                      onPress={() => void Share.share({ message: redactText(`OBDient2 · banco ${deviceName ?? ''}\n\n${bench}`) })}
                    />
                  </View>
                </View>
              )}
            </View>

            <View className="mt-6">
              <SectionHeader title="Captura de diagnóstico" />
              <Text className="text-brand-muted font-mono text-[10px] leading-4 mb-3">
                Lee códigos, freeze frame, readiness y VIN tal como los contesta este auto, con y sin encabezados,
                para que los parsers se escriban contra respuestas reales. Solo lectura: no borra nada. Tarda hasta
                un minuto; mejor con el motor en marcha y, si es posible, con algún código guardado.
              </Text>
              <PillButton
                label={capturing ? 'Capturando…' : 'Capturar diagnóstico'}
                onPress={runCapture}
                loading={capturing}
                disabled={benching || measuring}
                variant="secondary"
              />
              {capture && (
                <View className="bg-brand-surface rounded-2xl p-3 mt-3">
                  <Text selectable className="text-brand-text font-mono text-[10px] leading-4">
                    {capture}
                  </Text>
                  <View className="mt-3">
                    <PillButton
                      label="Compartir captura"
                      variant="secondary"
                      onPress={() => void Share.share({ message: redactText(`OBDient2 · ${deviceName ?? ''}\n\n${capture}`) })}
                    />
                  </View>
                </View>
              )}
            </View>

            <View className="mt-6">
              <SectionHeader title="Medición M7.0" />
              <Text className="text-brand-muted font-mono text-[10px] leading-4 mb-3">
                Mide cuántos datos por segundo da este auto con varios PIDs por pedido y cómo contesta el
                diagnóstico con STPX y STCSEGR. Solo lectura. Pausa la telemetría un par de minutos: con el
                auto detenido y el motor en marcha. Compartí el resultado completo.
              </Text>
              <PillButton
                label={measuring ? 'Midiendo…' : 'Medir M7.0'}
                onPress={runM7}
                loading={measuring}
                disabled={benching || capturing}
                variant="secondary"
              />
              {m7 && (
                <View className="bg-brand-surface rounded-2xl p-3 mt-3">
                  <Text selectable className="text-brand-text font-mono text-[10px] leading-4">
                    {m7}
                  </Text>
                  <View className="mt-3">
                    <PillButton
                      label="Compartir medición"
                      variant="secondary"
                      onPress={() => void Share.share({ message: redactText(`OBDient2 · M7.0 ${deviceName ?? ''}\n\n${m7}`) })}
                    />
                  </View>
                </View>
              )}
            </View>

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
          <PillButton label="Informe PDF" onPress={() => router.push('/report')} />
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
