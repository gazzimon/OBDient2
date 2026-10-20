// Talking with the assistant on the driving screen (Modo manejo), as a
// conversation, not a walkie-talkie:
//
//   tap 🎤 → listening → thinking (what tool it is using) → speaking, with
//   film-style subtitles → listening again for a follow-up (~6 s; nothing
//   said ends the conversation)
//
// - The question goes as a spoken turn: the model is asked for ≤ 60 words for
//   the ear, and the phone cuts there anyway (domain/voice/subtitles).
// - The answer speaks through the voice arbiter at the lowest priority: a
//   maneuver or an alert cuts it, and then it does not listen again.
// - It does not listen again with a maneuver close ahead either, so the mic
//   does not pick up the guidance voice.
// - Tapping while it talks cuts it and listens (barge-in by touch); tapping
//   while it thinks stops the turn.
// - With the sound off (or only alerts) the answer is only subtitles, paced as
//   if spoken.
// Tools work as in the chat: it is the same agent turn.

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { capWords, subtitleChunks, WORDS_PER_SECOND } from '@/domain/voice/subtitles';
import { forSpeech } from '@/domain/voice/voice-arbiter';
import { toolLabel } from '@/presentation/components/assistant/ToolRow';
import { useAssistant } from '@/presentation/hooks/useAssistant';
import { useVoiceInput } from '@/presentation/hooks/useVoiceInput';
import { ensurePermission } from '@/presentation/services/permissions';
import { voice } from '@/presentation/services/voice';
import { useChatStore } from '@/store/chatStore';
import { useNavStore } from '@/store/navStore';

export type DrivePhase = 'idle' | 'listening' | 'thinking' | 'speaking';

// No listening again this close to the next maneuver.
const MANEUVER_GUARD_M = 300;

export interface Subtitles {
  readonly chunks: readonly string[];
  // When the voice started (Date.now), null until it does.
  readonly startedAt: number | null;
}

// The answer to the last question: the assistant's text after the last user message.
function lastAnswer(): string {
  const items = useChatStore.getState().active()?.items ?? [];
  let lastUser = -1;
  items.forEach((it, i) => {
    if (it.kind === 'user') lastUser = i;
  });
  return items
    .slice(lastUser + 1)
    .flatMap((it) => (it.kind === 'assistant' && !it.cancelled ? [it.text] : []))
    .join(' ')
    .trim();
}

function maneuverSoon(): boolean {
  const d = useNavStore.getState().progress?.distanceToManeuverM;
  return d != null && d < MANEUVER_GUARD_M;
}

const wordCount = (chunks: readonly string[]) => chunks.join(' ').split(/\s+/).filter(Boolean).length;

export function useDriveAssistant() {
  const { sendSpoken, stop, running } = useAssistant();
  const [phase, setPhaseState] = useState<DrivePhase>('idle');
  const [subtitles, setSubtitles] = useState<Subtitles | null>(null);
  const phaseRef = useRef<DrivePhase>('idle');
  // A conversation is open: after each answer it listens again.
  const open = useRef(false);
  const silentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setPhase = (p: DrivePhase) => {
    phaseRef.current = p;
    setPhaseState(p);
  };

  // The final phrase goes to `answer` (declared below; read through a ref).
  const onPhrase = useRef<(text: string) => void>(() => {});
  const mic = useVoiceInput((text) => onPhrase.current(text));

  const listen = () => {
    setPhase('listening');
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void ensurePermission('microphone').then((ok) => (ok ? mic.start() : end()));
  };

  const end = () => {
    open.current = false;
    if (silentTimer.current) clearTimeout(silentTimer.current);
    setSubtitles(null);
    setPhase('idle');
  };

  // After the answer: listen again, unless something says not to.
  const afterAnswer = (finished: boolean) => {
    setSubtitles(null);
    if (finished && open.current && !maneuverSoon()) listen();
    else end();
  };

  async function answer(text: string) {
    setPhase('thinking');
    await sendSpoken(text);
    const said = capWords(forSpeech(lastAnswer()));
    if (!said || !open.current) return end();
    const chunks = subtitleChunks(said);
    setSubtitles({ chunks, startedAt: null });
    let started = false;
    voice.say(said, 'assistant', {
      onStart: () => {
        started = true;
        setPhase('speaking');
        setSubtitles({ chunks, startedAt: Date.now() });
      },
      onEnd: (spoken) => {
        if (started) return afterAnswer(spoken);
        // Not allowed to speak (sound off or only alerts): subtitles alone.
        setPhase('speaking');
        setSubtitles({ chunks, startedAt: Date.now() });
        silentTimer.current = setTimeout(() => afterAnswer(true), (wordCount(chunks) / WORDS_PER_SECOND) * 1000 + 800);
      },
    });
  }

  useEffect(() => {
    onPhrase.current = (text) => void answer(text);
  });

  // The microphone closed without a phrase (nothing said): the conversation ends.
  const micIdle = mic.state === 'idle';
  const micIdleRef = useRef(micIdle);
  useEffect(() => {
    micIdleRef.current = micIdle;
  }, [micIdle]);
  useEffect(() => {
    if (micIdle && phaseRef.current === 'listening') end();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micIdle]);

  useEffect(
    () => () => {
      if (silentTimer.current) clearTimeout(silentTimer.current);
      voice.cancel('assistant');
    },
    [],
  );

  const talk = useCallback(() => {
    switch (phaseRef.current) {
      case 'idle':
        open.current = true;
        return listen();
      case 'listening':
        // The microphone never opened (no permission, error): close.
        if (micIdleRef.current) return end();
        // Ends the phrase now; what was heard is the question.
        return mic.stop();
      case 'thinking':
        stop();
        return end();
      case 'speaking':
        if (silentTimer.current) clearTimeout(silentTimer.current);
        open.current = true;
        voice.cancel('assistant');
        return listen();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mic, stop]);

  // While thinking: what it is doing ("Leyendo códigos de falla").
  const busyWith = useChatStore((s) => {
    const items = s.active()?.items ?? [];
    const last = items[items.length - 1];
    return last?.kind === 'tool' && last.status === 'running' ? toolLabel(last.name) : null;
  });

  return {
    talk,
    phase,
    running,
    heard: mic.partial,
    busyWith,
    subtitles,
    error: mic.error,
  };
}
