// "Informe PDF": reads the car now (codes, monitors, live values), weighs the
// likely causes with what the client reported, and shares a PDF for the
// workshop or the owner. Without the adapter it still makes a report from the
// symptoms and the history on the phone.

import { useCallback, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { container } from '@/data/container';
import { MAX_SAVED_REPORTS, type SavedReport } from '@/domain/report/saved-reports';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { BackHeader } from '@/presentation/components/layout/BackHeader';
import { PillButton } from '@/presentation/components/layout/PillButton';
import { SectionHeader } from '@/presentation/components/layout/SectionHeader';
import { deleteSavedReport, shareDiagnosticReport, shareReportFile, type ReportStep } from '@/presentation/services/diagnostic-report';
import { COLORS } from '@/presentation/theme';
import { useOBDStore } from '@/store/obdStore';

const MAX = MAX_SAVED_REPORTS;

const STEP_LABEL: Record<ReportStep, string> = {
  reading: 'Leyendo el auto…',
  diagnosing: 'Buscando causas…',
  printing: 'Armando el PDF…',
};

export default function ReportScreen() {
  const connected = useOBDStore((s) => s.connectionState === 'connected');
  const [workshop, setWorkshop] = useState('');
  const [symptoms, setSymptoms] = useState('');
  const [notes, setNotes] = useState('');
  const [step, setStep] = useState<ReportStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedReport[]>([]);
  const refresh = useCallback(() => setSaved(container.savedReports.list()), []);
  useFocusEffect(refresh);

  const generate = async () => {
    setError(null);
    try {
      await shareDiagnosticReport({ workshop: workshop || null, symptoms: symptoms || null, notes: notes || null }, setStep);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo generar el informe.');
    } finally {
      setStep(null);
      refresh();
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-brand-bg" edges={['top', 'bottom']}>
      <BackHeader title="Informes" />
      <KeyboardAwareScrollView className="flex-1 px-4" contentContainerStyle={{ paddingVertical: 12 }} bottomOffset={24}>
        <Text className="text-brand-muted font-mono text-xs leading-5 mb-2">
          {connected
            ? 'Lee códigos, monitores y valores en vivo, busca las causas más probables y arma un PDF para compartir. Mejor con el motor en marcha y el auto detenido.'
            : 'Sin el adaptador, el informe usa lo que cuente el cliente y el historial guardado en el teléfono. Conectalo desde Diagnóstico para incluir la lectura del auto.'}
        </Text>

        <SectionHeader title="Taller o mecánico" />
        <Field value={workshop} onChange={setWorkshop} placeholder="Opcional: aparece en el encabezado" />

        <SectionHeader title="Qué nota el cliente" />
        <Field value={symptoms} onChange={setSymptoms} placeholder="Ej.: tironea al acelerar, olor a nafta, se prendió el check" multiline />

        <SectionHeader title="Observaciones" />
        <Field value={notes} onChange={setNotes} placeholder="Opcional: lo que revisaste o recomendás" multiline />

        <Text className="text-brand-muted font-mono text-[10px] leading-4 mt-3 mb-3">
          El VIN sale sin sus últimos 6 caracteres. Los últimos {MAX} informes quedan guardados en el teléfono.
        </Text>
        <PillButton label={step ? STEP_LABEL[step] : 'Generar y compartir'} onPress={generate} loading={step != null} />
        {error && <Text className="text-brand-red font-mono text-xs mt-3">{error}</Text>}

        <SectionHeader title="Guardados" />
        {saved.length === 0 && <Text className="text-brand-muted font-mono text-xs mb-4">Todavía no hay informes guardados.</Text>}
        {saved.map((r) => (
          <View key={r.id} className="flex-row items-center bg-brand-surface rounded-2xl px-4 py-3 mb-2">
            <View className="flex-1">
              <Text className="text-brand-text font-mono text-xs">{new Date(r.at).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Text>
              <Text className="text-brand-muted font-mono text-[10px] mt-0.5">
                {[r.make, r.workshop, r.codes == null ? 'sin lectura del auto' : r.codes.length ? r.codes.join(' · ') : 'sin códigos'].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <Pressable hitSlop={8} accessibilityLabel="Compartir el informe" onPress={() => void shareReportFile(r.uri).catch(() => setError('No se pudo compartir el informe.'))} className="mr-4 active:opacity-60">
              <MaterialCommunityIcons name="share-variant-outline" size={18} color={COLORS.text} />
            </Pressable>
            <Pressable
              hitSlop={8}
              accessibilityLabel="Borrar el informe"
              onPress={() => {
                deleteSavedReport(r.id);
                refresh();
              }}
              className="active:opacity-60"
            >
              <MaterialCommunityIcons name="delete-outline" size={18} color={COLORS.red} />
            </Pressable>
          </View>
        ))}
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

function Field({ value, onChange, placeholder, multiline = false }: { value: string; onChange: (v: string) => void; placeholder: string; multiline?: boolean }) {
  return (
    <View className="bg-brand-surface border border-brand-border rounded-2xl px-4 mb-2">
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={COLORS.muted}
        multiline={multiline}
        maxLength={multiline ? 400 : 80}
        className="text-brand-text font-mono text-sm py-3"
        style={multiline ? { minHeight: 64, textAlignVertical: 'top' } : undefined}
      />
    </View>
  );
}
