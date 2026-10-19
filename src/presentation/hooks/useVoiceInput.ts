// Speaking to the assistant (M6): the phone's own speech recognizer (Android)
// turns the voice into text, which goes through the same send() as typing
// (ADR-0007 §3: the model always gets text).
//
// Push to talk: a tap starts, silence ends it (or a second tap). The words
// show in the input box as they are heard; the final text is handed to
// onFinal. With no connection it asks for on-device recognition, which needs
// the Spanish offline pack installed on the phone.
//
// The native module is optional: a build without it (older Dev APKs) keeps
// the chat working, without the microphone. Only types come from the package,
// so nothing of it loads unless the module is there.

import { useCallback, useEffect, useRef, useState } from 'react';
import { requireOptionalNativeModule } from 'expo';
import NetInfo from '@react-native-community/netinfo';
import type { ExpoSpeechRecognitionModuleType } from 'expo-speech-recognition/build/ExpoSpeechRecognitionModule.types';

const Recognizer = requireOptionalNativeModule<ExpoSpeechRecognitionModuleType>('ExpoSpeechRecognition');
export const voiceInputAvailable = Recognizer != null;

export type VoiceInputState = 'idle' | 'listening';

const LANG = 'es-AR';
const FALLBACK_LANG = 'es-ES';
// Silence that ends the phrase.
const END_SILENCE_MS = 1500;

const ERROR_TEXT: Record<string, string> = {
  'not-allowed': 'Sin permiso para el micrófono. Habilitalo en los ajustes de Android.',
  'service-not-allowed': 'El reconocimiento de voz de Android no está disponible en este teléfono.',
  'language-not-supported': 'Falta el español para reconocer sin conexión: descargalo en Ajustes de Android → Sistema → Idiomas → Reconocimiento de voz.',
  network: 'Sin conexión para reconocer la voz. Probá de nuevo o escribí.',
  busy: 'El micrófono está ocupado. Probá en un momento.',
  'audio-capture': 'No se pudo usar el micrófono.',
};

export function useVoiceInput(onFinal: (text: string) => void) {
  const [state, setState] = useState<VoiceInputState>('idle');
  const [partial, setPartial] = useState('');
  const [error, setError] = useState<string | null>(null);
  const finalRef = useRef(onFinal);
  finalRef.current = onFinal;
  const triedFallback = useRef(false);
  const lastOptions = useRef<{ offline: boolean }>({ offline: false });

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
          begin(FALLBACK_LANG, lastOptions.current.offline);
          return;
        }
        setError(ERROR_TEXT[e.error] ?? `No se pudo reconocer la voz (${e.error}).`);
      }),
    ];
    return () => subs.forEach((sub) => sub.remove());
  }, []);

  // Never leave the microphone open when the screen goes away.
  useEffect(() => () => Recognizer?.abort(), []);

  const start = useCallback(async () => {
    setError(null);
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
    const net = await NetInfo.fetch().catch(() => null);
    const offline = net?.isConnected === false || net?.isInternetReachable === false;
    triedFallback.current = false;
    begin(LANG, offline);
  }, []);

  function begin(lang: string, offline: boolean) {
    if (!Recognizer) return;
    lastOptions.current = { offline };
    Recognizer.start({
      lang,
      interimResults: true,
      continuous: false,
      maxAlternatives: 1,
      requiresOnDeviceRecognition: offline && Recognizer.supportsOnDeviceRecognition(),
      androidIntentOptions: { EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: END_SILENCE_MS },
    });
  }

  // Ends now; what was heard so far comes as the final result.
  const stop = useCallback(() => Recognizer?.stop(), []);
  const clearError = useCallback(() => setError(null), []);

  return { state, partial, error, start, stop, clearError };
}
