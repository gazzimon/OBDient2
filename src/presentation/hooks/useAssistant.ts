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
  continuation,
  dropFailedAttempt,
  failTurn,
  setNextQuestions,
  finishTurn,
  type Conversation,
} from '@/domain/assistant/conversation';
import { noteReply, notesBrief } from '@/domain/assistant/offline';
import { asksForNotes } from '@/domain/assistant/phrase-router';
import { captureDigest } from '@/domain/obd/capture-digest';
import { turnsToSummarize } from '@/domain/assistant/history';
import { navigationTools } from '@/presentation/services/navigation-tools';
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
  too_long: 'La conversación se hizo demasiado larga para el asistente. Puedo seguir en una conversación nueva con un resumen de esta (queda guardada).',
  server: 'El asistente tuvo un problema. Probá de nuevo en un rato.',
};

// Messages of the old conversation summarised when going on in a new one (each is clipped to 600 characters).
const CONTINUE_MESSAGES = 40;
const LOCALITY_WAIT_MS = 1_500;

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

// The buttons under the answer: the model proposes them in the background.
function proposeNext(conv: Conversation, asked: string): void {
  const afterId = conv.items[conv.items.length - 1]?.id;
  if (!afterId) return;
  void container.assistant
    .nextQuestions(conv.api, asked, conv.summary ?? null)
    .then((questions) => {
      const store = useChatStore.getState();
      const c = store.conversations.find((x) => x.id === conv.id);
      if (c) store.save(setNextQuestions(c, afterId, questions));
    })
    .catch(() => undefined);
}

async function offlineTurn(conv: Conversation, text: string, photos: number, at: number): Promise<Conversation> {
  const reply = await container.offlineAssistant.handle({ id: newId('n'), at, text, photos }, assistantContext());
  if (reply.kind === 'answer') return addOfflineAnswer(conv, newId('a'), reply.text, Date.now());
  const earlier = conv.notes ?? [];
  return addOfflineAnswer(addNote(conv, reply.note), newId('a'), noteReply(reply.note, earlier), Date.now());
}

const hhmm = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

interface Message {
  // What the screen shows.
  readonly text: string;
  readonly images: readonly string[];
  // What the model gets, when the app added something (a map link it read,
  // the notes): otherwise the same text.
  readonly forModel?: string;
  // Notes this message carries: cleared when the assistant answers.
  readonly noteIds?: readonly string[];
}

async function run({ text, images, forModel, noteIds = undefined }: Message): Promise<void> {
  const first = useChatStore.getState();
  if (first.runningId || (!text.trim() && images.length === 0)) return;
  const pending = first.activeId ? summaries.get(first.activeId) : undefined;
  if (pending) await pending;
  const store = useChatStore.getState();
  if (store.runningId) return;
  const startedAt = Date.now();
  let conv = store.active() ?? store.startNew(newId('c'), startedAt);
  conv = addUserMessage(dropFailedAttempt(conv, text.trim()), newId('u'), text.trim(), images.length, startedAt);
  store.save(conv);
  store.setRunning(conv.id);
  controller = new AbortController();
  const answerId = newId('a');
  // Notes are only ever sent to the assistant: never turned into a note again.
  const canGoOffline = noteIds == null;
  // A pasted diagnostic capture reaches the model decoded by the app (one line per
  // request), not as hex for it to read by hand; the screen keeps what was pasted.
  let modelText = captureDigest((forModel ?? text).trim()) ?? (forModel ?? text).trim();
  try {
    if (canGoOffline && (await knownOffline())) {
      conv = await offlineTurn(conv, text, images.length, startedAt);
      return;
    }
    // The town for the state block (cached; a short wait at most the first time).
    await Promise.race([navigationTools.locality(), new Promise((r) => setTimeout(r, LOCALITY_WAIT_MS))]);
    // A map link is read here, not by the model (it cannot open links).
    const link = await navigationTools.loadLink(modelText, controller.signal);
    if (link) {
      const rowId = newId('t');
      const call = { name: 'search_place' as const, query: 'enlace de mapa' };
      conv = applyEvent(conv, { type: 'tool_start', id: rowId, call }, Date.now(), answerId);
      conv = applyEvent(
        conv,
        {
          type: 'tool_end',
          id: rowId,
          call,
          outcome: link.ok
            ? { ok: true, data: null, summary: `Enlace: ${link.name}${link.approximate ? ' (aproximado)' : ''}` }
            : { ok: false, error: 'not_supported', message: `No pude leer el enlace: ${link.reason}` },
        },
        Date.now(),
        answerId,
      );
      useChatStore.getState().save(conv);
      modelText = `${modelText}\n\n${linkNote(link)}`;
    }
    let shown = false;
    const r = await container.assistant.send({
      conversationId: conv.id,
      history: conv.api,
      summary: conv.summary ?? null,
      clearsSoFar: conv.clears,
      text: modelText,
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
      // What fell out of the window this turn, or — past SUMMARY_FROM — the oldest turns, before it does.
      summarizeLater(conv.id, conv.summary ?? null, r.result.dropped.length ? r.result.dropped : turnsToSummarize(conv.api));
      // Next questions only follow a real answer: after the fallback (the tools'
      // lines, no answer) they would propose to go on with a topic never answered.
      if (r.result.answered !== false) proposeNext(conv, text);
    } else if (canGoOffline && UNREACHABLE.has(r.error) && !shown) {
      conv = await offlineTurn(conv, text, images.length, startedAt);
    } else {
      const retry = r.error === 'no_account' || !canGoOffline ? null : text;
      conv = failTurn(conv, newId('e'), ERROR_TEXT[r.error], retry, Date.now(), r.error === 'too_long' ? 'continue_new' : undefined);
    }
  } catch {
    conv = failTurn(conv, newId('e'), ERROR_TEXT.server, canGoOffline ? text : null, Date.now());
  } finally {
    controller = null;
    useChatStore.getState().save(conv);
    useChatStore.getState().setRunning(null);
  }
}

// What the model is told about a link the app read.
function linkNote(link: NonNullable<Awaited<ReturnType<typeof navigationTools.loadLink>>>): string {
  if (!link.ok) return `[enlace de mapa: la app no lo pudo leer (${link.reason})]`;
  const where = [link.name, link.detail].filter(Boolean).join(', ');
  const km = link.distanceKm != null ? `, a ${String(link.distanceKm).replace('.', ',')} km` : '';
  const approx = link.approximate ? ' Ubicación aproximada: el enlace no trae el punto exacto y se buscó su dirección.' : '';
  return `[enlace de mapa leído por la app: ${where}${km}. Ya es el resultado 1 de search_place.${approx}]`;
}

// The answer is heard, not read, by someone driving (decision 2026-10-20).
const SPOKEN_HINT =
  '[Por voz, mientras maneja: respondé para escuchar, en menos de 60 palabras, sin listas, viñetas ni markdown. Si hay opciones, como mucho tres y cortas.]';

export function useAssistant() {
  const running = useChatStore((s) => s.runningId != null);

  const send = useCallback(async (text: string, images: readonly string[] = []) => {
    // "Leé las notas": the same as the button, with the driver's own words on screen.
    const notes = useChatStore.getState().active()?.notes ?? [];
    if (notes.length && images.length === 0 && asksForNotes(text) && !(await knownOffline())) {
      return run({ text, images, forModel: notesBrief(notes, hhmm), noteIds: notes.map((n) => n.id) });
    }
    return run({ text, images });
  }, []);

  // The notes taken without the assistant, as one message, with the driver's yes.
  const sendNotes = useCallback(async () => {
    const notes = useChatStore.getState().active()?.notes ?? [];
    if (notes.length === 0) return;
    const brief = notesBrief(notes, hhmm);
    await run({ text: brief, images: [], noteIds: notes.map((n) => n.id) });
  }, []);

  const discardNotes = useCallback(() => {
    const store = useChatStore.getState();
    const c = store.active();
    if (c?.notes?.length) store.save(clearNotes(c, c.notes.map((n) => n.id)));
  }, []);

  // Spoken while driving (the drive screen's microphone): the same turn, with
  // a note for the model to answer for the ear. The chat shows the words said.
  const sendSpoken = useCallback(
    (text: string, images: readonly string[] = []) => run({ text, images, forModel: `${text}\n\n${SPOKEN_HINT}` }),
    [],
  );

  // The conversation no longer fits: a new one that starts with its summary, and
  // the question that failed asked again there.
  const continueInNew = useCallback(async (retry: string | null) => {
    const store = useChatStore.getState();
    const old = store.active();
    if (!old || store.runningId) return;
    store.setRunning(old.id);
    let summary: string | null = null;
    try {
      // The latest part only: the whole is what did not fit.
      summary = (await container.assistant.summarize(old.summary ?? null, old.api.slice(-CONTINUE_MESSAGES))) ?? old.summary ?? null;
    } finally {
      store.setRunning(null);
    }
    const now = Date.now();
    store.save(continuation(store.startNew(newId('c'), now), summary, old, newId('a'), now));
    if (retry) await run({ text: retry, images: [] });
  }, []);

  const stop = useCallback(() => controller?.abort(), []);

  return { send, sendSpoken, sendNotes, discardNotes, continueInNew, stop, running };
}
