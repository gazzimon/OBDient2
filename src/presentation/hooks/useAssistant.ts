// Sending a message to the assistant (M3): the conversation updates on screen
// as the turn streams, and is saved when it ends. One turn at a time.

import { useCallback } from 'react';
import { container } from '@/data/container';
import type { AssistantError } from '@/data/assistant/assistant-service';
import { addUserMessage, applyEvent, failTurn, finishTurn } from '@/domain/assistant/conversation';
import { useChatStore } from '@/store/chatStore';
import { screenConfirmation } from '@/store/confirmStore';
import { assistantContext } from './assistantContext';

const ERROR_TEXT: Record<AssistantError, string> = {
  no_account: 'Entrá con tu cuenta de Google para usar el asistente (Ajustes → Cuenta).',
  unauthorized: 'Tu sesión venció. Entrá de nuevo con Google desde Ajustes → Cuenta.',
  disabled: 'Tu cuenta no tiene acceso al asistente en este momento (deshabilitada o sin cupo).',
  rate_limited: 'El asistente está con muchos pedidos. Probá en un minuto.',
  timeout: 'El asistente no respondió a tiempo.',
  offline: 'Sin conexión con el asistente. Revisá los datos móviles o el Wi‑Fi.',
  server: 'El asistente tuvo un problema. Probá de nuevo en un rato.',
};

let controller: AbortController | null = null;
let seq = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export function useAssistant() {
  const running = useChatStore((s) => s.runningId != null);

  const send = useCallback(async (text: string, images: readonly string[] = []) => {
    const store = useChatStore.getState();
    if (store.runningId || (!text.trim() && images.length === 0)) return;
    const startedAt = Date.now();
    let conv = store.active() ?? store.startNew(newId('c'), startedAt);
    conv = addUserMessage(conv, newId('u'), text.trim(), images.length, startedAt);
    store.save(conv);
    store.setRunning(conv.id);
    controller = new AbortController();
    const answerId = newId('a');
    const history = conv.api;
    try {
      const r = await container.assistant.send({
        conversationId: conv.id,
        history,
        clearsSoFar: conv.clears,
        text: text.trim(),
        images,
        context: assistantContext(),
        confirmation: screenConfirmation,
        signal: controller.signal,
        onEvent: (e) => {
          conv = applyEvent(conv, e, Date.now(), answerId);
          useChatStore.getState().save(conv);
        },
      });
      conv = r.ok
        ? finishTurn(conv, r.result, answerId, startedAt, Date.now())
        : failTurn(conv, newId('e'), ERROR_TEXT[r.error], r.error === 'no_account' ? null : text, Date.now());
    } catch {
      conv = failTurn(conv, newId('e'), ERROR_TEXT.server, text, Date.now());
    } finally {
      controller = null;
      useChatStore.getState().save(conv);
      useChatStore.getState().setRunning(null);
    }
  }, []);

  const stop = useCallback(() => controller?.abort(), []);

  return { send, stop, running };
}
