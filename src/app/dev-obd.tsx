// Ajustes › Dev › Laboratorio OBD: the adapter bench, the diagnostic capture and
// the M7.0 measurement (they lived in Vehículo until 2026-10-31). Each pauses the
// telemetry and shares its result for development.

import { useState } from 'react';
import { ScrollView, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { container } from '@/data/container';
import { formatBench } from '@/data/obd/adapter-bench';
import { formatCapture } from '@/data/obd/diagnostic-capture';
import { formatM7Bench } from '@/data/obd/m7-bench';
import { redactText } from '@/domain/privacy/redact';
import { PillButton } from '@/presentation/components/layout/PillButton';
import { BackHeader } from '@/presentation/components/layout/BackHeader';
import { SectionHeader } from '@/presentation/components/layout/SectionHeader';
import { useOBDStore } from '@/store/obdStore';

type TestId = 'bench' | 'capture' | 'm7';

const TESTS: readonly { id: TestId; title: string; text: string; run: () => Promise<string>; label: string; busy: string; share: string }[] = [
  {
    id: 'bench',
    title: 'Banco del adaptador',
    text: 'Identifica el chip y mide la velocidad real con cada método de petición. Pausa la telemetría unos segundos: hazlo con el auto detenido y el motor en marcha.',
    run: async () => formatBench(await container.obd.runBench()),
    label: 'Ejecutar banco',
    busy: 'Midiendo…',
    share: 'banco',
  },
  {
    id: 'capture',
    title: 'Captura de diagnóstico',
    text: 'Lee códigos, freeze frame, readiness y VIN tal como los contesta este auto, con y sin encabezados, para que los parsers se escriban contra respuestas reales. Solo lectura: no borra nada. Tarda hasta un minuto; mejor con el motor en marcha y, si es posible, con algún código guardado.',
    run: async () => formatCapture(await container.obd.runCapture()),
    label: 'Capturar diagnóstico',
    busy: 'Capturando…',
    share: 'captura',
  },
  {
    id: 'm7',
    title: 'Medición M7.0',
    text: 'Mide cuántos datos por segundo da este auto con varios PIDs por pedido y cómo contesta el diagnóstico con STPX y STCSEGR. Solo lectura. Pausa la telemetría un par de minutos: con el auto detenido y el motor en marcha. Compartí el resultado completo.',
    run: async () => formatM7Bench(await container.obd.runM7Bench()),
    label: 'Medir M7.0',
    busy: 'Midiendo…',
    share: 'M7.0',
  },
];

export default function DevObdScreen() {
  const connected = useOBDStore((s) => s.connectionState === 'connected');
  const deviceName = useOBDStore((s) => s.deviceName);
  const [running, setRunning] = useState<TestId | null>(null);
  const [results, setResults] = useState<Partial<Record<TestId, string>>>({});

  const run = async (t: (typeof TESTS)[number]) => {
    setRunning(t.id);
    setResults((r) => ({ ...r, [t.id]: undefined }));
    try {
      const out = await t.run();
      setResults((r) => ({ ...r, [t.id]: out }));
    } catch (err) {
      setResults((r) => ({ ...r, [t.id]: `Error: ${err instanceof Error ? err.message : String(err)}` }));
    } finally {
      setRunning(null);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-brand-bg" edges={['top', 'bottom']}>
      <BackHeader title="Laboratorio OBD" />
      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingBottom: 24 }}>
        {!connected && <Text className="text-brand-amber font-mono text-xs mt-4">Conectá el adaptador en Diagnóstico para correr estas pruebas.</Text>}
        {TESTS.map((t) => {
          const result = results[t.id];
          return (
            <View key={t.id} className="mt-6">
              <SectionHeader title={t.title} />
              <Text className="text-brand-muted font-mono text-[10px] leading-4 mb-3">{t.text}</Text>
              <PillButton
                label={running === t.id ? t.busy : t.label}
                onPress={() => void run(t)}
                loading={running === t.id}
                disabled={!connected || (running != null && running !== t.id)}
                variant="secondary"
              />
              {result && (
                <View className="bg-brand-surface rounded-2xl p-3 mt-3">
                  <Text selectable className="text-brand-text font-mono text-[10px] leading-4">
                    {result}
                  </Text>
                  <View className="mt-3">
                    <PillButton
                      label="Compartir resultado"
                      variant="secondary"
                      onPress={() => void Share.share({ message: redactText(`OBDient2 · ${t.share} ${deviceName ?? ''}\n\n${result}`) })}
                    />
                  </View>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}
