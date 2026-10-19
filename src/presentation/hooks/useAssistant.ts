// Sending a message to the assistant (M3): the conversation updates on screen
// as the turn streams, and is saved when it ends. One turn at a time.
//
// Every message goes through send(), written or (M6) spoken. Without the
// assistant (M4) — no connection, or the server does not answer before
// anything reached the screen — the app answers known phrases itself and
// keeps the rest as notes; sendNotes() passes them on with the driver's yes.
// When a turn leaves old messages out of the context, they are summarised in
// the background and the summary takes their place.

import { useCallback } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { container } from '@/data/container';
import type { AssistantError } from '@/data/assistant/assistant-service';
import type { ApiMessage } from '@/domain/ports/llm.port';
import {
  addNote,
  addOfflineAnswer,
  addUserMessage,
  applyEvent,
  applySummary,
  clearNotes,
  failTurn,
  finishTurn,
  type Conversation,
} from '@/domain/assistant/conversation';
import { noteReply, notesBrief } from '@/domain/assistant/offline';
import { useChatStore } from '@/store/chatStore';
import { screenConfirmation } from '@/store/confirmStore';
import { assistantContext } from './assistantContext';

const ERROR_TEXT: Record<AssistantError, string> = {
  no_account: 'Entrá con tu correo para usar el asistente (Ajustes → Cuenta).',
  unauthorized: 'Tu sesión venció. Entrá de nuevo con tu correo desde Ajustes → Cuenta.',
  disabled: 'Tu cuenta no tiene acceso al asistente en este momento (deshabilitada o sin cupo).',
  rate_limited: 'El asistente está con muchos pedidos. Probá en un minuto.',
  timeout: 'El asistente no respondió a tiempo.',
  offline: 'Sin conexión con el asistente. Revisá los datos móviles o el Wi‑Fi.',
  server: 'El asistente tuvo un problema. Probá de nuevo en un rato.',
};

// The assistant cannot be reached: the app answers by itself.
const UNREACHABLE: ReadonlySet<AssistantError> = new Set(['offline', 'timeout', 'server']);

let controller: AbortController | null = null;
let seq = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

// Summaries in flight, per conversation: the next turn waits for its own.
const summaries = new Map<string, Promise<void>>();

async function knownOffline(): Promise<boolean> {
  try {
    const s = await NetInfo.fetch();
    return s.isConnected === false || s.isInternetReachable === false;
  } catch {
    return false;
  }
}

function summarizeLater(id: string, previous: string | null, dropped: readonly ApiMessage[]): void {
  if (dropped.length === 0 || summaries.has(id)) return;
  const job = container.assistant
    .summarize(previous, dropped)
    .then((text) => {
      if (!text) return;
      const store = useChatStore.getState();
      const c = store.conversations.find((x) => x.id === id);
      if (c) store.save(applySummary(c, dropped, text));
    })
    .catch(() => undefined)
    .finally(() => summaries.delete(id));
  summaries.set(id, job);
}

async function offlineTurn(conv: Conversation, text: string, photos: number, at: number): Promise<Conversation> {
  const reply = await container.offlineAssistant.handle({ id: newId('n'), at, text, photos }, assistantContext());
  if (reply.kind === 'answer') return addOfflineAnswer(conv, newId('a'), reply.text, Date.now());
  const earlier = conv.notes ?? [];
  return addOfflineAnswer(addNote(conv, reply.note), newId('a'), noteReply(reply.note, earlier), Date.now());
}

const hhmm = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

async function run(text: string, images: readonly string[], noteIds: readonly string[] | null): Promise<void> {
  const first = useChatStore.getState();
  if (first.runningId || (!text.trim() && images.length === 0)) return;
  const pending = first.activeId ? summaries.get(first.activeId) : undefined;
  if (pending) await pending;
  const store = useChatStore.getState();
  if (store.runningId) return;
  const startedAt = Date.now();
  let conv = store.active() ?? store.startNew(newId('c'), startedAt);
  conv = addUserMessage(conv, newId('u'), text.trim(), images.length, startedAt);
  store.save(conv);
  store.setRunning(conv.id);
  controller = new AbortController();
  const answerId = newId('a');
  // Notes are only ever sent to the assistant: never turned into a note again.
  const canGoOffline = noteIds == null;
  try {
    if (canGoOffline && (await knownOffline())) {
      conv = await offlineTurn(conv, text, images.length, startedAt);
      return;
    }
    let shown = false;
    const r = await container.assistant.send({
      conversationId: conv.id,
      history: conv.api,
      summary: conv.summary ?? null,
      clearsSoFar: conv.clears,
      text: text.trim(),
      images,
      context: assistantContext(),
      confirmation: screenConfirmation,
      signal: controller.signal,
      onEvent: (e) => {
        shown = true;
        conv = applyEvent(conv, e, Date.now(), answerId);
        useChatStore.getState().save(conv);
      },
    });
    if (r.ok) {
      conv = finishTurn(conv, r.result, answerId, startedAt, Date.now());
      if (noteIds) conv = clearNotes(conv, noteIds);
      summarizeLater(conv.id, conv.summary ?? null, r.result.dropped);
    } else if (canGoOffline && UNREACHABLE.has(r.error) && !shown) {
      conv = await offlineTurn(conv, text, images.length, startedAt);
    } else {
      const retry = r.error === 'no_account' || !canGoOffline ? null : text;
      conv = failTurn(conv, newId('e'), ERROR_TEXT[r.error], retry, Date.now());
    }
  } catch {
    conv = failTurn(conv, newId('e'), ERROR_TEXT.server, canGoOffline ? text : null, Date.now());
  } finally {
    controller = null;
    useChatStore.getState().save(conv);
    useChatStore.getState().setRunning(null);
  }
}

export function useAssistant() {
  const running = useChatStore((s) => s.runningId != null);

  const send = useCallback((text: string, images: readonly string[] = []) => run(text, images, null), []);

  // The notes taken without the assistant, as one message, with the driver's yes.
  const sendNotes = useCallback(async () => {
    const notes = useChatStore.getState().active()?.notes ?? [];
    if (notes.length === 0) return;
    await run(notesBrief(notes, hhmm), [], notes.map((n) => n.id));
  }, []);

  const discardNotes = useCallback(() => {
    const store = useChatStore.getState();
    const c = store.active();
    if (c?.notes?.length) store.save(clearNotes(c, c.notes.map((n) => n.id)));
  }, []);

  const stop = useCallback(() => controller?.abort(), []);

  return { send, sendNotes, discardNotes, stop, running };
}
