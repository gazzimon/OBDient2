// The app's single voice (M5): expo-speech behind the VoiceArbiter. Guidance,
// detector alerts and the assistant all speak through `voice`.

import { useSyncExternalStore } from 'react';
import * as Speech from 'expo-speech';
import { VoiceArbiter, type Speaker } from '@/domain/voice/voice-arbiter';
import { useSettingsStore } from '@/store/settingsStore';

const speaker: Speaker = {
  speak: (text, { rate }, done) => Speech.speak(text, { language: 'es-ES', rate, onDone: done }),
  stop: () => void Speech.stop(),
};

export const voice = new VoiceArbiter(speaker, {
  voiceOn: () => useSettingsStore.getState().voiceEnabled,
  alertLevel: () => useSettingsStore.getState().alertVoice,
});

// Re-renders when muted changes (the drive view's button).
export function useVoiceMuted(): boolean {
  return useSyncExternalStore(
    (cb) => voice.onMuted(cb),
    () => voice.isMuted(),
  );
}
