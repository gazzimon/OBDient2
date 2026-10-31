// Diagnóstico › Módulos (C, phase 3): the last scan's report for this car — what
// answered, on which bus and address, how it was identified — and what the scan
// could not prove: buses not tried, addresses that stayed silent, the make's
// addresses missing. "Escanear" runs the same scan as the chat's scan_modules.

import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { container } from '@/data/container';
import { BUS_PRESET } from '@/domain/obd/module-scan';
import { applyScanEvent, initialScanState, type BusStatus, type ModuleScanReport, type ScanState } from '@/domain/obd/module-scan-report';
import { ActionChip, Actions, StatusRow } from '@/presentation/components/diagnosis/parts';
import { BackHeader } from '@/presentation/components/layout/BackHeader';
import { PillButton } from '@/presentation/components/layout/PillButton';
import { assistantContext } from '@/presentation/hooks/assistantContext';
import { askInNewConversation } from '@/presentation/hooks/useAssistant';
import { readCar } from '@/presentation/services/car-reads';
import { COLORS } from '@/presentation/theme';
import { useOBDStore } from '@/store/obdStore';

const BUS_TEXT: Record<BusStatus, string> = { scanned: 'probado', unavailable: 'no disponible', 'not-tested': 'no probado' };
const MAKE_TEXT = {
  loaded: null,
  none: 'El laboratorio no tiene direcciones de esta marca: se probaron las genéricas.',
  failed: 'No se pudieron cargar las direcciones de la marca (sin conexión): se probaron las genéricas.',
  'no-make': 'No se conoce la marca (sin VIN): se probaron las direcciones genéricas.',
} as const;

const when = (ms: number) => new Date(ms).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function ModulesScreen() {
  const connected = useOBDStore((s) => s.connectionState === 'connected');
  const [reports, setReports] = useState<ModuleScanReport[]>([]);
  const [shown, setShown] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [silentOpen, setSilentOpen] = useState(false);
  const refresh = useCallback(() => {
    setReports(container.moduleScanLog.forVin(container.vehicleTools.knownVin()));
    setShown(0);
  }, []);
  useFocusEffect(refresh);
  const report = reports[shown] ?? null;
  const silent = report?.buses.flatMap((b) => b.silent.map((id) => `${b.bus} ${id}`)) ?? [];

  const ask = () => {
    if (!report) return;
    const lines = report.modules.map((m) => `${m.label} ${m.reqHeader}→${m.rxHeader} (${m.bus}) ${m.partNumber ? `parte ${m.partNumber}` : 'sin identificar'}`);
    askInNewConversation('¿Qué módulos tiene este auto y qué me dice el escaneo?', lines.join('\n'));
    router.navigate('/');
  };

  return (
    <SafeAreaView className="flex-1 bg-brand-bg" edges={['top']}>
      <BackHeader title="Módulos" />
      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingVertical: 16 }}>
        {!report ? (
          <Text className="text-brand-muted font-mono text-xs leading-5 mb-4">
            Todavía no se escanearon los módulos de este auto. El escaneo busca qué módulos responden (motor, ABS, airbag,
            tablero…) en los buses y direcciones que este adaptador puede probar. Tarda alrededor de un minuto.
          </Text>
        ) : (
          <>
            <View className="flex-row flex-wrap gap-2 mb-2">
              {report.buses.map((b) => (
                <View key={b.bus} className="rounded-full px-3 py-1 border" style={{ borderColor: b.status === 'scanned' ? COLORS.mintDark : COLORS.border }}>
                  <Text className="font-mono text-[11px]" style={{ color: b.status === 'scanned' ? COLORS.mint : COLORS.muted }}>
                    {b.bus} {BUS_TEXT[b.status]}
                  </Text>
                </View>
              ))}
            </View>
            <Text className="text-brand-muted font-mono text-[10px] mb-3">
              {when(report.at)} · {report.adapter}
              {reports.length > 1 ? ` · ${shown + 1} de ${reports.length} escaneos` : ''}
            </Text>
            {MAKE_TEXT[report.makeAddresses.status] && <Text className="font-mono text-[11px] leading-4 mb-3" style={{ color: COLORS.amber }}>{MAKE_TEXT[report.makeAddresses.status]}</Text>}

            {report.modules.length === 0 && <StatusRow tone="warn" title="Ningún módulo respondió" detail="No es concluyente: pueden estar detrás de un gateway o en un bus que este adaptador no habla." />}
            {report.modules.map((m) => (
              <StatusRow
                key={`${m.bus}:${m.id}`}
                tone={m.identified ? 'ok' : 'warn'}
                title={m.label === 'módulo' ? `Módulo en ${m.reqHeader}` : `${m.label} (sugerido)`}
                detail={`${m.reqHeader}→${m.rxHeader} · ${m.bus} · ${m.identified ? `identificado (${m.identitySource})` : 'respondió, identidad desconocida'}`}
                onPress={() => router.push({ pathname: '/diagnostico/modulos/[id]', params: { id: m.id, bus: m.bus, at: String(report.at) } })}
              />
            ))}
            {silent.length > 0 && (
              <Pressable onPress={() => setSilentOpen((o) => !o)} className="py-2 active:opacity-60">
                <Text className="text-brand-muted font-mono text-[11px]">
                  {silentOpen ? '▾' : '▸'} {silent.length} direcciones probadas sin respuesta
                </Text>
                {silentOpen && <Text className="text-brand-muted font-mono text-[10px] leading-4 mt-1">{silent.join(' · ')}</Text>}
              </Pressable>
            )}
            <Text className="text-brand-muted font-mono text-[10px] leading-4 mt-2">
              Mostramos los módulos que respondieron en los buses y direcciones que este adaptador pudo probar. El nombre es una
              sugerencia por la dirección; la identidad la da el número de parte.
            </Text>
          </>
        )}

        <View className="mt-5">
          <PillButton label="Escanear módulos" onPress={() => setScanning(true)} disabled={!connected} />
        </View>
        <Actions>
          {reports.length > 1 && <ActionChip label="Escaneo anterior" icon="history" onPress={() => setShown((i) => (i + 1) % reports.length)} />}
          <ActionChip label="Preguntar" icon="chat-processing-outline" onPress={ask} disabled={!report} />
        </Actions>
        {!connected && <Text className="text-brand-muted font-mono text-[10px] mt-3">Conectá el adaptador para escanear.</Text>}
      </ScrollView>

      <ScanModal
        visible={scanning}
        onClose={() => {
          setScanning(false);
          refresh();
        }}
      />
    </SafeAreaView>
  );
}

// Check → progress → done. Cancel puts the adapter back as the telemetry needs it.
function ScanModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const session = useOBDStore((s) => s.session);
  const [phase, setPhase] = useState<'check' | 'running' | 'done'>('check');
  const [state, setState] = useState<ScanState>(initialScanState());
  const [error, setError] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const ctx = visible ? assistantContext() : null;
  const blocker = !ctx ? null : !ctx.connected ? 'Conectá el adaptador.' : ctx.moving ? 'Detené el auto: el escaneo pausa la telemetría.' : ctx.navigating ? 'Terminá la navegación primero: el escaneo pausa la telemetría.' : null;
  const buses = useMemo(() => (session?.identity.stn ? 'HS, y MS y SW si el adaptador los admite' : 'HS (este adaptador no cambia de bus)'), [session]);

  const start = async () => {
    setPhase('running');
    setError(null);
    setState(initialScanState());
    ctrl.current = new AbortController();
    const out = await readCar({ name: 'scan_modules', make: null, model: null }, ctrl.current.signal, (e) => {
      if (e.type !== 'did-probe-progress') setState((s) => applyScanEvent(s, e));
    });
    if (!out.ok) setError(out.error === 'cancelled' ? 'Escaneo cancelado: no se guardó un informe parcial.' : out.message);
    setPhase('done');
  };
  const close = () => {
    ctrl.current?.abort();
    setPhase('check');
    setState(initialScanState());
    setError(null);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View className="flex-1 bg-black/60" />
      <View className="bg-brand-surface rounded-t-3xl px-5 pt-5 pb-8">
        <Text className="text-brand-text font-mono-bold text-base mb-3">Escanear módulos</Text>
        {phase === 'check' && (
          <>
            <StatusRow tone={ctx?.connected ? 'ok' : 'bad'} title="Adaptador" detail={ctx?.connected ? `${session?.identity.stn ?? session?.identity.elm ?? ''} · ${session?.protocol ?? ''}` : 'sin conectar'} />
            <StatusRow tone={blocker && ctx?.connected ? 'bad' : 'ok'} title="Auto detenido, sin navegación" detail={blocker ?? 'listo'} />
            <StatusRow tone="ok" title="Buses a probar" detail={buses} />
            <Text className="text-brand-muted font-mono text-[11px] leading-4 my-3">
              Encontraremos los módulos que respondan en los buses y direcciones que este adaptador permite probar. La telemetría
              se pausa durante el escaneo y vuelve al terminar o cancelar. Contacto en ON.
            </Text>
            <PillButton label="Escanear" onPress={() => void start()} disabled={blocker != null} />
            <View className="mt-2">
              <PillButton label="Cancelar" variant="secondary" onPress={close} />
            </View>
          </>
        )}
        {phase !== 'check' && (
          <>
            {state.buses.map((b) => (
              <View key={b.bus} className="flex-row items-center gap-2 py-1">
                {state.current?.bus === b.bus ? <ActivityIndicator size="small" color={COLORS.mint} /> : <View className="w-2 h-2 rounded-full" style={{ backgroundColor: b.status === 'scanned' ? COLORS.mint : COLORS.border }} />}
                <Text className="text-brand-text font-mono text-xs flex-1">
                  {b.bus} · {BUS_PRESET[b.bus].label}
                </Text>
                <Text className="text-brand-muted font-mono text-[11px]">
                  {state.current?.bus === b.bus ? `${state.current.completed}/${state.current.total}` : b.status === 'scanned' ? `${b.probed} probadas` : BUS_TEXT[b.status]}
                </Text>
              </View>
            ))}
            <Text className="text-brand-muted font-mono text-[10px] mt-3 mb-1">{state.modules.length} módulos encontrados</Text>
            <ScrollView style={{ maxHeight: 180 }}>
              {state.modules.map((m) => (
                <Text key={`${m.bus}:${m.id}`} className="text-brand-text font-mono text-[11px] py-0.5">
                  {m.identified ? '✓' : '·'} {m.label} {m.reqHeader}→{m.rxHeader} ({m.bus})
                </Text>
              ))}
            </ScrollView>
            {state.warning && <Text className="font-mono text-[11px] mt-2" style={{ color: COLORS.amber }}>{state.warning}</Text>}
            {error && <Text className="font-mono text-[11px] mt-2" style={{ color: COLORS.amber }}>{error}</Text>}
            <View className="mt-4">
              <PillButton label={phase === 'running' ? 'Cancelar' : 'Ver el informe'} variant={phase === 'running' ? 'secondary' : 'primary'} onPress={close} />
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}
