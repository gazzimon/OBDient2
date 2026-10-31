// Diagnóstico › Monitores (B): does the car pass the VTV now, and what is pending.

import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { readinessVerdict, type ReadinessData } from '@/domain/diagnosis/views';
import { MONITOR_LABEL } from '@/domain/obd/capture-digest';
import { ActionChip, Actions, ReadState, StatusRow, VerdictCard } from '@/presentation/components/diagnosis/parts';
import { BackHeader } from '@/presentation/components/layout/BackHeader';
import { SectionHeader } from '@/presentation/components/layout/SectionHeader';
import { useCarRead } from '@/presentation/hooks/useCarRead';
import { askInNewConversation } from '@/presentation/hooks/useAssistant';

export default function MonitorsScreen() {
  const { data, loading, error, read, connected } = useCarRead({ name: 'read_readiness' });
  const d = data as ReadinessData | null;
  const verdict = d ? readinessVerdict(d, (id) => MONITOR_LABEL[id]) : null;
  const ask = () => {
    askInNewConversation('¿Pasa la VTV? Explicame los monitores', verdict ? `${verdict.title}. ${verdict.detail}` : null);
    router.navigate('/');
  };
  return (
    <SafeAreaView className="flex-1 bg-brand-bg" edges={['top']}>
      <BackHeader title="Monitores" />
      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingVertical: 16 }}>
        <ReadState loading={loading && !d} error={error} />
        {verdict && <VerdictCard {...verdict} />}
        {d && (
          <>
            <SectionHeader title="Monitores" />
            {d.incomplete.map((id) => (
              <StatusRow key={id} tone="warn" title={MONITOR_LABEL[id]} detail="pendiente" />
            ))}
            {d.complete.map((id) => (
              <StatusRow key={id} tone="ok" title={MONITOR_LABEL[id]} detail="listo" />
            ))}
            <Text className="text-brand-muted font-mono text-[10px] leading-4 mt-2">
              Cada monitor es una autoprueba que el auto hace manejando. Al borrar los códigos o desconectar la batería vuelven
              a pendiente.
            </Text>
          </>
        )}
        <Actions>
          <ActionChip label={loading ? 'Leyendo…' : 'Leer de nuevo'} icon="refresh" onPress={() => void read()} disabled={!connected || loading} />
          <ActionChip label="Preguntar" icon="chat-processing-outline" onPress={ask} />
        </Actions>
      </ScrollView>
    </SafeAreaView>
  );
}
