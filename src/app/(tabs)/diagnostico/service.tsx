// Diagnóstico › Service (C): the maintenance log — oil, filters, brakes, VTV —
// with what was done, when and at how many km. Until 2026-10-31 it was only
// reachable through the chat ("Anotá que cambié el aceite"); the chat still
// reads it to answer "¿cuándo toca el próximo?".

import { useCallback, useState } from 'react';
import { FlatList, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { container } from '@/data/container';
import type { ServiceEntry } from '@/domain/service/service-log';
import { ActionChip } from '@/presentation/components/diagnosis/parts';
import { BackHeader } from '@/presentation/components/layout/BackHeader';
import { PillButton } from '@/presentation/components/layout/PillButton';
import { COLORS } from '@/presentation/theme';

const date = (ms: number) => new Date(ms).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });

export default function ServiceScreen() {
  const [entries, setEntries] = useState<ServiceEntry[]>([]);
  const [adding, setAdding] = useState(false);
  const refresh = useCallback(() => setEntries(container.serviceLog.list()), []);
  useFocusEffect(refresh);
  return (
    <SafeAreaView className="flex-1 bg-brand-bg" edges={['top']}>
      <BackHeader title="Service" right={<ActionChip label="Agregar" icon="plus" onPress={() => setAdding(true)} />} />
      <FlatList
        data={entries}
        keyExtractor={(e) => e.id}
        contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={
          <Text className="text-brand-muted font-mono text-xs leading-5 mt-8 text-center">
            Todavía no hay nada anotado. Tocá «Agregar» o decile al asistente «Anotá que hoy cambié el aceite».
          </Text>
        }
        renderItem={({ item }) => (
          <View className="bg-brand-surface rounded-2xl px-4 py-3 mb-2">
            <View className="flex-row justify-between gap-3">
              <Text className="text-brand-text font-mono text-sm flex-1">{item.item}</Text>
              <Text className="text-brand-muted font-mono text-[11px]">{date(item.at)}</Text>
            </View>
            <Text className="text-brand-muted font-mono text-[11px] mt-1">
              {item.car}
              {item.km != null ? ` · ${item.km.toLocaleString('es-AR')} km` : ''}
            </Text>
            {item.note ? <Text className="text-brand-muted font-mono text-[11px] mt-1">{item.note}</Text> : null}
          </View>
        )}
      />
      {/* Mounted per opening, so it starts from the last car written down. */}
      <AddSheet
        key={adding ? 'open' : 'closed'}
        visible={adding}
        lastCar={entries[0]?.car ?? null}
        onClose={() => setAdding(false)}
        onAdd={(e) => {
          container.serviceLog.add(e);
          setAdding(false);
          refresh();
        }}
      />
    </SafeAreaView>
  );
}

function AddSheet({ visible, lastCar, onClose, onAdd }: { visible: boolean; lastCar: string | null; onClose: () => void; onAdd: (e: ServiceEntry) => void }) {
  const [car, setCar] = useState(lastCar ?? '');
  const [item, setItem] = useState('');
  const [km, setKm] = useState('');
  const [note, setNote] = useState('');
  const carValue = car;
  const kmValue = km.trim() ? Number(km.replace(/\D/g, '')) : null;
  const ok = carValue.trim().length >= 2 && item.trim().length >= 2;
  const save = () => {
    const at = Date.now();
    onAdd({ id: `s-${at.toString(36)}`, at, car: carValue.trim(), vin: container.vehicleTools.knownVin(), item: item.trim(), km: kmValue, note: note.trim() || null });
    setItem('');
    setKm('');
    setNote('');
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/60" onPress={onClose} />
      <View className="bg-brand-surface rounded-t-3xl px-5 pt-5 pb-8 gap-3">
        <Text className="text-brand-text font-mono-bold text-base">Anotar un service</Text>
        <Input label="Auto" value={carValue} onChange={setCar} placeholder="Ej.: Ford Focus 2013" />
        <Input label="Qué se hizo" value={item} onChange={setItem} placeholder="Ej.: cambio de aceite y filtro" />
        <Input label="Kilómetros" value={km} onChange={setKm} placeholder="Ej.: 85000" numeric />
        <Input label="Nota" value={note} onChange={setNote} placeholder="Opcional" />
        <PillButton label="Guardar" disabled={!ok} onPress={save} />
      </View>
    </Modal>
  );
}

function Input({ label, value, onChange, placeholder, numeric }: { label: string; value: string; onChange: (v: string) => void; placeholder: string; numeric?: boolean }) {
  return (
    <View>
      <Text className="text-brand-muted font-mono text-[10px] mb-1">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={COLORS.muted}
        keyboardType={numeric ? 'number-pad' : 'default'}
        className="bg-brand-bg border border-brand-border rounded-xl px-3 py-2 text-brand-text font-mono text-sm"
      />
    </View>
  );
}
