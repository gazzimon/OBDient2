// Diagnóstico › Módulos › un módulo: who it is (its own part number), where it
// answers, and the lab's candidate DIDs to validate on it (Modo laboratorio).
// A DID that answers says nothing yet about what it measures.

import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { container } from '@/data/container';
import { BUS_PRESET } from '@/domain/obd/module-scan';
import { ActionChip, Actions, Field, ReadState } from '@/presentation/components/diagnosis/parts';
import { BackHeader } from '@/presentation/components/layout/BackHeader';
import { SectionHeader } from '@/presentation/components/layout/SectionHeader';
import { askInNewConversation } from '@/presentation/hooks/useAssistant';
import { readCar } from '@/presentation/services/car-reads';
import { COLORS } from '@/presentation/theme';
import { useOBDStore } from '@/store/obdStore';
import { useSettingsStore } from '@/store/settingsStore';

export default function ModuleScreen() {
  const { id, bus, at } = useLocalSearchParams<{ id: string; bus: string; at: string }>();
  const connected = useOBDStore((s) => s.connectionState === 'connected');
  const labMode = useSettingsStore((s) => s.labMode);
  const report = container.moduleScanLog.forVin(container.vehicleTools.knownVin()).find((r) => String(r.at) === at) ?? null;
  const m = report?.modules.find((x) => x.id === id && x.bus === bus) ?? null;
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!m || !report) {
    return (
      <SafeAreaView className="flex-1 bg-brand-bg" edges={['top']}>
        <BackHeader title="Módulo" />
        <Text className="text-brand-muted font-mono text-xs m-4">Este módulo no está en el último escaneo guardado.</Text>
      </SafeAreaView>
    );
  }

  // The link is checked first (control), then the lab's candidates; the sweep asks for confirmation.
  const validate = async (from: string | null) => {
    setBusy(true);
    setError(null);
    container.moduleScans.adopt(report);
    try {
      if (!from) {
        const control = await readCar({ name: 'did_probe', header: m.reqHeader, mode: 'control', dids: [], from: null, to: null, find: null });
        if (!control.ok) return setError(control.message);
      }
      const out = await readCar({ name: 'did_probe', header: m.reqHeader, mode: 'candidates', dids: [], from, to: null, find: null });
      if (!out.ok) return setError(out.error === 'cancelled' ? null : out.message);
      setResult(out.summary);
      setCursor(((out.data as { cursor?: string | null }).cursor ?? null) || null);
    } finally {
      setBusy(false);
    }
  };

  const ask = () => {
    askInNewConversation(`¿Qué es el módulo en ${m.reqHeader} y qué puedo leerle?`, `${m.label} ${m.reqHeader}→${m.rxHeader} en ${m.bus}; ${m.partNumber ? `número de parte ${m.partNumber} (${m.identitySource})` : 'sin identificar'}.`);
    router.navigate('/');
  };

  return (
    <SafeAreaView className="flex-1 bg-brand-bg" edges={['top']}>
      <BackHeader title={m.label === 'módulo' ? `Módulo ${m.reqHeader}` : m.label} />
      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingVertical: 16 }}>
        <SectionHeader title="Identidad" />
        <Field label="Número de parte" value={m.partNumber ?? 'no lo informó'} />
        <Field label="Leído con" value={m.identitySource ?? '—'} />
        <Field label="Nombre" value={m.label === 'módulo' ? 'desconocido' : `${m.label} (sugerido por la dirección)`} />
        <SectionHeader title="Dónde responde" />
        <Field label="Pedido → respuesta" value={`${m.reqHeader} → ${m.rxHeader}`} />
        <Field label="Bus" value={`${m.bus} · ${BUS_PRESET[m.bus].label}`} />
        <Field label="Escaneo" value={new Date(report.at).toLocaleString('es-AR')} />

        <SectionHeader title="DIDs candidatos" />
        <Text className="text-brand-muted font-mono text-[11px] leading-4 mb-2">
          El laboratorio tiene una lista de DIDs a validar para esta marca. Se leen de a uno, solo lectura; uno que responde no
          dice qué mide hasta tener un decodificador.
        </Text>
        <ReadState loading={busy} error={error} label="Leyendo DIDs…" />
        {result && <Text className="text-brand-text font-mono text-xs leading-5 mb-2">{result}</Text>}
        {!labMode && <Text className="font-mono text-[11px] mb-2" style={{ color: COLORS.amber }}>Se activa con Modo laboratorio (Ajustes › Dev).</Text>}
        <Actions>
          <ActionChip label={cursor ? 'Seguir con los siguientes' : 'Validar DIDs candidatos'} icon="flask-outline" onPress={() => void validate(cursor)} disabled={!connected || !labMode || busy} />
          <ActionChip label="Preguntar" icon="chat-processing-outline" onPress={ask} />
        </Actions>
      </ScrollView>
    </SafeAreaView>
  );
}
