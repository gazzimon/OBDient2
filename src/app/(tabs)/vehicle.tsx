// OBD adapter: scan, connect, and the live telemetry the AR uses.

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { container } from '@/data/container';
import { formatBench } from '@/data/obd/adapter-bench';
import { looksLikeObd } from '@/data/obd/obd-manager';
import type { RequestStyle } from '@/data/obd/telemetry-poller';
import type { ScannedDevice } from '@/data/adapters/ble-transport';
import { ConnectionStatus } from '@/presentation/components/feedback/ConnectionStatus';
import { PillButton } from '@/presentation/components/layout/PillButton';
import { SectionHeader } from '@/presentation/components/layout/SectionHeader';
import { COLORS } from '@/presentation/theme';
import { useOBDStore } from '@/store/obdStore';

const SCAN_MS = 10_000;

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
  const [devices, setDevices] = useState<ScannedDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const stopScan = useRef<(() => void) | null>(null);

  const scan = async () => {
    setDevices([]);
    setScanError(null);
    setScanning(true);
    try {
      stopScan.current = await container.obd.scan((d) =>
        setDevices((prev) => (prev.some((p) => p.id === d.id) ? prev : [...prev, d])),
      );
      setTimeout(() => endScan(), SCAN_MS);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'No se pudo buscar');
      setScanning(false);
    }
  };

  const endScan = () => {
    stopScan.current?.();
    stopScan.current = null;
    setScanning(false);
  };

  useEffect(() => endScan, []);

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

  const connect = (d: ScannedDevice) => {
    endScan();
    void container.obd.connect(d.id, d.name).catch(() => undefined);
  };

  // Adapters first, then anything with a name, unnamed last.
  const sorted = [...devices].sort(
    (a, b) => Number(looksLikeObd(b.name)) - Number(looksLikeObd(a.name)) || Number(b.name != null) - Number(a.name != null),
  );

  return (
    <SafeAreaView className="flex-1 bg-brand-bg" edges={['top']}>
      <View className="flex-row items-center justify-between px-4 py-3">
        <ConnectionStatus state={connectionState} deviceName={deviceName} />
        {connectionState === 'connected' && (
          <Text className="text-brand-muted font-mono text-xs">velocidad {speedRateHz.toFixed(1)} Hz</Text>
        )}
      </View>

      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingBottom: 24 }}>
        {connectionState === 'connected' && session ? (
          <>
            <SectionHeader title="Adaptador" />
            <Text className="text-brand-muted font-mono text-[10px] mb-2">Los relojes en vivo están en la pestaña Tablero.</Text>
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
              <PillButton label={benching ? 'Midiendo…' : 'Ejecutar banco'} onPress={runBench} loading={benching} variant="secondary" />
              {bench && (
                <View className="bg-brand-surface rounded-2xl p-3 mt-3">
                  <Text selectable className="text-brand-text font-mono text-[10px] leading-4">
                    {bench}
                  </Text>
                  <View className="mt-3">
                    <PillButton
                      label="Compartir resultado"
                      variant="secondary"
                      onPress={() => void Share.share({ message: `OBDient2 · banco ${deviceName ?? ''}\n\n${bench}` })}
                    />
                  </View>
                </View>
              )}
            </View>

            <View className="mt-6">
              <PillButton label="Desconectar" variant="destructive" onPress={() => void container.obd.disconnect()} />
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

            <View className="mt-4 gap-2">
              {sorted.map((d) => (
                <Pressable
                  key={d.id}
                  onPress={() => connect(d)}
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
          </>
        )}
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
