// Preferences, AR calibration entry point and service endpoints.

import { useCallback, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { container } from '@/data/container';
import { DETECTOR_MODELS } from '@/data/perception/detector-model';
import type { TripFileInfo } from '@/data/recording/trip-recorder';
import { PillButton } from '@/presentation/components/layout/PillButton';
import { SectionHeader } from '@/presentation/components/layout/SectionHeader';
import { COLORS } from '@/presentation/theme';
import { usePerceptionStore } from '@/store/perceptionStore';
import { DEFAULT_ENDPOINTS, useSettingsStore } from '@/store/settingsStore';

const DELEGATES = [
  { id: 'android-gpu', label: 'GPU' },
  { id: 'nnapi', label: 'NNAPI' },
  { id: 'cpu', label: 'CPU' },
] as const;

export default function SettingsScreen() {
  const router = useRouter();
  const s = useSettingsStore();
  const stats = usePerceptionStore((p) => p.stats);
  const [endpoints, setEndpoints] = useState({
    routingUrl: s.routingUrl,
    geocoderUrl: s.geocoderUrl,
    mapStyleUrl: s.mapStyleUrl,
  });
  const [trips, setTrips] = useState<TripFileInfo[]>([]);
  const refreshTrips = useCallback(() => {
    try {
      setTrips(container.trips.list());
    } catch {
      setTrips([]);
    }
  }, []);
  useFocusEffect(refreshTrips);

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

        <SectionHeader title="Detector" />
        <Row label="Alertas de vehículos y peatones">
          <Switch
            value={s.detectorEnabled}
            onValueChange={(on) => s.setDetector({ detectorEnabled: on })}
            trackColor={{ true: COLORS.mintDark }}
            thumbColor={COLORS.text}
          />
        </Row>
        <View className="flex-row gap-2 mb-2">
          {DETECTOR_MODELS.map((m) => (
            <Pressable
              key={m.id}
              onPress={() => s.setDetector({ detectorModelId: m.id })}
              className={`flex-1 rounded-xl py-2 items-center border ${
                s.detectorModelId === m.id ? 'border-brand-teal' : 'border-brand-border'
              } active:opacity-60`}
            >
              <Text className={`font-mono text-[11px] ${s.detectorModelId === m.id ? 'text-brand-teal' : 'text-brand-muted'}`}>
                {m.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <View className="flex-row gap-2 mb-2">
          {DELEGATES.map((d) => (
            <Pressable
              key={d.id}
              onPress={() => s.setDetector({ detectorDelegate: d.id })}
              className={`flex-1 rounded-xl py-2 items-center border ${
                s.detectorDelegate === d.id ? 'border-brand-teal' : 'border-brand-border'
              } active:opacity-60`}
            >
              <Text className={`font-mono text-xs ${s.detectorDelegate === d.id ? 'text-brand-teal' : 'text-brand-muted'}`}>
                {d.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text className="text-brand-muted font-mono text-[10px] leading-4 mb-3">
          {stats
            ? `Último uso: ${stats.inferenceMs.toFixed(0)} ms por imagen (modelo), ${stats.frameMs.toFixed(0)} ms en total, ${stats.fps.toFixed(1)} img/s · ${stats.delegate}`
            : 'Acelerador del modelo. Las estadísticas aparecen después de usar la guía AR.'}
        </Text>
        <Pressable
          onPress={() => router.push('/cameras')}
          className="flex-row items-center bg-brand-surface rounded-2xl px-4 py-3 mb-6 active:opacity-60"
        >
          <MaterialCommunityIcons name="camera-iris" size={18} color={COLORS.mint} />
          <View className="ml-3 flex-1">
            <Text className="text-brand-text font-mono text-sm">Cámaras del teléfono</Text>
            <Text className="text-brand-muted font-mono text-[10px]">Qué lentes expone este teléfono a las apps</Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={18} color={COLORS.muted} />
        </Pressable>

        <SectionHeader title="Viajes grabados" />
        <Row label="Grabar registro técnico al navegar">
          <Switch value={s.recordTrips} onValueChange={s.setRecordTrips} trackColor={{ true: COLORS.mintDark }} thumbColor={COLORS.text} />
        </Row>
        <Text className="text-brand-muted font-mono text-[10px] leading-4 mb-3">
          GPS, sensores, OBD y progreso de ruta, solo en este teléfono. Sirve para reproducir un viaje y depurar la
          AR. Unos 10 MB por hora.
        </Text>
        {trips.length === 0 ? (
          <Text className="text-brand-muted font-mono text-xs mb-6">Todavía no hay viajes grabados.</Text>
        ) : (
          <View className="mb-6 gap-2">
            {trips.map((t) => (
              <View key={t.name} className="flex-row items-center bg-brand-surface rounded-2xl px-4 py-3">
                <MaterialCommunityIcons name="map-marker-path" size={16} color={COLORS.mint} />
                <View className="ml-3 flex-1">
                  <Text className="text-brand-text font-mono text-xs">{t.name}</Text>
                  <Text className="text-brand-muted font-mono text-[10px]">{(t.sizeBytes / 1e6).toFixed(1)} MB</Text>
                </View>
                <Pressable
                  hitSlop={8}
                  accessibilityLabel={`Compartir ${t.name}`}
                  onPress={() =>
                    void Sharing.shareAsync(container.trips.uri(t.name), {
                      mimeType: 'text/plain',
                      dialogTitle: t.name,
                    }).catch(() => undefined)
                  }
                  className="mr-4 active:opacity-60"
                >
                  <MaterialCommunityIcons name="share-variant-outline" size={18} color={COLORS.text} />
                </Pressable>
                <Pressable
                  hitSlop={8}
                  accessibilityLabel={`Borrar ${t.name}`}
                  onPress={() => {
                    container.trips.remove(t.name);
                    refreshTrips();
                  }}
                  className="active:opacity-60"
                >
                  <MaterialCommunityIcons name="delete-outline" size={18} color={COLORS.red} />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <SectionHeader title="Servicios" />
        <Text className="text-brand-muted font-mono text-[10px] leading-4 mb-3">
          Por defecto, rutas y búsqueda propias (OSRM y Photon de Argentina en la Z440, vía obdient.duckdns.org).
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
