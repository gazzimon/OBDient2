// Speaking to the assistant (M6): the phone's own speech recognizer (Android)
// turns the voice into text, which goes through the same send() as typing
// (ADR-0007 §3: the model always gets text).
//
// Push to talk: a tap starts, silence ends it (or a second tap). The words
// show in the input box as they are heard; the final text is handed to
// onFinal. With no connection it asks for on-device recognition, which needs
// the Spanish offline pack installed on the phone.

import { useCallback, useEffect, useRef, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

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

  useSpeechRecognitionEvent('start', () => {
    setState('listening');
    setError(null);
  });
  useSpeechRecognitionEvent('end', () => {
    setState('idle');
    setPartial('');
  });
  useSpeechRecognitionEvent('result', (e) => {
    const text = e.results[0]?.transcript?.trim() ?? '';
    if (!e.isFinal) {
      setPartial(text);
      return;
    }
    setPartial('');
    if (text) finalRef.current(text);
  });
  useSpeechRecognitionEvent('error', (e) => {
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
  });

  // Never leave the microphone open when the screen goes away.
  useEffect(() => () => ExpoSpeechRecognitionModule.abort(), []);

  const start = useCallback(async () => {
    setError(null);
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      setError(ERROR_TEXT['not-allowed']!);
      return;
    }
    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      setError(ERROR_TEXT['service-not-allowed']!);
      return;
    }
    const net = await NetInfo.fetch().catch(() => null);
    const offline = net?.isConnected === false || net?.isInternetReachable === false;
    triedFallback.current = false;
    begin(LANG, offline);
  }, []);

  function begin(lang: string, offline: boolean) {
    lastOptions.current = { offline };
    ExpoSpeechRecognitionModule.start({
      lang,
      interimResults: true,
      continuous: false,
      maxAlternatives: 1,
      requiresOnDeviceRecognition: offline && ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(),
      androidIntentOptions: { EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: END_SILENCE_MS },
    });
  }

  // Ends now; what was heard so far comes as the final result.
  const stop = useCallback(() => ExpoSpeechRecognitionModule.stop(), []);
  const clearError = useCallback(() => setError(null), []);

  return { state, partial, error, start, stop, clearError };
}
