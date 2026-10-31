// Diagnóstico (2026-10-31): the car on top — make, full VIN (the owner sees it on
// their own phone, ADR-0011), battery voltage, the adapter — and a grid of what
// can be done, in three groups. Each tile opens a summary (B) or a list with its
// detail (C). The counts come from what was last read and kept on the phone, so
// they show without the adapter too.

import { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { container } from '@/data/container';
import type { RequestStyle } from '@/data/obd/telemetry-poller';
import { makeFromVin } from '@/domain/obd/vin-make';
import { Field } from '@/presentation/components/diagnosis/parts';
import { PillButton } from '@/presentation/components/layout/PillButton';
import { AdapterList, NotFoundHelp } from '@/presentation/components/obd/AdapterList';
import { useAdapterScan } from '@/presentation/hooks/useAdapterScan';
import { askInNewConversation } from '@/presentation/hooks/useAssistant';
import { connectionKeeper } from '@/presentation/services/connection-keeper';
import { useCarReads } from '@/presentation/services/car-reads';
import { COLORS } from '@/presentation/theme';
import { useOBDStore } from '@/store/obdStore';

type Icon = keyof typeof MaterialCommunityIcons.glyphMap;

interface Tile {
  readonly label: string;
  readonly icon: Icon;
  readonly to: Href;
  // Reads the car now: dimmed without the adapter.
  readonly needsCar?: boolean;
  readonly badge?: { readonly n: number; readonly tone: 'bad' | 'ok' } | null;
}

const STYLE_LABEL: Record<RequestStyle, string> = {
  stpx: 'STPX (STN, rápido)',
  count: 'conteo de respuestas (CAN)',
  plain: 'estándar (lento)',
};

export default function DiagnosisScreen() {
  const connected = useOBDStore((s) => s.connectionState === 'connected');
  const obdVin = useOBDStore((s) => s.vin);
  const volts = useOBDStore((s) => s.parameters.VOLTAGE?.value ?? null);
  const speed = useOBDStore((s) => s.parameters.SPEED?.value ?? null);
  const session = useOBDStore((s) => s.session);
  const busy = useCarReads((s) => s.busy);
  const lastCodes = useCarReads((s) => s.last.read_dtcs);
  const [adapterOpen, setAdapterOpen] = useState(false);

  const vin = obdVin ?? container.vehicleTools.knownVin();
  const make = makeFromVin(vin);
  // What was kept: the last codes read for this car, the last module scan.
  const counts = useMemo(() => {
    const codes = container.faults.list(vin ?? undefined).find((e) => e.type === 'codes' && e.kind === 'stored');
    const scan = container.moduleScanLog.forVin(vin ?? null)[0] ?? null;
    return { codes: codes?.type === 'codes' ? codes.codes.length : null, modules: scan ? scan.modules.length : null };
    // A new read (lastCodes) changes the history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vin, lastCodes]);

  const check: Tile = { label: 'Chequeo completo', icon: 'clipboard-check-outline', to: '/diagnostico/chequeo', needsCar: true };
  const review: Tile[] = [
    { label: 'Códigos', icon: 'alert-outline', to: '/diagnostico/codigos', badge: counts.codes ? { n: counts.codes, tone: 'bad' } : null },
    { label: 'Módulos', icon: 'view-grid-outline', to: '/diagnostico/modulos', badge: counts.modules ? { n: counts.modules, tone: 'ok' } : null },
    { label: 'Monitores', icon: 'check-decagram-outline', to: '/diagnostico/monitores', needsCar: true },
    { label: 'Batería', icon: 'car-battery', to: '/diagnostico/bateria', needsCar: true },
    { label: 'Información', icon: 'information-outline', to: '/diagnostico/info', needsCar: true },
  ];
  const tests: Tile[] = [
    { label: 'En vivo', icon: 'pulse', to: '/diagnostico/en-vivo' },
    { label: 'Sonido del motor', icon: 'waveform', to: '/diagnostico/sonido' },
    { label: 'Prueba 0–100', icon: 'speedometer', to: '/diagnostico/cero-cien' },
  ];
  const records: Tile[] = [
    { label: 'Historial de fallas', icon: 'history', to: '/diagnostico/historial' },
    { label: 'Service', icon: 'wrench-outline', to: '/diagnostico/service' },
    { label: 'Informes', icon: 'file-document-outline', to: '/diagnostico/informes' },
  ];

  return (
    <SafeAreaView className="flex-1 bg-brand-bg" edges={['top']}>
      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingVertical: 12 }}>
        <View className="bg-brand-surface rounded-2xl px-4 py-3 mb-3">
          <Text className="text-brand-text font-mono-bold text-base">{make ? make[0]!.toUpperCase() + make.slice(1) : 'Tu auto'}</Text>
          <Text selectable className="text-brand-muted font-mono text-xs mt-1">
            {vin ? `VIN ${vin}` : connected ? 'Leyendo el VIN…' : 'Conectá el adaptador para leer el auto'}
          </Text>
          <View className="flex-row flex-wrap gap-2 mt-2">
            <Pressable
              onPress={() => setAdapterOpen(true)}
              className="flex-row items-center gap-1 rounded-full px-3 py-1 border active:opacity-60"
              style={{ borderColor: connected ? COLORS.mintDark : COLORS.border }}
            >
              <View className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: connected ? COLORS.mint : COLORS.muted }} />
              <Text className="font-mono text-[11px]" style={{ color: connected ? COLORS.mint : COLORS.muted }}>
                {connected ? (session?.identity.stn ?? session?.identity.elm ?? 'adaptador') : 'sin adaptador'}
              </Text>
            </Pressable>
            {connected && volts != null && <Chip text={`${volts.toFixed(1).replace('.', ',')} V`} />}
            {connected && speed != null && <Chip text={speed > 5 ? 'en marcha' : 'detenido'} />}
          </View>
        </View>

        {!connected && <Connect />}
        {busy && (
          <View className="flex-row items-center gap-2 mb-3">
            <ActivityIndicator size="small" color={COLORS.amber} />
            <Text className="font-mono text-xs" style={{ color: COLORS.amber }}>
              Ocupado: {busy}
            </Text>
          </View>
        )}

        <Group title="Revisar el auto">
          <TileButton tile={check} connected={connected} wide detail="Códigos, monitores, batería y módulos de una vez" />
          {review.map((t) => (
            <TileButton key={t.label} tile={t} connected={connected} />
          ))}
          <TileButton
            tile={{ label: 'Preguntar', icon: 'chat-processing-outline', to: '/' }}
            connected={connected}
            onPress={() => {
              askInNewConversation('¿Cómo está mi auto? Revisalo y decime qué mirar primero.');
              router.navigate('/');
            }}
          />
        </Group>
        <Group title="En vivo y pruebas">
          {tests.map((t) => (
            <TileButton key={t.label} tile={t} connected={connected} />
          ))}
        </Group>
        <Group title="Registros">
          {records.map((t) => (
            <TileButton key={t.label} tile={t} connected={connected} />
          ))}
        </Group>
      </ScrollView>

      <Modal visible={adapterOpen} transparent animationType="slide" onRequestClose={() => setAdapterOpen(false)}>
        <Pressable className="flex-1 bg-black/60" onPress={() => setAdapterOpen(false)} />
        <AdapterSheet onClose={() => setAdapterOpen(false)} />
      </Modal>
    </SafeAreaView>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mb-4">
      <Text className="text-brand-muted font-mono text-[10px] mb-2">{title.toUpperCase()}</Text>
      <View className="flex-row flex-wrap" style={{ marginHorizontal: -4 }}>
        {children}
      </View>
    </View>
  );
}

function TileButton({ tile, connected, wide, detail, onPress }: { tile: Tile; connected: boolean; wide?: boolean; detail?: string; onPress?: () => void }) {
  const off = tile.needsCar && !connected;
  return (
    <View style={{ width: wide ? '100%' : '33.333%', padding: 4 }}>
      <Pressable
        onPress={onPress ?? (() => router.push(tile.to))}
        disabled={off}
        accessibilityRole="button"
        accessibilityLabel={tile.label}
        className={`bg-brand-surface rounded-2xl active:opacity-60 ${wide ? 'flex-row items-center gap-3 px-4 py-3' : 'items-center px-2 py-3'}`}
        style={{ opacity: off ? 0.4 : 1, minHeight: wide ? 0 : 84, borderWidth: wide ? 1 : 0, borderColor: COLORS.mintDark }}
      >
        <MaterialCommunityIcons name={tile.icon} size={wide ? 24 : 26} color={COLORS.mint} />
        <View className={wide ? 'flex-1' : 'items-center mt-1'}>
          <Text className={`text-brand-text font-mono text-xs ${wide ? 'font-mono-bold' : 'text-center'}`}>{tile.label}</Text>
          {detail && <Text className="text-brand-muted font-mono text-[10px] mt-0.5">{off ? 'Conectá el adaptador' : detail}</Text>}
        </View>
        {tile.badge && (
          <View
            className="absolute top-1.5 right-1.5 rounded-full px-1.5 min-w-[18px] items-center"
            style={{ backgroundColor: tile.badge.tone === 'bad' ? COLORS.red : COLORS.mint }}
          >
            <Text className="font-mono-bold text-[10px]" style={{ color: COLORS.bg }}>
              {tile.badge.n}
            </Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

function Chip({ text }: { text: string }) {
  return (
    <View className="rounded-full px-3 py-1 border border-brand-border">
      <Text className="text-brand-muted font-mono text-[11px]">{text}</Text>
    </View>
  );
}

// Without the adapter: find it and connect, right here.
function Connect() {
  const { connectionState, deviceName, error } = useOBDStore();
  const { devices, scanning, nothingFound, scanError, scan, connect } = useAdapterScan();
  return (
    <View className="border border-brand-border rounded-2xl p-4 mb-4">
      <Text className="text-brand-text font-mono-bold text-sm">Conectar el adaptador</Text>
      <Text className="text-brand-muted font-mono text-xs leading-5 mt-1 mb-3">
        Con el adaptador OBD conectado, la app lee el auto. Sin él, el historial, el service y los informes siguen acá.
      </Text>
      {connectionState === 'connecting' ? (
        <View className="flex-row items-center gap-3 py-2">
          <ActivityIndicator color={COLORS.mint} />
          <Text className="text-brand-text font-mono text-sm">Conectando con {deviceName ?? 'el adaptador'}…</Text>
        </View>
      ) : (
        <PillButton label={scanning ? 'Buscando…' : 'Buscar adaptador'} onPress={scan} loading={scanning} />
      )}
      {(error ?? scanError) && <Text className="text-brand-red font-mono text-xs mt-3">{error ?? scanError}</Text>}
      {nothingFound && <NotFoundHelp />}
      <AdapterList devices={devices} onPick={(d) => void connect(d)} />
    </View>
  );
}

// The adapter's details, from the chip on top.
function AdapterSheet({ onClose }: { onClose: () => void }) {
  const { connectionState, deviceName, session, speedRateHz, requestStyle, adapterResets } = useOBDStore();
  const connected = connectionState === 'connected' && session;
  return (
    <View className="bg-brand-surface rounded-t-3xl px-5 pt-5 pb-8">
      <Text className="text-brand-text font-mono-bold text-base mb-2">Adaptador</Text>
      {connected ? (
        <>
          <Field label="Adaptador" value={deviceName ?? '—'} />
          <Field label="Velocidad" value={`${speedRateHz.toFixed(1)} Hz`} />
          <Field label="Chip" value={session.identity.stn ?? `${session.identity.elm || 'ELM327'} (sin comandos STN)`} />
          <Field label="Protocolo" value={session.protocol} />
          <Field label="PIDs de motor" value={session.supportedPids.length ? `${session.supportedPids.length}` : 'sin descubrir'} />
          <Field label="Petición de velocidad" value={requestStyle ? STYLE_LABEL[requestStyle] : '—'} />
          {adapterResets > 0 && <Field label="Reinicios por bajo voltaje" value={`${adapterResets} (recuperados)`} />}
          <View className="mt-5">
            <PillButton
              label="Desconectar"
              variant="destructive"
              onPress={() => {
                onClose();
                void connectionKeeper.userDisconnect();
              }}
            />
          </View>
        </>
      ) : (
        <Text className="text-brand-muted font-mono text-xs leading-5">No hay un adaptador conectado. Buscalo desde la tarjeta «Conectar el adaptador».</Text>
      )}
    </View>
  );
}
