// "Sonido del motor": records 8 seconds at idle, keeps a fingerprint (never
// the audio) and compares it with this car's reference, recorded when the
// engine was healthy. A comparison to know where to look, not a diagnosis.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { requireOptionalNativeModule } from 'expo';
import type { AudioStreamBuffer, AudioStreamOptions, AudioStreamResult } from 'expo-audio';
import { container } from '@/data/container';
import { engineSoundStore } from '@/data/sound/engine-sound-store';
import { compare, fingerprint, SOUND_RATE, type SoundComparison, type SoundPrint } from '@/domain/sound/engine-sound';
import { resample, toMono } from '@/domain/voice/pcm';
import { BackHeader } from '@/presentation/components/layout/BackHeader';
import { PillButton } from '@/presentation/components/layout/PillButton';
import { SectionHeader } from '@/presentation/components/layout/SectionHeader';
import { ensurePermission } from '@/presentation/services/permissions';
import { useOBDStore } from '@/store/obdStore';

const hasAudioStream = requireOptionalNativeModule('ExpoAudio') != null;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ExpoAudio = hasAudioStream ? (require('expo-audio') as typeof import('expo-audio')) : null;
const noStream = (_o?: AudioStreamOptions): AudioStreamResult => ({ stream: null as never, isStreaming: false });
const useStream: (o?: AudioStreamOptions) => AudioStreamResult = ExpoAudio ? ExpoAudio.useAudioStream : noStream;

const SECONDS = 8;
const RPM_FRESH_MS = 3000;

type Mode = 'reference' | 'listen';

// The buffers as one recording, cut to `length` samples.
function joined(chunks: readonly Int16Array[], length: number): Int16Array {
  const pcm = new Int16Array(length);
  let at = 0;
  for (const c of chunks) {
    if (at >= length) break;
    pcm.set(c.subarray(0, Math.min(c.length, length - at)), at);
    at += c.length;
  }
  return pcm;
}

const mean = (l: readonly number[]): number | null => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : null);

export default function EngineSoundScreen() {
  const vin = container.vehicleTools.knownVin();
  const [reference, setReference] = useState<SoundPrint | null>(() => engineSoundStore.reference(vin));
  const [recording, setRecording] = useState<Mode | null>(null);
  const [left, setLeft] = useState(0);
  const [result, setResult] = useState<SoundComparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const chunks = useRef<Int16Array[]>([]);
  const rpms = useRef<number[]>([]);
  const collected = useRef(0);
  const mode = useRef<Mode | null>(null);

  const onBuffer = useCallback((buf: AudioStreamBuffer) => {
    if (!mode.current) return;
    const mono = resample(toMono(new Int16Array(buf.data), buf.channels), buf.sampleRate, SOUND_RATE);
    chunks.current.push(mono);
    collected.current += mono.length;
    const p = useOBDStore.getState().parameters.RPM;
    if (p && Date.now() - p.timestamp.getTime() < RPM_FRESH_MS) rpms.current.push(p.value);
    setLeft(Math.max(0, Math.ceil(SECONDS - collected.current / SOUND_RATE)));
    if (collected.current < SECONDS * SOUND_RATE) return;
    // Enough audio: the rest of the buffers are ignored and the effect below stops the microphone.
    const m = mode.current;
    mode.current = null;
    const print = fingerprint(joined(chunks.current, collected.current), { rpm: mean(rpms.current), at: Date.now() });
    chunks.current = [];
    if (m === 'reference') {
      engineSoundStore.setReference(vin, print);
      setReference(print);
    } else {
      const ref = engineSoundStore.reference(vin);
      if (ref) setResult(compare(ref, print));
    }
    setRecording(null);
  }, [vin]);
  const { stream } = useStream({ sampleRate: SOUND_RATE, channels: 1, encoding: 'int16', onBuffer });

  // Not recording (finished or cancelled): the microphone goes off.
  useEffect(() => {
    if (recording) return;
    try {
      stream?.stop();
    } catch {
      // not started
    }
  }, [recording, stream]);

  const start = async (m: Mode) => {
    setError(null);
    setResult(null);
    if (!ExpoAudio || !stream) return setError('El micrófono no está disponible en esta versión de la app.');
    if (!(await ensurePermission('microphone'))) return;
    const perm = await ExpoAudio.requestRecordingPermissionsAsync();
    if (!perm.granted) return setError('Sin permiso de micrófono.');
    chunks.current = [];
    rpms.current = [];
    collected.current = 0;
    mode.current = m;
    setLeft(SECONDS);
    setRecording(m);
    await stream.start();
  };

  const cancel = () => {
    mode.current = null;
    chunks.current = [];
    setRecording(null);
  };

  return (
    <SafeAreaView className="flex-1 bg-brand-bg" edges={['top', 'bottom']}>
      <BackHeader title="Sonido del motor" />
      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingVertical: 12 }}>
        <Text className="text-brand-muted font-mono text-xs leading-5 mb-4">
          Con el motor caliente y en ralentí, capó abierto y el teléfono a unos 30 cm del motor, siempre en el mismo lugar.
          Primero grabá una referencia con el motor sano; después, cuando algo suene raro, escuchalo y se compara con ella.
          Solo se guarda una huella del sonido, nunca la grabación.
        </Text>

        <SectionHeader title="Referencia" />
        <Text className="text-brand-text font-mono text-xs mb-3">
          {reference
            ? `Grabada el ${new Date(reference.at).toLocaleString('es-AR')}${reference.rpm != null ? ` a ${Math.round(reference.rpm)} rpm` : ''}.`
            : 'Todavía no hay una referencia para este auto.'}
        </Text>
        <PillButton
          label={recording === 'reference' ? `Grabando… ${left} s` : reference ? 'Grabar de nuevo la referencia' : 'Grabar referencia (motor sano)'}
          variant="secondary"
          onPress={() => void start('reference')}
          loading={recording === 'reference'}
          disabled={recording != null}
        />

        <View className="mt-6">
          <SectionHeader title="Escuchar ahora" />
          <PillButton
            label={recording === 'listen' ? `Escuchando… ${left} s` : 'Escuchar y comparar'}
            onPress={() => void start('listen')}
            loading={recording === 'listen'}
            disabled={recording != null || !reference}
          />
          {recording && (
            <View className="mt-2">
              <PillButton label="Cancelar" variant="secondary" onPress={cancel} />
            </View>
          )}
        </View>

        {error && <Text className="text-brand-red font-mono text-xs mt-3">{error}</Text>}

        {result && (
          <View className="bg-brand-surface rounded-2xl p-4 mt-4">
            <Text className={`font-mono-bold text-sm mb-2 ${result.verdict === 'similar' ? 'text-brand-mint' : 'text-brand-amber'}`}>
              {result.verdict === 'similar' ? 'Suena como la referencia.' : 'Suena distinto de la referencia:'}
            </Text>
            {result.findings.map((f) => (
              <Text key={f} className="text-brand-text font-mono text-xs leading-5 mb-1">
                - {f}
              </Text>
            ))}
            {result.caveats.map((c) => (
              <Text key={c} className="text-brand-muted font-mono text-[10px] leading-4 mt-1">
                {c}
              </Text>
            ))}
            <Text className="text-brand-muted font-mono text-[10px] leading-4 mt-3">
              Es una comparación, no un diagnóstico. Si algo cambió, pedile al asistente un diagnóstico o leé los códigos.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
