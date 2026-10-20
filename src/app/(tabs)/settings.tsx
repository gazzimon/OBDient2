// Preferences, AR calibration entry point and service endpoints.

import { useCallback, useState, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { container } from '@/data/container';
import type { TripFileInfo } from '@/data/recording/trip-recorder';
import { EmailSignIn } from '@/presentation/components/feedback/EmailSignIn';
import { useAccount } from '@/presentation/hooks/useAccount';
import { PillButton } from '@/presentation/components/layout/PillButton';
import { SectionHeader } from '@/presentation/components/layout/SectionHeader';
import { COLORS } from '@/presentation/theme';
import { DEFAULT_ENDPOINTS, useSettingsStore } from '@/store/settingsStore';
import { PermissionsPanel } from '@/presentation/components/permissions/PermissionsPanel';

export default function SettingsScreen() {
  const router = useRouter();
  const s = useSettingsStore();
  const [endpoints, setEndpoints] = useState({
    routingUrl: s.routingUrl,
    geocoderUrl: s.geocoderUrl,
    mapStyleUrl: s.mapStyleUrl,
  });
  const [trips, setTrips] = useState<TripFileInfo[]>([]);
  const shareTrip = async (t: TripFileInfo) => {
    try {
      await Sharing.shareAsync(container.trips.uri(t.name), { mimeType: 'text/plain', dialogTitle: t.name });
    } catch (err) {
      console.warn('[Settings] trip not shared:', err);
    }
  };
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
        <SectionHeader title="Permisos" />
        <PermissionsPanel />

        <SectionHeader title="Guía" />
        <Row label="Instrucciones por voz">
          <Switch value={s.voiceEnabled} onValueChange={s.setVoiceEnabled} trackColor={{ true: COLORS.mintDark }} thumbColor={COLORS.text} />
        </Row>
        <Row label="Datos técnicos en manejo">
          <Switch value={s.debugOverlay} onValueChange={s.setDebugOverlay} trackColor={{ true: COLORS.mintDark }} thumbColor={COLORS.text} />
        </Row>

        <SectionHeader title="Mis viajes" />
        <Row label="Guardar mis viajes">
          <Switch value={s.recordMyTrips} onValueChange={s.setRecordMyTrips} trackColor={{ true: COLORS.mintDark }} thumbColor={COLORS.text} />
        </Row>
        <Text className="text-brand-muted font-mono text-[10px] leading-4 mb-2">
          Con el adaptador conectado y la app abierta, cada viaje queda con su recorrido, distancia, tiempos,
          paradas y consumo estimado. Solo en este teléfono.
        </Text>
        <Pressable
          onPress={() => router.push('/trips')}
          className="flex-row items-center bg-brand-surface rounded-2xl px-4 py-3 mb-6 active:opacity-60"
        >
          <MaterialCommunityIcons name="map-marker-path" size={18} color={COLORS.mint} />
          <Text className="text-brand-text font-mono text-sm ml-3 flex-1">Ver mis viajes</Text>
          <MaterialCommunityIcons name="chevron-right" size={18} color={COLORS.muted} />
        </Pressable>

        {/* Disclosure, not a switch: the lab monitors its vehicles while the adapter is connected. */}
        <Text className="text-brand-muted font-mono text-[10px] leading-4 mb-6">
          Monitoreo del laboratorio: mientras el adaptador está conectado, la posición del auto se envía al servidor de la
          Fundación{s.trackingDevice ? ` (dispositivo ${s.trackingDevice})` : ''}.
        </Text>

        <SectionHeader title="Laboratorio" />
        <Row label="Modo laboratorio (diagnóstico avanzado)">
          <Switch value={s.labMode} onValueChange={s.setLabMode} trackColor={{ true: COLORS.mintDark }} thumbColor={COLORS.text} />
        </Row>
        <Text className="text-brand-muted font-mono text-[10px] leading-4 mb-6">
          Habilita barrer los módulos del auto y, con el auto detenido, enviar comandos de solo lectura al bus (UDS/STN)
          desde el chat. No escribe, borra ni reprograma nada. Para desarrollo de M9.
        </Text>

        <SectionHeader title="Registro técnico (desarrollo)" />
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
                  <Text className="text-brand-muted font-mono text-[10px]">
                    {(t.sizeBytes / 1e6).toFixed(1)} MB
                  </Text>
                </View>
                <Pressable
                  hitSlop={8}
                  accessibilityLabel={`Compartir ${t.name}`}
                  onPress={() => void shareTrip(t)}
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

        <AccountSection />

        <SectionHeader title="Acerca de" />
        <Text className="text-brand-muted font-mono text-[10px] leading-4">
          OBDient2 · mapas © OpenStreetMap contributors, OpenMapTiles, OpenFreeMap · rutas OSRM · búsqueda Photon ·
          códigos de falla: OBDex (github.com/foerbsnavi/OBDex, CC0).
          {'\n'}Asistencia a la conducción: no reemplaza tu atención ni las señales de tránsito.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ADR-0008: email account for the assistant; sign out; delete account.
function AccountSection() {
  const { status, profile, busy, error, signOut, deleteAccount } = useAccount();
  const confirmDelete = () =>
    Alert.alert(
      'Borrar cuenta',
      'Se borra tu cuenta, su acceso al asistente y los datos guardados en ella. No se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Borrar', style: 'destructive', onPress: () => void deleteAccount() },
      ],
    );
  return (
    <>
      <SectionHeader title="Cuenta" />
      {status === 'signed-in' && profile ? (
        <>
          <Text className="text-brand-text font-mono text-sm mb-3">{profile.email}</Text>
          <View className="flex-row gap-3 mb-2">
            <View className="flex-1">
              <PillButton label="Cerrar sesión" variant="secondary" loading={busy} onPress={() => void signOut()} />
            </View>
            <View className="flex-1">
              <PillButton label="Borrar cuenta" variant="destructive" disabled={busy} onPress={confirmDelete} />
            </View>
          </View>
        </>
      ) : (
        <>
          <Text className="text-brand-muted font-mono text-[10px] leading-4 mb-3">
            Con tu cuenta usás el asistente. Entrás con un código que te llega por correo. Sin cuenta, todo lo demás
            funciona igual.
          </Text>
          <EmailSignIn />
        </>
      )}
      {status === 'signed-in' && error && <Text className="text-brand-red font-mono text-xs mt-2">{error}</Text>}
      <View className="mb-6" />
    </>
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
