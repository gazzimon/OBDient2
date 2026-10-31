// Diagnóstico › Códigos (C): stored, pending and permanent codes as Autel lists
// them — code, who reported it, what it means — each opening its detail. Without
// the adapter it shows the last codes read on this phone, with their date.
// Clearing asks with the same modal as the chat.

import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { container } from '@/data/container';
import type { DtcKind } from '@/domain/assistant/tools';
import { ecuLabel } from '@/domain/diagnosis/views';
import { ActionChip, Actions, ReadState, StatusRow } from '@/presentation/components/diagnosis/parts';
import { BackHeader } from '@/presentation/components/layout/BackHeader';
import { askInNewConversation } from '@/presentation/hooks/useAssistant';
import { readCar, useCarReads, type DescribedDtc } from '@/presentation/services/car-reads';
import { COLORS } from '@/presentation/theme';
import { useOBDStore } from '@/store/obdStore';

const KINDS: readonly { kind: DtcKind; label: string }[] = [
  { kind: 'stored', label: 'Guardados' },
  { kind: 'pending', label: 'Pendientes' },
  { kind: 'permanent', label: 'Permanentes' },
];

type Read = { codes: DescribedDtc[]; at: number; saved: boolean };

function savedReads(known: Readonly<Record<string, DescribedDtc>>): Partial<Record<DtcKind, Read>> {
  const vin = container.vehicleTools.knownVin();
  const out: Partial<Record<DtcKind, Read>> = {};
  for (const { kind } of KINDS) {
    const last = container.faults.list(vin ?? undefined).find((e) => e.type === 'codes' && e.kind === kind);
    if (last?.type === 'codes') out[kind] = { codes: last.codes.map((c) => known[c.code] ?? { code: c.code, ecu: c.ecu, description: null }), at: last.lastSeenAt, saved: true };
  }
  return out;
}

export default function CodesScreen() {
  const connected = useOBDStore((s) => s.connectionState === 'connected');
  const known = useCarReads((s) => s.codes);
  const [kind, setKind] = useState<DtcKind>('stored');
  // The last read kept on the phone, until (or without) a fresh one.
  const [reads, setReads] = useState<Partial<Record<DtcKind, Read>>>(() => savedReads(known));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const read = useCallback(async (k: DtcKind) => {
    setLoading(true);
    setError(null);
    try {
      const out = await readCar({ name: 'read_dtcs', kind: k });
      if (out.ok) setReads((r) => ({ ...r, [k]: { codes: (out.data as { codes: DescribedDtc[] }).codes, at: Date.now(), saved: false } }));
      else setError(out.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // A fresh read each time the screen shows; another kind is read when chosen.
  useFocusEffect(
    useCallback(() => {
      if (connected) void read(kind);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [connected]),
  );
  const choose = (k: DtcKind) => {
    setKind(k);
    if (connected && (reads[k]?.saved ?? true)) void read(k);
  };

  const clear = async () => {
    setNotice(null);
    const out = await readCar({ name: 'clear_dtcs' });
    if (out.ok) {
      setNotice('Códigos borrados. Los monitores vuelven a pendiente hasta que se maneje unos días.');
      void read('stored');
    } else if (out.error !== 'cancelled' && out.error !== 'declined_by_user') setError(out.message);
  };

  const current = reads[kind];
  const ask = () => {
    const list = current?.codes.map((c) => `${c.code}${c.description ? ` (${c.description})` : ''}`).join('; ') ?? null;
    askInNewConversation('Explicame estos códigos y qué reviso primero', list ? `Códigos ${KINDS.find((k) => k.kind === kind)!.label.toLowerCase()}: ${list}` : null);
    router.navigate('/');
  };

  return (
    <SafeAreaView className="flex-1 bg-brand-bg" edges={['top']}>
      <BackHeader title="Códigos" />
      <View className="flex-row gap-1 bg-brand-surface rounded-xl p-1 mx-4 mt-3">
        {KINDS.map((k) => (
          <Pressable
            key={k.kind}
            onPress={() => choose(k.kind)}
            accessibilityRole="tab"
            accessibilityState={{ selected: kind === k.kind }}
            className="flex-1 items-center py-2 rounded-lg active:opacity-60"
            style={{ backgroundColor: kind === k.kind ? COLORS.border : 'transparent' }}
          >
            <Text className="font-mono text-xs" style={{ color: kind === k.kind ? COLORS.text : COLORS.muted }}>
              {k.label}
              {reads[k.kind] ? ` ${reads[k.kind]!.codes.length}` : ''}
            </Text>
          </Pressable>
        ))}
      </View>
      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingVertical: 16 }}>
        <ReadState loading={loading && !current} error={error ?? (!connected && !current ? 'Conectá el adaptador para leer los códigos.' : null)} />
        {notice && <Text className="font-mono text-xs leading-5 mb-3" style={{ color: COLORS.mint }}>{notice}</Text>}
        {current && (
          <Text className="text-brand-muted font-mono text-[10px] mb-3">
            {current.saved ? `Última lectura guardada: ${new Date(current.at).toLocaleString('es-AR')}` : `Leídos recién${loading ? ' · leyendo de nuevo…' : ''}`}
          </Text>
        )}
        {current && current.codes.length === 0 && <StatusRow tone="ok" title="Sin códigos" detail="El auto no informa códigos de este tipo." />}
        {current?.codes.map((c) => (
          <StatusRow
            key={`${c.code}:${c.ecu ?? ''}`}
            tone="bad"
            title={c.code}
            detail={`${ecuLabel(c.ecu)}${c.description ? `\n${c.description}` : ''}`}
            onPress={() => router.push({ pathname: '/diagnostico/codigos/[code]', params: { code: c.code } })}
          />
        ))}
        <Actions>
          <ActionChip label={loading ? 'Leyendo…' : 'Leer de nuevo'} icon="refresh" onPress={() => void read(kind)} disabled={!connected || loading} />
          <ActionChip label="Preguntar" icon="chat-processing-outline" onPress={ask} disabled={!current?.codes.length} />
          <ActionChip label="Borrar códigos…" icon="delete-outline" onPress={() => void clear()} disabled={!connected || !reads.stored?.codes.length} />
        </Actions>
        <Text className="text-brand-muted font-mono text-[10px] leading-4 mt-4">
          Estos son los códigos de diagnóstico estándar (motor y caja). Los de otros módulos, como ABS o airbag, llegan con la
          lectura por módulo.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
