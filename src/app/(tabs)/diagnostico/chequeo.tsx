// Diagnóstico › Chequeo completo (B): "¿cómo está mi auto?" at a glance. Reads the
// stored codes, the monitors and the battery, one after the other; the modules
// row is the last scan's (scanning takes a minute, it is its own screen). Each
// row opens its screen; "Explicame" hands the result to the assistant.

import { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { container } from '@/data/container';
import { batteryVerdict, readinessVerdict, type ReadinessData, type Tone } from '@/domain/diagnosis/views';
import { MONITOR_LABEL } from '@/domain/obd/capture-digest';
import { ActionChip, Actions, ReadState, StatusRow } from '@/presentation/components/diagnosis/parts';
import { BackHeader } from '@/presentation/components/layout/BackHeader';
import { PillButton } from '@/presentation/components/layout/PillButton';
import { askInNewConversation } from '@/presentation/hooks/useAssistant';
import { readCar, useCarReads, type DescribedDtc } from '@/presentation/services/car-reads';
import { useOBDStore } from '@/store/obdStore';

// Results younger than this are shown as they are; older ones are read again.
const FRESH_MS = 2 * 60_000;

type Row = { tone: Tone | 'off'; title: string; detail: string; to: Parameters<typeof router.push>[0] };

export default function CheckScreen() {
  const connected = useOBDStore((s) => s.connectionState === 'connected');
  const last = useCarReads((s) => s.last);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setError(null);
    const steps = [
      ['códigos', { name: 'read_dtcs', kind: 'stored' }],
      ['monitores', { name: 'read_readiness' }],
      ['batería', { name: 'read_pids', pids: ['VOLTAGE', 'RPM'] }],
    ] as const;
    try {
      for (const [label, call] of steps) {
        setRunning(label);
        const out = await readCar(call);
        if (!out.ok && out.error !== 'not_supported') {
          setError(out.message);
          break;
        }
      }
    } finally {
      setRunning(null);
    }
  };

  useFocusEffect(
    useCallback(() => {
      const at = useCarReads.getState().last.read_readiness?.at ?? 0;
      if (connected && Date.now() - at > FRESH_MS) void run();
    }, [connected]),
  );

  const rows: Row[] = [];
  const dtcs = last.read_dtcs?.outcome.ok ? ((last.read_dtcs.outcome.data as { codes: DescribedDtc[] }).codes ?? []) : null;
  if (dtcs) {
    rows.push({
      tone: dtcs.length ? 'bad' : 'ok',
      title: dtcs.length ? `${dtcs.length} ${dtcs.length === 1 ? 'código guardado' : 'códigos guardados'}` : 'Sin códigos guardados',
      detail: dtcs.length ? dtcs.map((c) => c.code).join(' · ') : 'El motor y la caja no informan fallas.',
      to: '/diagnostico/codigos',
    });
  }
  const readiness = last.read_readiness?.outcome.ok ? (last.read_readiness.outcome.data as ReadinessData) : null;
  if (readiness) {
    const v = readinessVerdict(readiness, (id) => MONITOR_LABEL[id]);
    rows.push({ tone: v.tone, title: v.title, detail: v.detail, to: '/diagnostico/monitores' });
  }
  const pids = last.read_pids?.outcome.ok ? (last.read_pids.outcome.data as Record<string, { value: number | null } | undefined>) : null;
  const volts = pids?.VOLTAGE?.value ?? null;
  if (volts != null) {
    const rpm = pids?.RPM?.value ?? null;
    const v = batteryVerdict(volts, rpm == null ? null : rpm > 300);
    rows.push({ tone: v.tone, title: v.title, detail: v.detail, to: '/diagnostico/bateria' });
  }
  const scan = container.moduleScanLog.forVin(container.vehicleTools.knownVin())[0] ?? null;
  rows.push(
    scan
      ? {
          tone: 'ok',
          title: `${scan.modules.length} módulos respondieron`,
          detail: `${scan.buses.map((b) => `${b.bus} ${b.status === 'scanned' ? '✓' : b.status === 'unavailable' ? 'no disponible' : 'no probado'}`).join(' · ')} · escaneo del ${new Date(scan.at).toLocaleDateString('es-AR')}`,
          to: '/diagnostico/modulos',
        }
      : { tone: 'off', title: 'Módulos sin escanear', detail: 'Tocá para escanear (tarda alrededor de un minuto).', to: '/diagnostico/modulos' },
  );

  const explain = () => {
    askInNewConversation('Explicame el resultado del chequeo y qué reviso primero', rows.map((r) => `${r.title}: ${r.detail}`).join('\n'));
    router.navigate('/');
  };

  return (
    <SafeAreaView className="flex-1 bg-brand-bg" edges={['top']}>
      <BackHeader title="Chequeo completo" />
      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingVertical: 16 }}>
        <ReadState loading={running != null} error={error ?? (!connected ? 'Conectá el adaptador para chequear el auto. Abajo, lo último guardado.' : null)} label={`Leyendo ${running ?? ''}…`} />
        {rows.map((r) => (
          <StatusRow key={r.title} tone={r.tone} title={r.title} detail={r.detail} onPress={() => router.push(r.to)} />
        ))}
        {last.read_readiness && (
          <Text className="text-brand-muted font-mono text-[10px] mt-1">
            {new Date(last.read_readiness.at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} · {useOBDStore.getState().session?.identity.stn ?? useOBDStore.getState().session?.identity.elm ?? ''}
          </Text>
        )}
        <View className="mt-4">
          <PillButton label={running ? 'Leyendo…' : 'Repetir chequeo'} onPress={() => void run()} disabled={!connected || running != null} />
        </View>
        <Actions>
          <ActionChip label="Explicame el resultado" icon="chat-processing-outline" onPress={explain} disabled={rows.length < 2} />
        </Actions>
      </ScrollView>
    </SafeAreaView>
  );
}
