// Speaking to the assistant (M6). The text goes through the same send() as
// typing (ADR-0007 §3: the model always gets text). Two engines, never both
// (the microphone is one):
//
// - Online: the microphone streams PCM to Voxtral Realtime on the Z440
//   (expo-audio → /tools/v1/stt), with partial text as it is heard. The phrase
//   ends after a second of silence, or with a second tap.
// - Offline, or if the speech server does not answer at the start: Android's
//   own recognizer (expo-speech-recognition), on the phone if the Spanish
//   offline pack is installed.
//
// Both native modules are optional: an older Dev APK keeps the chat, with
// whatever engine it has (or no microphone). Only types come from the
// packages unless the module is there.

import { useCallback, useEffect, useRef, useState } from 'react';
import { requireOptionalNativeModule } from 'expo';
import NetInfo from '@react-native-community/netinfo';
import type { ExpoSpeechRecognitionModuleType } from 'expo-speech-recognition/build/ExpoSpeechRecognitionModule.types';
import type { AudioStreamBuffer, AudioStreamOptions, AudioStreamResult } from 'expo-audio';
import { container } from '@/data/container';
import { nativeSocket, RealtimeSttSession } from '@/data/stt/realtime-stt';
import { bytesToBase64, pcm16Bytes, resample, rms, SilenceDetector, STT_RATE, toMono, withComfortNoise } from '@/domain/voice/pcm';

const Recognizer = requireOptionalNativeModule<ExpoSpeechRecognitionModuleType>('ExpoSpeechRecognition');
const hasAudioStream = requireOptionalNativeModule('ExpoAudio') != null;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ExpoAudio = hasAudioStream ? (require('expo-audio') as typeof import('expo-audio')) : null;
const noStream = (_o?: AudioStreamOptions): AudioStreamResult => ({ stream: null as never, isStreaming: false });
const useStream: (o?: AudioStreamOptions) => AudioStreamResult = ExpoAudio ? ExpoAudio.useAudioStream : noStream;

export const voiceInputAvailable = Recognizer != null || hasAudioStream;

export type VoiceInputState = 'idle' | 'listening' | 'finishing';

const LANG = 'es-AR';
const FALLBACK_LANG = 'es-ES';
const END_SILENCE_MS = 1500;
// The server must say "ready" this soon, or the phone's recognizer takes over.
const READY_TIMEOUT_MS = 2_500;

const ERROR_TEXT: Record<string, string> = {
  'not-allowed': 'Sin permiso para el micrófono. Habilitalo en los ajustes de Android.',
  'service-not-allowed': 'El reconocimiento de voz de Android no está disponible en este teléfono.',
  'language-not-supported': 'Falta el español para reconocer sin conexión: descargalo en Ajustes de Android → Sistema → Idiomas → Reconocimiento de voz.',
  network: 'Sin conexión para reconocer la voz. Probá de nuevo o escribí.',
  busy: 'El micrófono está ocupado. Probá en un momento.',
  'audio-capture': 'No se pudo usar el micrófono.',
};

// Android's recognizer; `offline` asks for recognition on the phone.
function beginRecognizer(lang: string, offline: boolean): void {
  if (!Recognizer) return;
  Recognizer.start({
    lang,
    interimResults: true,
    continuous: false,
    maxAlternatives: 1,
    requiresOnDeviceRecognition: offline && Recognizer.supportsOnDeviceRecognition(),
    androidIntentOptions: { EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: END_SILENCE_MS },
  });
}

async function isOffline(): Promise<boolean> {
  const net = await NetInfo.fetch().catch(() => null);
  return net?.isConnected === false || net?.isInternetReachable === false;
}

export function useVoiceInput(onFinal: (text: string) => void) {
  const [state, setState] = useState<VoiceInputState>('idle');
  const [partial, setPartial] = useState('');
  const [error, setError] = useState<string | null>(null);
  const finalRef = useRef(onFinal);
  useEffect(() => {
    finalRef.current = onFinal;
  }, [onFinal]);

  // ── Server engine (Voxtral) ────────────────────────────────────────────────
  const session = useRef<RealtimeSttSession | null>(null);
  const detector = useRef<SilenceDetector | null>(null);
  const readyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishing = useRef(false);

  const onBuffer = useCallback((buf: AudioStreamBuffer) => {
    const s = session.current;
    const d = detector.current;
    if (!s || !d || finishing.current) return;
    const mono = toMono(new Int16Array(buf.data), buf.channels);
    const samples = resample(mono, buf.sampleRate, STT_RATE);
    const level = rms(samples);
    s.sendAudio(bytesToBase64(pcm16Bytes(withComfortNoise(samples))));
    const phase = d.push(level, (samples.length / STT_RATE) * 1000);
    if (phase === 'ended') void finishServer();
    else if (phase === 'no_speech') cancelServer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { stream } = useStream({ sampleRate: STT_RATE, channels: 1, encoding: 'int16', onBuffer });
  const streamRef = useRef(stream);
  useEffect(() => {
    streamRef.current = stream;
  }, [stream]);

  function stopMic(): void {
    if (readyTimer.current) clearTimeout(readyTimer.current);
    readyTimer.current = null;
    try {
      streamRef.current?.stop();
    } catch {
      // not started
    }
  }

  function cancelServer(): void {
    stopMic();
    session.current?.cancel();
    session.current = null;
    detector.current = null;
    setPartial('');
    setState('idle');
  }

  async function finishServer(): Promise<void> {
    const s = session.current;
    if (!s || finishing.current) return;
    finishing.current = true;
    stopMic();
    setState('finishing');
    try {
      const text = await s.finish();
      if (text) finalRef.current(text);
    } catch {
      setError('No se pudo reconocer la voz. Probá de nuevo o escribí.');
    } finally {
      finishing.current = false;
      session.current = null;
      detector.current = null;
      setPartial('');
      setState('idle');
    }
  }

  // The server failed before hearing anything: the phone's recognizer listens instead.
  function fallBackToRecognizer(): void {
    cancelServer();
    if (!Recognizer) {
      setError('El reconocimiento de voz no está disponible ahora. Escribí tu pregunta.');
      return;
    }
    triedFallback.current = false;
    lastOffline.current = false;
    beginRecognizer(LANG, false);
  }

  async function startServer(key: string): Promise<boolean> {
    if (!ExpoAudio || !stream) return false;
    const perm = await ExpoAudio.requestRecordingPermissionsAsync();
    if (!perm.granted) {
      setError(ERROR_TEXT['not-allowed']!);
      return true;
    }
    const url = `${container.toolsUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/v1/stt`;
    let heard = false;
    session.current = new RealtimeSttSession(
      url,
      key,
      (e) => {
        if (e.type === 'ready' && readyTimer.current) {
          clearTimeout(readyTimer.current);
          readyTimer.current = null;
        } else if (e.type === 'partial') {
          heard = true;
          setPartial(e.text);
        } else if (e.type === 'error' && !heard && !finishing.current) fallBackToRecognizer();
      },
      nativeSocket,
    );
    detector.current = new SilenceDetector();
    readyTimer.current = setTimeout(() => {
      if (!heard) fallBackToRecognizer();
    }, READY_TIMEOUT_MS);
    setError(null);
    setState('listening');
    await stream.start();
    return true;
  }

  // ── Phone engine (Android recognizer) ──────────────────────────────────────
  const triedFallback = useRef(false);
  const lastOffline = useRef(false);

  useEffect(() => {
    if (!Recognizer) return;
    const subs = [
      Recognizer.addListener('start', () => {
        setState('listening');
        setError(null);
      }),
      Recognizer.addListener('end', () => {
        setState('idle');
        setPartial('');
      }),
      Recognizer.addListener('result', (e) => {
        const text = e.results[0]?.transcript?.trim() ?? '';
        if (!e.isFinal) {
          setPartial(text);
          return;
        }
        setPartial('');
        if (text) finalRef.current(text);
      }),
      Recognizer.addListener('error', (e) => {
        setState('idle');
        setPartial('');
        // Nothing said, or stopped by the user: not an error worth showing.
        if (e.error === 'no-speech' || e.error === 'aborted' || e.error === 'speech-timeout') return;
        if (e.error === 'language-not-supported' && !triedFallback.current) {
          triedFallback.current = true;
          beginRecognizer(FALLBACK_LANG, lastOffline.current);
          return;
        }
        setError(ERROR_TEXT[e.error] ?? `No se pudo reconocer la voz (${e.error}).`);
      }),
    ];
    return () => subs.forEach((sub) => sub.remove());
  }, []);

  async function startRecognizer(offline: boolean): Promise<void> {
    if (!Recognizer) return;
    const perm = await Recognizer.requestPermissionsAsync();
    if (!perm.granted) {
      setError(ERROR_TEXT['not-allowed']!);
      return;
    }
    if (!Recognizer.isRecognitionAvailable()) {
      setError(ERROR_TEXT['service-not-allowed']!);
      return;
    }
    triedFallback.current = false;
    lastOffline.current = offline;
    beginRecognizer(LANG, offline);
  }

  // Never leave the microphone open when the screen goes away.
  useEffect(
    () => () => {
      Recognizer?.abort();
      session.current?.cancel();
      try {
        streamRef.current?.stop();
      } catch {
        // not started
      }
    },
    [],
  );

  // ── Public ─────────────────────────────────────────────────────────────────
  const start = useCallback(async () => {
    setError(null);
    const offline = await isOffline();
    const key = container.account.llmCredentials()?.apiKey;
    if (!offline && key && (await startServer(key))) return;
    await startRecognizer(offline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream]);

  // Ends now; what was heard so far becomes the final text.
  const stop = useCallback(() => {
    if (session.current) void finishServer();
    else Recognizer?.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const clearError = useCallback(() => setError(null), []);

  return { state, partial, error, start, stop, clearError };
}
