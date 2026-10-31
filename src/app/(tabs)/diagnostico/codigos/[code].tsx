// Diagnóstico › Códigos › un código: what it means (the base on the phone), the
// likely causes, the freeze frame when it is this code's, and when it was seen.

import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { PID_DEFINITIONS, type PidId } from '@/core/constants/pids';
import { container } from '@/data/container';
import { PID_LABEL } from '@/domain/assistant/offline';
import type { DtcInfo } from '@/data/obd/vehicle-tool-adapter';
import { ecuLabel } from '@/domain/diagnosis/views';
import { ActionChip, Actions, Field, ReadState } from '@/presentation/components/diagnosis/parts';
import { BackHeader } from '@/presentation/components/layout/BackHeader';
import { SectionHeader } from '@/presentation/components/layout/SectionHeader';
import { askInNewConversation } from '@/presentation/hooks/useAssistant';
import { readCar, useCarReads } from '@/presentation/services/car-reads';
import { COLORS } from '@/presentation/theme';
import { useOBDStore } from '@/store/obdStore';

const LIKELIHOOD = { high: 'muy probable', medium: 'probable', low: 'posible' } as const;

type FreezeFrame = { stored: boolean; dtc?: { code: string }; values?: Record<string, { value: number; unit: string }> };

export default function CodeScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const read = useCarReads((s) => s.codes[code]);
  const connected = useOBDStore((s) => s.connectionState === 'connected');
  const [info, setInfo] = useState<DtcInfo | null | undefined>(undefined);
  const [frame, setFrame] = useState<FreezeFrame | null>(null);
  const [frameError, setFrameError] = useState<string | null>(null);

  useEffect(() => {
    void container.dtcDescriber.describe(code).then(setInfo, () => setInfo(null));
    if (connected) {
      void readCar({ name: 'read_freeze_frame' }).then((out) => (out.ok ? setFrame(out.data as FreezeFrame) : setFrameError(out.message)));
    }
  }, [code, connected]);

  const vin = container.vehicleTools.knownVin();
  const seen = container.faults
    .list(vin ?? undefined)
    .filter((e) => e.type === 'codes' && e.codes.some((c) => c.code === code))
    .map((e) => e.at);
  const firstSeen = seen.length ? Math.min(...seen) : null;
  const ownFrame = frame?.stored && frame.dtc?.code === code ? frame : null;

  const ask = (text: string) => {
    askInNewConversation(text, info ? `${code}: ${info.title}. ${info.summary}` : null);
    router.navigate('/');
  };

  return (
    <SafeAreaView className="flex-1 bg-brand-bg" edges={['top']}>
      <BackHeader title={code} />
      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingVertical: 16 }}>
        <ReadState loading={info === undefined} error={null} label="Buscando el código…" />
        {info ? (
          <>
            <Text className="text-brand-text font-mono-bold text-sm">{info.title}</Text>
            <Text className="text-brand-text font-mono text-xs leading-5 mt-2">{info.summary}</Text>
            {info.reliability !== 'checked' && (
              <Text className="text-brand-muted font-mono text-[10px] mt-1">
                {info.reliability === 'low' ? 'Descripción poco segura para este código.' : 'Descripción no verificada contra la norma.'}
              </Text>
            )}
          </>
        ) : info === null ? (
          <Text className="text-brand-muted font-mono text-xs leading-5">
            {read?.description ?? 'La base del teléfono no tiene este código: suele ser propio de la marca. Preguntale al asistente.'}
          </Text>
        ) : null}

        <SectionHeader title="Dónde y cuándo" />
        <Field label="Lo informó" value={ecuLabel(read?.ecu ?? null)} />
        <Field label="Visto por primera vez" value={firstSeen ? new Date(firstSeen).toLocaleDateString('es-AR') : 'en esta lectura'} />

        {info?.causes?.length ? (
          <>
            <SectionHeader title="Causas" />
            {info.causes.map((c) => (
              <View key={c.cause} className="flex-row gap-2 py-1.5">
                <Text className="font-mono text-[10px] w-20" style={{ color: c.likelihood === 'high' ? COLORS.amber : COLORS.muted }}>
                  {LIKELIHOOD[c.likelihood]}
                </Text>
                <Text className="text-brand-text font-mono text-xs flex-1 leading-5">{c.cause}</Text>
              </View>
            ))}
          </>
        ) : null}

        <SectionHeader title="Freeze frame" />
        {ownFrame?.values ? (
          Object.entries(ownFrame.values).map(([k, v]) => <Field key={k} label={PID_LABEL[k as PidId] ?? PID_DEFINITIONS[k as PidId]?.name ?? k} value={`${Math.round(v.value * 10) / 10} ${v.unit}`} />)
        ) : (
          <Text className="text-brand-muted font-mono text-xs leading-5">
            {!connected
              ? 'Conectá el adaptador para leer el freeze frame.'
              : frameError ?? (frame ? 'El auto guardó el freeze frame de otro código, no de este.' : 'Leyendo…')}
          </Text>
        )}

        <Actions>
          <ActionChip label="Preguntar" icon="chat-processing-outline" onPress={() => ask(`Explicame el ${code}`)} />
          <ActionChip label="Cómo probarlo" icon="magnify" onPress={() => ask(`¿Cómo pruebo la falla del ${code} paso a paso?`)} />
        </Actions>
      </ScrollView>
    </SafeAreaView>
  );
}
