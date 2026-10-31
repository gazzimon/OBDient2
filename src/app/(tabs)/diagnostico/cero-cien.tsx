// "Prueba 0–100": stop, wait for "Listo", accelerate. The clock starts and
// stops by itself with the OBD speed, so nobody touches the phone while the
// car moves. The power figure needs the car's mass and is an estimate.

import { useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useKeepAwake } from 'expo-keep-awake';
import * as Speech from 'expo-speech';
import { container } from '@/data/container';
import { performanceStore, type SavedRun } from '@/data/performance/performance-store';
import { ABORT_TEXT, AccelerationRun, kwToCv, type RunResult, type RunState } from '@/domain/performance/acceleration';
import { BackHeader } from '@/presentation/components/layout/BackHeader';
import { PillButton } from '@/presentation/components/layout/PillButton';
import { SectionHeader } from '@/presentation/components/layout/SectionHeader';
import { COLORS } from '@/presentation/theme';
import { useOBDStore } from '@/store/obdStore';

// Driver and fuel on top of the curb weight, kg.
const DRIVER_KG = 80;

export default function PerformanceScreen() {
  useKeepAwake();
  const connected = useOBDStore((s) => s.connectionState === 'connected');
  const vin = container.vehicleTools.knownVin();
  const [mass, setMass] = useState(() => String(performanceStore.massFor(vin) ?? ''));
  const [armed, setArmed] = useState(false);
  const [state, setState] = useState<RunState>({ kind: 'waiting_stop' });
  const [runs, setRuns] = useState<SavedRun[]>(() => performanceStore.runs(vin));
  const run = useRef<AccelerationRun | null>(null);

  useEffect(() => {
    if (!armed) return;
    const kg = Number(mass.replace(',', '.'));
    const massKg = Number.isFinite(kg) && kg > 300 ? kg + DRIVER_KG : null;
    run.current = new AccelerationRun(massKg);
    let last: RunState['kind'] = 'waiting_stop';
    const stop = container.onObdSpeed((kmh, t) => {
      const r = run.current;
      if (!r) return;
      const next = r.push({ t, kmh });
      if (next.kind !== last || next.kind === 'running') setState(next);
      if (next.kind !== last) {
        if (next.kind === 'ready') Speech.speak('Listo. Cuando quieras.', { language: 'es-AR' });
        if (next.kind === 'done') {
          Speech.speak(`Cero a cien en ${String(next.result.t0to100s).replace('.', ' coma ')} segundos.`, { language: 'es-AR' });
          const saved: SavedRun = { at: Date.now(), vin, massKg, result: next.result };
          performanceStore.add(saved);
          setRuns((l) => [saved, ...l]);
          setArmed(false);
        }
        if (next.kind === 'aborted') {
          Speech.speak('Prueba cortada.', { language: 'es-AR' });
          setArmed(false);
        }
      }
      last = next.kind;
    });
    return () => {
      stop();
      run.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed]);

  const start = () => {
    const kg = Number(mass.replace(',', '.'));
    if (Number.isFinite(kg) && kg > 300) performanceStore.setMass(vin, kg);
    setState({ kind: 'waiting_stop' });
    setArmed(true);
  };

  return (
    <SafeAreaView className="flex-1 bg-brand-bg" edges={['top', 'bottom']}>
      <BackHeader title="Prueba 0–100" />
      <KeyboardAwareScrollView className="flex-1 px-4" contentContainerStyle={{ paddingVertical: 12 }} bottomOffset={24}>
        <View className="border border-brand-amber rounded-2xl p-3 mb-4">
          <Text className="text-brand-amber font-mono text-xs leading-5">
            Solo en un lugar cerrado al tránsito o en un predio privado, nunca en la calle. No toques el teléfono mientras
            el auto se mueve: la prueba arranca y termina sola, y te avisa por voz.
          </Text>
        </View>

        {!connected ? (
          <Text className="text-brand-muted font-mono text-xs leading-5">Conectá el adaptador desde Vehículo: la prueba usa la velocidad del auto.</Text>
        ) : (
          <>
            <SectionHeader title="Peso del auto (kg)" />
            <View className="bg-brand-surface border border-brand-border rounded-2xl px-4 mb-1">
              <TextInput
                value={mass}
                onChangeText={setMass}
                keyboardType="numeric"
                placeholder="Peso en vacío de la ficha, ej. 1150"
                placeholderTextColor={COLORS.muted}
                editable={!armed}
                className="text-brand-text font-mono text-sm py-3"
              />
            </View>
            <Text className="text-brand-muted font-mono text-[10px] leading-4 mb-4">
              Opcional, para estimar la potencia. Se le suman {DRIVER_KG} kg de conductor y combustible.
            </Text>

            <View className="bg-brand-surface rounded-2xl p-6 items-center mb-4">
              <Text className="text-brand-muted font-mono text-xs mb-2">{statusText(state, armed)}</Text>
              <Text className="text-brand-text font-mono-bold" style={{ fontSize: 48 }}>
                {bigNumber(state)}
              </Text>
            </View>

            <PillButton label={armed ? 'Cancelar' : 'Preparar prueba'} variant={armed ? 'secondary' : 'primary'} onPress={() => (armed ? setArmed(false) : start())} />

            {state.kind === 'done' && <Result result={state.result} />}
            {state.kind === 'aborted' && <Text className="text-brand-red font-mono text-xs mt-3">{ABORT_TEXT[state.reason]}</Text>}
          </>
        )}

        {runs.length > 0 && (
          <View className="mt-6">
            <SectionHeader title="Pruebas anteriores de este auto" />
            {runs.slice(0, 10).map((r) => (
              <View key={r.at} className="flex-row justify-between py-2 border-b border-brand-border">
                <Text className="text-brand-muted font-mono text-xs">{new Date(r.at).toLocaleString('es-AR')}</Text>
                <Text className="text-brand-text font-mono text-xs">
                  {fmt(r.result.t0to100s)} s{r.result.peakPowerKw != null ? ` · ~${kwToCv(r.result.peakPowerKw)} CV` : ''}
                </Text>
              </View>
            ))}
          </View>
        )}
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

function Result({ result: r }: { result: RunResult }) {
  const rows: [string, string][] = [
    ['0–100 km/h', `${fmt(r.t0to100s)} s`],
    ['0–60 km/h', r.t0to60s != null ? `${fmt(r.t0to60s)} s` : '—'],
    ['Distancia', `${r.distanceM} m`],
    ['Aceleración máxima', `${fmt(r.peakAccelG)} g`],
  ];
  if (r.peakPowerKw != null) rows.push(['Potencia en rueda (estimada)', `~${r.peakPowerKw} kW · ~${kwToCv(r.peakPowerKw)} CV`]);
  return (
    <View className="mt-4">
      {rows.map(([k, v]) => (
        <View key={k} className="flex-row justify-between py-2 border-b border-brand-border">
          <Text className="text-brand-muted font-mono text-xs">{k}</Text>
          <Text className="text-brand-text font-mono text-xs">{v}</Text>
        </View>
      ))}
      <Text className="text-brand-muted font-mono text-[10px] leading-4 mt-2">
        La potencia es una estimación (±20 %): depende del peso real, del viento y de la pendiente. Es en rueda, menor que la
        de ficha.
      </Text>
    </View>
  );
}

function statusText(s: RunState, armed: boolean): string {
  if (!armed && s.kind !== 'done' && s.kind !== 'aborted') return 'Tocá "Preparar prueba"';
  switch (s.kind) {
    case 'waiting_stop':
      return 'Detené el auto por completo';
    case 'ready':
      return 'Listo: acelerá cuando quieras';
    case 'running':
      return 'Midiendo…';
    case 'done':
      return '0–100 km/h';
    case 'aborted':
      return 'Prueba cortada';
  }
}

function bigNumber(s: RunState): string {
  switch (s.kind) {
    case 'running':
      return `${Math.round(s.kmh)} km/h`;
    case 'done':
      return `${fmt(s.result.t0to100s)} s`;
    default:
      return '—';
  }
}

function fmt(v: number): string {
  return v.toFixed(2).replace('.', ',');
}
