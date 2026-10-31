// Diagnóstico › Batería (B): the voltage now, read with the engine speed so the
// verdict knows whether the alternator is charging.

import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { batteryVerdict } from '@/domain/diagnosis/views';
import { ActionChip, Actions, ReadState, VerdictCard } from '@/presentation/components/diagnosis/parts';
import { BackHeader } from '@/presentation/components/layout/BackHeader';
import { useCarRead } from '@/presentation/hooks/useCarRead';
import { askInNewConversation } from '@/presentation/hooks/useAssistant';

type Value = { value: number | null; unit: string } | undefined;

export default function BatteryScreen() {
  const { data, loading, error, read, connected } = useCarRead({ name: 'read_pids', pids: ['VOLTAGE', 'RPM'] });
  const volts = (data?.VOLTAGE as Value)?.value ?? null;
  const rpm = (data?.RPM as Value)?.value ?? null;
  const verdict = volts != null ? batteryVerdict(volts, rpm == null ? null : rpm > 300) : null;
  const ask = () => {
    askInNewConversation('¿Cómo está la batería?', verdict ? `${verdict.title}. ${verdict.detail}` : null);
    router.navigate('/');
  };
  return (
    <SafeAreaView className="flex-1 bg-brand-bg" edges={['top']}>
      <BackHeader title="Batería" />
      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingVertical: 16 }}>
        <ReadState loading={loading && !verdict} error={error ?? (data && volts == null ? 'El auto no informa la tensión (PID 42).' : null)} />
        {verdict && <VerdictCard {...verdict} />}
        <Text className="text-brand-muted font-mono text-[10px] leading-4">
          La tensión que informa el auto en el conector OBD. Para la prueba de arranque, mirá En vivo mientras das arranque:
          bajar de 9,6 V indica una batería floja.
        </Text>
        <Actions>
          <ActionChip label={loading ? 'Leyendo…' : 'Leer de nuevo'} icon="refresh" onPress={() => void read()} disabled={!connected || loading} />
          <ActionChip label="Preguntar" icon="chat-processing-outline" onPress={ask} />
        </Actions>
      </ScrollView>
    </SafeAreaView>
  );
}
