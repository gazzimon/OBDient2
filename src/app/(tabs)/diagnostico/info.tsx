// Diagnóstico › Información (B): the car's VIN, the adapter and what the engine
// computer announced it can read.

import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Field, ReadState, ActionChip, Actions } from '@/presentation/components/diagnosis/parts';
import { BackHeader } from '@/presentation/components/layout/BackHeader';
import { SectionHeader } from '@/presentation/components/layout/SectionHeader';
import { useCarRead } from '@/presentation/hooks/useCarRead';
import { useOBDStore } from '@/store/obdStore';

interface VehicleInfo {
  vin: string | null;
  vinWellFormed: boolean;
  supportedPids: string[];
  unconfirmedPids?: string[];
  pidDiscovery: { status: 'known' | 'partial' | 'unknown' };
}

const DISCOVERY = { known: 'completo', partial: 'parcial', unknown: 'desconocido' } as const;

export default function InfoScreen() {
  const { data, loading, error, read, connected } = useCarRead({ name: 'read_vehicle_info' });
  const session = useOBDStore((s) => s.session);
  const deviceName = useOBDStore((s) => s.deviceName);
  const d = data as VehicleInfo | null;
  return (
    <SafeAreaView className="flex-1 bg-brand-bg" edges={['top']}>
      <BackHeader title="Información" />
      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingVertical: 16 }}>
        <ReadState loading={loading && !d} error={error} />
        {d && (
          <>
            <SectionHeader title="Auto" />
            <Field label="VIN" value={d.vin ?? 'no lo informa'} />
            {d.vin && !d.vinWellFormed && <Text className="text-brand-amber font-mono text-[10px] mt-1">El VIN no tiene el formato esperado.</Text>}
            <Field label="Datos que informa" value={`${d.supportedPids.length} · descubrimiento ${DISCOVERY[d.pidDiscovery.status]}`} />
            <Text selectable className="text-brand-muted font-mono text-[10px] leading-4 mt-2">
              {d.supportedPids.join(', ')}
              {d.unconfirmedPids?.length ? `\nSin confirmar: ${d.unconfirmedPids.join(', ')}` : ''}
            </Text>
          </>
        )}
        {session && (
          <>
            <SectionHeader title="Adaptador" />
            <Field label="Nombre" value={deviceName ?? '—'} />
            <Field label="Chip" value={session.identity.stn ?? `${session.identity.elm || 'ELM327'} (sin comandos STN)`} />
            <Field label="Protocolo" value={session.protocol} />
          </>
        )}
        <Actions>
          <ActionChip label={loading ? 'Leyendo…' : 'Leer de nuevo'} icon="refresh" onPress={() => void read()} disabled={!connected || loading} />
        </Actions>
      </ScrollView>
    </SafeAreaView>
  );
}
