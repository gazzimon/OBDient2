// Diagnóstico › En vivo (the Tablero tab until 2026-10-31): live gauges + metric
// grid, ported from OBDient, or the camera with the numbers on top.
// Real OBD data when connected; otherwise simulated values with a DEMO badge,
// so the screen can be checked without a car.

import { useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMockParameters } from '@/presentation/hooks/useMockParameters';
import { RPMGauge } from '@/presentation/components/gauges/RPMGauge';
import { SpeedGauge } from '@/presentation/components/gauges/SpeedGauge';
import { TempGauge } from '@/presentation/components/gauges/TempGauge';
import { VoltageGauge } from '@/presentation/components/gauges/VoltageGauge';
import { MetricCard } from '@/presentation/components/dashboard/MetricCard';
import { SectionHeader } from '@/presentation/components/layout/SectionHeader';
import { BackHeader } from '@/presentation/components/layout/BackHeader';
import { AlertBanner } from '@/presentation/components/feedback/AlertBanner';
import type { ObdParameterSnapshot } from '@/domain/entities/obd-parameter';
import { useOBDStore } from '@/store/obdStore';
import { useSettingsStore } from '@/store/settingsStore';
import { CameraHud } from '@/presentation/components/dashboard/CameraHud';
import { useFreeOrientationWhileFocused } from '@/presentation/hooks/useLandscape';

// Highest-priority active alert in the snapshot.
function findActiveAlert(params: ObdParameterSnapshot) {
  let warning: { key: string; message: string } | null = null;
  for (const param of Object.values(params)) {
    if (param.alert == null) continue;
    const entry = { key: `${param.pid}:${param.alert.severity}`, message: param.alert.message };
    if (param.alert.severity === 'critical') return { ...entry, severity: 'critical' as const };
    warning = entry;
  }
  return warning != null ? { ...warning, severity: 'warning' as const } : null;
}

export default function DashboardScreen() {
  const router = useRouter();
  const connectionState = useOBDStore((s) => s.connectionState);
  const liveParams = useOBDStore((s) => s.parameters);
  const isConnected = connectionState === 'connected';
  const mockParams = useMockParameters();
  const [dismissedAlertKey, setDismissedAlertKey] = useState<string | null>(null);

  const params = isConnected ? liveParams : mockParams;
  const activeAlert = findActiveAlert(params);
  const showBanner = activeAlert != null && activeAlert.key !== dismissedAlertKey;
  const camera = useSettingsStore((s) => s.dashboardCamera);
  // The camera view follows the phone (upright or sideways in the mount).
  useFreeOrientationWhileFocused(camera);

  return (
    <SafeAreaView className="flex-1 bg-brand-bg" edges={['top']}>
      {/* Without the adapter the numbers are a demo: back to Diagnóstico to connect. */}
      <BackHeader
        title="En vivo"
        right={
          !isConnected && (
            <Pressable onPress={() => router.back()} className="px-2 py-0.5 rounded-md border border-brand-muted active:opacity-60">
              <Text className="text-brand-muted font-mono text-xs">DEMO · conectar</Text>
            </Pressable>
          )
        }
      />

      <ViewSwitch camera={camera} />

      {camera ? (
        <CameraHud />
      ) : (
        <>
      {showBanner && (
        <AlertBanner
          severity={activeAlert.severity}
          message={activeAlert.message}
          onDismiss={() => setDismissedAlertKey(activeAlert.key)}
        />
      )}

      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        <SectionHeader title="En vivo" />

        <View className="flex-row justify-between mb-2">
          <RPMGauge param={params.RPM} />
          <SpeedGauge param={params.SPEED} />
        </View>
        <View className="flex-row justify-between mb-6">
          <TempGauge param={params.COOLANT_TEMP} />
          <VoltageGauge param={params.VOLTAGE} />
        </View>

        <SectionHeader title="Motor" />

        <View className="flex-row gap-3 mb-3">
          <MetricCard icon="engine-outline" label="Carga" param={params.ENGINE_LOAD} />
          <MetricCard icon="weather-windy" label="MAF" param={params.MAF} />
        </View>
        <View className="flex-row gap-3">
          <MetricCard icon="speedometer-slow" label="Acelerador" param={params.TPS} />
          <MetricCard icon="thermometer-low" label="Aire admisión" param={params.IAT} />
        </View>
      </ScrollView>
        </>
      )}
    </SafeAreaView>
  );
}

// Medidores | Cámara
function ViewSwitch({ camera }: { camera: boolean }) {
  const set = useSettingsStore((s) => s.setDashboardCamera);
  const tab = (on: boolean, label: string) => (
    <Pressable
      onPress={() => set(on)}
      accessibilityRole="tab"
      accessibilityState={{ selected: camera === on }}
      className="flex-1 h-9 rounded-xl items-center justify-center active:opacity-70"
      style={{ backgroundColor: camera === on ? '#2DE1A5' : 'transparent' }}
    >
      <Text className="font-mono-bold text-xs" style={{ color: camera === on ? '#0D0D0D' : '#9A9A9A' }}>
        {label}
      </Text>
    </Pressable>
  );
  return (
    <View className="flex-row mx-4 mb-2 p-1 rounded-2xl bg-brand-surface border border-brand-border">
      {tab(false, 'Medidores')}
      {tab(true, 'Cámara')}
    </View>
  );
}
