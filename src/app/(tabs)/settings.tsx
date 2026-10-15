// Preferences, AR calibration entry point and service endpoints.

import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { PillButton } from '@/presentation/components/layout/PillButton';
import { SectionHeader } from '@/presentation/components/layout/SectionHeader';
import { COLORS } from '@/presentation/theme';
import { DEFAULT_ENDPOINTS, useSettingsStore } from '@/store/settingsStore';

export default function SettingsScreen() {
  const router = useRouter();
  const s = useSettingsStore();
  const [endpoints, setEndpoints] = useState({
    routingUrl: s.routingUrl,
    geocoderUrl: s.geocoderUrl,
    mapStyleUrl: s.mapStyleUrl,
  });
  const dirty =
    endpoints.routingUrl !== s.routingUrl ||
    endpoints.geocoderUrl !== s.geocoderUrl ||
    endpoints.mapStyleUrl !== s.mapStyleUrl;

  return (
    <SafeAreaView className="flex-1 bg-brand-bg" edges={['top']}>
      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingTop: 12, paddingBottom: 32 }}>
        <SectionHeader title="Guía" />
        <Row label="Instrucciones por voz">
          <Switch value={s.voiceEnabled} onValueChange={s.setVoiceEnabled} trackColor={{ true: COLORS.mintDark }} thumbColor={COLORS.text} />
        </Row>
        <Row label="Datos técnicos sobre la AR">
          <Switch value={s.debugOverlay} onValueChange={s.setDebugOverlay} trackColor={{ true: COLORS.mintDark }} thumbColor={COLORS.text} />
        </Row>

        <SectionHeader title="Cámara AR" />
        <Pressable
          onPress={() => router.push('/calibrate')}
          className="flex-row items-center bg-brand-surface rounded-2xl px-4 py-3 mb-6 active:opacity-60"
        >
          <MaterialCommunityIcons name="crosshairs-gps" size={18} color={COLORS.mint} />
          <View className="ml-3 flex-1">
            <Text className="text-brand-text font-mono text-sm">Calibrar soporte</Text>
            <Text className="text-brand-muted font-mono text-[10px]">
              FOV {s.calibration.hfovDeg}° · altura {s.calibration.cameraHeightM} m · cabeceo {s.calibration.pitchOffsetDeg}°
            </Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={18} color={COLORS.muted} />
        </Pressable>

        <SectionHeader title="Servicios" />
        <Text className="text-brand-muted font-mono text-[10px] leading-4 mb-3">
          Los servidores públicos por defecto son solo para desarrollo. Para distribuir la app, apunta a servidores
          propios (por ejemplo OSRM y Photon en la Z440) o a un proveedor.
        </Text>
        <Field label="Rutas (OSRM)" value={endpoints.routingUrl} onChange={(v) => setEndpoints((e) => ({ ...e, routingUrl: v }))} />
        <Field label="Búsqueda (Photon)" value={endpoints.geocoderUrl} onChange={(v) => setEndpoints((e) => ({ ...e, geocoderUrl: v }))} />
        <Field label="Estilo de mapa" value={endpoints.mapStyleUrl} onChange={(v) => setEndpoints((e) => ({ ...e, mapStyleUrl: v }))} />
        <View className="flex-row gap-3 mt-2 mb-6">
          <View className="flex-1">
            <PillButton
              label="Por defecto"
              variant="secondary"
              onPress={() => {
                setEndpoints(DEFAULT_ENDPOINTS);
                s.setEndpoints(DEFAULT_ENDPOINTS);
              }}
            />
          </View>
          <View className="flex-1">
            <PillButton label="Guardar" disabled={!dirty} onPress={() => s.setEndpoints(endpoints)} />
          </View>
        </View>

        <SectionHeader title="Acerca de" />
        <Text className="text-brand-muted font-mono text-[10px] leading-4">
          OBDient2 · mapas © OpenStreetMap contributors, OpenMapTiles, OpenFreeMap · rutas OSRM · búsqueda Photon.
          {'\n'}Asistencia a la conducción: no reemplaza tu atención ni las señales de tránsito.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View className="flex-row items-center justify-between bg-brand-surface rounded-2xl px-4 py-2 mb-3">
      <Text className="text-brand-text font-mono text-sm">{label}</Text>
      {children}
    </View>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <View className="mb-3">
      <Text className="text-brand-muted font-mono text-[10px] mb-1">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        className="bg-brand-surface border border-brand-border rounded-xl px-3 py-2 text-brand-text font-mono text-xs"
      />
    </View>
  );
}
