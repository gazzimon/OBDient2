// The microphone on the driving screen (Modo manejo, F1): the driver speaks,
// the text goes to the assistant like any chat message, and the answer is
// said aloud through the voice arbiter (lowest priority: guidance and alerts
// go first) and shown briefly in a card.

import { useCallback, useEffect, useState } from 'react';
import { forSpeech } from '@/domain/voice/voice-arbiter';
import { useAssistant } from '@/presentation/hooks/useAssistant';
import { useVoiceInput } from '@/presentation/hooks/useVoiceInput';
import { ensurePermission } from '@/presentation/services/permissions';
import { voice } from '@/presentation/services/voice';
import { useChatStore } from '@/store/chatStore';

const REPLY_SHOWN_MS = 12_000;

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

export function useDriveAssistant() {
  const { send, stop, running } = useAssistant();
  const [reply, setReply] = useState<{ text: string; at: number } | null>(null);

  const ask = useCallback(
    async (text: string) => {
      setReply(null);
      await send(text);
      const answer = lastAnswer();
      if (!answer) return;
      voice.say(forSpeech(answer), 'assistant');
      setReply({ text: answer, at: Date.now() });
    },
    [send],
  );
  const mic = useVoiceInput((text) => void ask(text));

  // The card goes away by itself.
  useEffect(() => {
    if (!reply) return;
    const id = setTimeout(() => setReply(null), REPLY_SHOWN_MS);
    return () => clearTimeout(id);
  }, [reply]);

  const listening = mic.state !== 'idle';
  const talk = useCallback(() => {
    if (running) return stop();
    if (listening) return mic.stop();
    void ensurePermission('microphone').then((ok) => (ok ? mic.start() : undefined));
  }, [running, listening, mic, stop]);

  return {
    talk,
    listening,
    running,
    partial: mic.partial,
    error: mic.error,
    reply: reply?.text ?? null,
    dismiss: () => setReply(null),
  };
}
