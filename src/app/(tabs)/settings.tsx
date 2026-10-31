// Ajustes (2026-10-31): what anyone uses — account, the assistant and the
// guidance, privacy, permissions — and, behind the Dev switch, every development
// tool. Switching Dev off turns those tools off (settingsStore.setDevMode).

import { useCallback, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import Constants from 'expo-constants';
import * as Sharing from 'expo-sharing';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { container } from '@/data/container';
import type { TripFileInfo } from '@/data/recording/trip-recorder';
import { checkServices, type HealthCheck } from '@/data/service-health';
import type { Audience } from '@/domain/assistant/next-questions';
import { EmailSignIn } from '@/presentation/components/feedback/EmailSignIn';
import { useAccount } from '@/presentation/hooks/useAccount';
import { PillButton } from '@/presentation/components/layout/PillButton';
import { SectionHeader } from '@/presentation/components/layout/SectionHeader';
import { COLORS } from '@/presentation/theme';
import { DEFAULT_ENDPOINTS, useSettingsStore } from '@/store/settingsStore';
import { PermissionsPanel } from '@/presentation/components/permissions/PermissionsPanel';

const AUDIENCE_LABEL: Record<Audience, string> = { driver: 'Conductor', workshop: 'Mecánico' };

export default function SettingsScreen() {
  const s = useSettingsStore();
  return (
    <SafeAreaView className="flex-1 bg-brand-bg" edges={['top']}>
      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingTop: 12, paddingBottom: 32 }}>
        <AccountSection />

        <SectionHeader title="Asistente y guía" />
        <View className="bg-brand-surface rounded-2xl px-4 py-3 mb-3">
          <Text className="text-brand-text font-mono text-sm mb-2">Perfil</Text>
          <View className="flex-row gap-2">
            {(['driver', 'workshop'] as const).map((a) => (
              <Pressable
                key={a}
                onPress={() => s.setAudience(a)}
                accessibilityRole="button"
                accessibilityState={{ selected: s.audience === a }}
                className="flex-1 h-9 rounded-full items-center justify-center border active:opacity-60"
                style={{ borderColor: s.audience === a ? COLORS.mint : COLORS.border, backgroundColor: s.audience === a ? COLORS.mintDark : 'transparent' }}
              >
                <Text className="text-brand-text font-mono text-xs">{AUDIENCE_LABEL[a]}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <Text className="text-brand-muted font-mono text-[10px] leading-4 mb-3">
          Mecánico: el asistente habla como en el taller (módulos, DIDs, documentación) y la pantalla inicial pone primero
          esas preguntas.
        </Text>
        <Row label="Instrucciones por voz">
          <Toggle value={s.voiceEnabled} onChange={s.setVoiceEnabled} />
        </Row>

        <SectionHeader title="Privacidad" />
        <Row label="Guardar mis viajes">
          <Toggle value={s.recordMyTrips} onChange={s.setRecordMyTrips} />
        </Row>
        <Note>Cada viaje queda con su recorrido, distancia, tiempos y paradas, solo en este teléfono. Los ves en la pestaña Mapa.</Note>
        {/* Opt-in (ADR-0011): where the car is, is personal. Off until the driver says yes. */}
        <Row label="Compartir mi recorrido con el laboratorio">
          <Toggle value={s.trackingConsent} onChange={s.setTrackingConsent} />
        </Row>
        <Note>
          Con el adaptador conectado, la app envía al servidor de la Fundación la posición, la velocidad y algunos valores
          del motor (RPM, temperatura, carga, batería), junto con tu cuenta y el modelo del auto. No envía el VIN completo
          ni la dirección del adaptador: llegan como un código que solo identifica a este teléfono. Podés apagarlo cuando
          quieras{s.trackingConsent && s.trackingDevice ? ` (código ${s.trackingDevice})` : ''}.
        </Note>
        <Row label="Compartir escaneos con el laboratorio">
          <Toggle value={s.shareScans} onChange={s.setShareScans} />
        </Row>
        <Note>
          Qué módulos y DIDs contesta cada modelo de auto, para que el próximo escaneo de ese modelo encuentre más. Sin el
          VIN ni datos tuyos.
        </Note>

        <SectionHeader title="Permisos" />
        <PermissionsPanel />

        <SectionHeader title="Más" />
        <View className="mb-3">
          <PillButton label="Ver de nuevo la introducción" variant="secondary" onPress={() => s.setOnboardingDone(false)} />
        </View>
        <Text className="text-brand-muted font-mono text-[10px] leading-4 mb-4">
          OBDient2 {Constants.expoConfig?.version ?? ''} · mapas © OpenStreetMap contributors, OpenMapTiles, OpenFreeMap · rutas
          OSRM · búsqueda Photon · códigos de falla: OBDex (github.com/foerbsnavi/OBDex, CC0).
          {'\n'}Asistencia a la conducción: no reemplaza tu atención ni las señales de tránsito.
        </Text>
        <Row label="Dev">
          <Toggle value={s.devMode} onChange={s.setDevMode} />
        </Row>
        <Note>Herramientas de desarrollo y pruebas. Al apagarlo se apagan todas y los servidores vuelven a los de siempre.</Note>

        {s.devMode && <DevSection />}
      </ScrollView>
    </SafeAreaView>
  );
}

// Everything for development: lab mode, the OBD lab, the technical log, the
// driving overlay, the servers and whether they answer.
function DevSection() {
  const router = useRouter();
  const s = useSettingsStore();
  const [endpoints, setEndpoints] = useState({ routingUrl: s.routingUrl, geocoderUrl: s.geocoderUrl, mapStyleUrl: s.mapStyleUrl });
  const dirty = endpoints.routingUrl !== s.routingUrl || endpoints.geocoderUrl !== s.geocoderUrl || endpoints.mapStyleUrl !== s.mapStyleUrl;

  return (
    <View className="mt-2">
      <Text className="font-mono-bold text-xs mb-3" style={{ color: COLORS.amber }}>
        DEV
      </Text>
      <Row label="Modo laboratorio">
        <Toggle value={s.labMode} onChange={s.setLabMode} />
      </Row>
      <Note>
        Habilita barrer los módulos del auto y, con el auto detenido, enviar comandos de solo lectura al bus (UDS/STN) desde
        el chat. No escribe, borra ni reprograma nada.
      </Note>
      <Link icon="flask-outline" label="Laboratorio OBD: banco, captura, M7.0" onPress={() => router.push('/dev-obd')} />
      <Row label="Datos técnicos en manejo">
        <Toggle value={s.debugOverlay} onChange={s.setDebugOverlay} />
      </Row>
      <Row label="Registro técnico al navegar">
        <Toggle value={s.recordTrips} onChange={s.setRecordTrips} />
      </Row>
      <Note>GPS, sensores, OBD y progreso de ruta, solo en este teléfono, para reproducir un viaje y depurar. Unos 10 MB por hora.</Note>
      <TechnicalLogs />

      <SectionHeader title="Servidores" />
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

      <ServerStatus />
    </View>
  );
}

// The technical recordings (JSONL), to share or delete.
function TechnicalLogs() {
  const [logs, setLogs] = useState<TripFileInfo[]>([]);
  const refresh = useCallback(() => {
    try {
      setLogs(container.trips.list());
    } catch {
      setLogs([]);
    }
  }, []);
  useFocusEffect(refresh);
  const share = async (t: TripFileInfo) => {
    try {
      await Sharing.shareAsync(container.trips.uri(t.name), { mimeType: 'text/plain', dialogTitle: t.name });
    } catch (err) {
      console.warn('[Settings] log not shared:', err);
    }
  };
  if (logs.length === 0) return <Text className="text-brand-muted font-mono text-xs mb-6">Todavía no hay registros técnicos.</Text>;
  return (
    <View className="mb-6 gap-2">
      {logs.map((t) => (
        <View key={t.name} className="flex-row items-center bg-brand-surface rounded-2xl px-4 py-3">
          <MaterialCommunityIcons name="file-chart-outline" size={16} color={COLORS.mint} />
          <View className="ml-3 flex-1">
            <Text className="text-brand-text font-mono text-xs">{t.name}</Text>
            <Text className="text-brand-muted font-mono text-[10px]">{(t.sizeBytes / 1e6).toFixed(1)} MB</Text>
          </View>
          <Pressable hitSlop={8} accessibilityLabel={`Compartir ${t.name}`} onPress={() => void share(t)} className="mr-4 active:opacity-60">
            <MaterialCommunityIcons name="share-variant-outline" size={18} color={COLORS.text} />
          </Pressable>
          <Pressable
            hitSlop={8}
            accessibilityLabel={`Borrar ${t.name}`}
            onPress={() => {
              container.trips.remove(t.name);
              refresh();
            }}
            className="active:opacity-60"
          >
            <MaterialCommunityIcons name="delete-outline" size={18} color={COLORS.red} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

// Which servers answer now: asked by hand, one round.
function ServerStatus() {
  const [checks, setChecks] = useState<HealthCheck[] | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { routingUrl, geocoderUrl } = useSettingsStore.getState();
      setChecks(
        await checkServices(
          { toolsUrl: container.toolsUrl, authUrl: container.authUrl, routingUrl, geocoderUrl, llm: container.account.llmCredentials() },
          (url, init) => fetch(url, init),
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  const down = checks?.filter((c) => c.ok === false).length ?? 0;
  return (
    <>
      <SectionHeader title="Estado del servidor" />
      <PillButton label={busy ? 'Probando…' : checks ? 'Probar de nuevo' : 'Probar servidores'} onPress={() => void run()} loading={busy} variant="secondary" />
      {checks && (
        <View className="bg-brand-surface rounded-2xl p-3 mt-3 gap-2">
          <Text className="font-mono-bold text-xs" style={{ color: down ? COLORS.red : COLORS.mint }}>
            {down ? `${down} sin responder` : 'Todos responden'}
          </Text>
          {checks.map((c) => (
            <View key={c.id} className="flex-row items-center gap-2">
              <View className="w-2 h-2 rounded-full" style={{ backgroundColor: c.ok == null ? COLORS.muted : c.ok ? COLORS.mint : COLORS.red }} />
              <Text className="text-brand-text font-mono text-xs flex-1">{c.label}</Text>
              <Text className="text-brand-muted font-mono text-[10px]">{c.ms != null && c.ok ? `${c.ms} ms` : c.detail}</Text>
            </View>
          ))}
          <Text className="text-brand-muted font-mono text-[10px] leading-4">La voz usa el mismo servidor que el modelo: se prueba al hablar.</Text>
        </View>
      )}
      {busy && !checks && <ActivityIndicator color={COLORS.mint} style={{ marginTop: 12 }} />}
    </>
  );
}

// ADR-0008: email account for the assistant; sign out; delete account.
function AccountSection() {
  const { status, profile, busy, error, signOut, deleteAccount } = useAccount();
  const confirmDelete = () =>
    Alert.alert(
      'Borrar cuenta',
      'Se borra para siempre: tu cuenta y su acceso al asistente, y en este teléfono tus conversaciones, viajes, historial de fallas y bitácora de servicio. Tus aportes a la base técnica del laboratorio quedan sin tu nombre. Necesitás conexión. No se puede deshacer.',
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
      <Text className="text-brand-text font-mono text-sm flex-1 mr-3">{label}</Text>
      {children}
    </View>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (on: boolean) => void }) {
  return <Switch value={value} onValueChange={onChange} trackColor={{ true: COLORS.mintDark }} thumbColor={COLORS.text} />;
}

function Note({ children }: { children: ReactNode }) {
  return <Text className="text-brand-muted font-mono text-[10px] leading-4 mb-6">{children}</Text>;
}

function Link({ icon, label, onPress }: { icon: keyof typeof MaterialCommunityIcons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="flex-row items-center bg-brand-surface rounded-2xl px-4 py-3 mb-3 active:opacity-60">
      <MaterialCommunityIcons name={icon} size={18} color={COLORS.mint} />
      <Text className="text-brand-text font-mono text-sm ml-3 flex-1">{label}</Text>
      <MaterialCommunityIcons name="chevron-right" size={18} color={COLORS.muted} />
    </Pressable>
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
