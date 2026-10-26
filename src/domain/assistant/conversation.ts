// A conversation as the app keeps it (M3): what the model needs sent back
// (`api`, the exact API messages) and what the screen shows (`items`).
//
// Pure functions: the store applies them, tests check them with plain data.
// Photos travel to the model in their own turn; in the saved history they are
// replaced by a marker, so twenty conversations do not grow to megabytes of
// base64 (the model already described them in its answer).

import type { ApiMessage } from '@/domain/ports/llm.port';
import type { AgentEvent, RoundStat, TurnResult } from './agent-loop';
import { MAX_NOTES, type OfflineNote } from './offline';
import type { MapPin, SourceLink, ToolName } from './tools';

export type ToolStatus = 'running' | 'ok' | 'failed' | 'refused';

export type ChatItem =
  | { readonly kind: 'user'; readonly id: string; readonly at: number; readonly text: string; readonly photos: number }
  | {
      readonly kind: 'assistant';
      readonly id: string;
      readonly at: number;
      readonly text: string;
      readonly cancelled: boolean;
      // Answered by the app without the model (M4).
      readonly offline?: boolean;
    }
  | {
      readonly kind: 'tool';
      readonly id: string;
      readonly at: number;
      readonly name: ToolName | string;
      readonly status: ToolStatus;
      // One line for the row: the tool's summary or the reason it did not run.
      readonly detail: string | null;
      // Places it found, for the map card under the row.
      readonly places?: readonly MapPin[];
      // Pages it read (research, web_fetch): buttons under the row.
      readonly sources?: readonly SourceLink[];
    }
  // `action`: what the screen offers besides retrying (the conversation no longer fits: go on in a new one).
  | { readonly kind: 'error'; readonly id: string; readonly at: number; readonly text: string; readonly retryText: string | null; readonly action?: 'continue_new' };

// Per-turn numbers, for the evaluation set (M3.4).
export interface TurnStat {
  readonly at: number;
  readonly ms: number;
  readonly modelCalls: number;
  readonly invalidCalls: number;
  readonly tools: readonly string[];
  // One entry per model call: why a turn ended the way it did (an empty answer,
  // a cut stream). Absent in older conversations.
  readonly rounds?: readonly RoundStat[];
}

export interface Conversation {
  readonly id: string;
  readonly title: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly api: readonly ApiMessage[];
  readonly items: readonly ChatItem[];
  // Successful clears so far: policy allows one per conversation.
  readonly clears: number;
  readonly stats: readonly TurnStat[];
  // What the turns no longer in `api` said (M4).
  readonly summary?: string | null;
  // Taken without the assistant, waiting for the driver's yes to pass them on.
  readonly notes?: readonly OfflineNote[];
  // Next questions the model proposed after the item `afterId` (the buttons).
  readonly next?: { readonly afterId: string; readonly questions: readonly string[] };
}

export const MAX_CONVERSATIONS = 20;
export const MAX_MESSAGES = 200;
const TITLE_CHARS = 40;
export const PHOTO_MARKER = '[foto adjunta, ya analizada]';

export function newConversation(id: string, now: number): Conversation {
  return { id, title: 'Conversación nueva', createdAt: now, updatedAt: now, api: [], items: [], clears: 0, stats: [] };
}

// The user's message goes on screen at once, before the model answers.
export function addUserMessage(c: Conversation, id: string, text: string, photos: number, now: number): Conversation {
  const first = c.items.every((i) => i.kind !== 'user');
  return {
    ...c,
    title: first ? titleFrom(text, photos) : c.title,
    updatedAt: now,
    items: [...c.items, { kind: 'user', id, at: now, text, photos }],
  };
}

// Streaming answer text and tool rows, as the turn goes.
export function applyEvent(c: Conversation, e: AgentEvent, now: number, answerId: string): Conversation {
  switch (e.type) {
    case 'text': {
      const last = c.items[c.items.length - 1];
      if (last?.kind === 'assistant' && isAnswerPart(last.id, answerId)) {
        return { ...c, items: [...c.items.slice(0, -1), { ...last, text: last.text + e.delta }] };
      }
      // Text again after a tool row: a new bubble, with its own id (list keys).
      const parts = c.items.filter((i) => isAnswerPart(i.id, answerId)).length;
      const id = parts === 0 ? answerId : `${answerId}.${parts}`;
      return { ...c, items: [...c.items, { kind: 'assistant', id, at: now, text: e.delta, cancelled: false }] };
    }
    case 'tool_start':
      return { ...c, items: [...c.items, { kind: 'tool', id: e.id, at: now, name: e.call.name, status: 'running', detail: null }] };
    case 'tool_end':
      return updateTool(
        c,
        e.id,
        e.outcome.ok ? 'ok' : 'failed',
        e.outcome.ok ? e.outcome.summary : e.outcome.message,
        e.outcome.ok && e.outcome.places?.length ? e.outcome.places : undefined,
        e.outcome.ok && e.outcome.sources?.length ? e.outcome.sources : undefined,
      );
    case 'tool_refused':
      return {
        ...c,
        items: [...c.items, { kind: 'tool', id: e.id, at: now, name: e.name, status: 'refused', detail: e.outcome.ok ? null : e.outcome.message }],
      };
  }
}

// The turn ended: its messages join the API history (photos replaced), the
// answer is final, the history keeps to its bounds.
export function finishTurn(c: Conversation, r: TurnResult, answerId: string, startedAt: number, now: number): Conversation {
  const items = c.items.map((i) => (i.kind === 'tool' && i.status === 'running' ? { ...i, status: 'failed' as const, detail: 'Cancelado.' } : i));
  const last = items[items.length - 1];
  let finalItems = items;
  if (last?.kind === 'assistant' && isAnswerPart(last.id, answerId)) {
    finalItems = [...items.slice(0, -1), { ...last, text: r.text || last.text, cancelled: r.cancelled }];
  } else if (r.text || r.cancelled) {
    finalItems = [...items, { kind: 'assistant', id: answerId, at: now, text: r.text, cancelled: r.cancelled }];
  }
  const tools = finalItems.filter((i) => i.kind === 'tool' && i.at >= startedAt).map((i) => (i as { name: string }).name);
  return {
    ...c,
    updatedAt: now,
    api: bound([...c.api, ...r.messages.map(withoutPhotos)]),
    items: finalItems.slice(-MAX_MESSAGES),
    clears: c.clears + r.clears,
    stats: [...c.stats, { at: startedAt, ms: now - startedAt, modelCalls: r.modelCalls, invalidCalls: r.invalidCalls, tools, ...(r.rounds?.length ? { rounds: r.rounds } : {}) }].slice(-MAX_MESSAGES),
  };
}

// The turn failed before an answer (network, server, no account). The text
// stays on screen with a way to send it again; nothing joins the API history.
export function failTurn(c: Conversation, id: string, text: string, retryText: string | null, now: number, action?: 'continue_new'): Conversation {
  const items = c.items.map((i) => (i.kind === 'tool' && i.status === 'running' ? { ...i, status: 'failed' as const, detail: null } : i));
  return { ...c, updatedAt: now, items: [...items, { kind: 'error', id, at: now, text, retryText, ...(action ? { action } : {}) }] };
}

// A new conversation that goes on from one that no longer fits: it starts with
// the old one's summary (the model reads it first) and says so on screen.
export function continuation(fresh: Conversation, summary: string | null, from: Conversation, itemId: string, now: number): Conversation {
  const text = summary
    ? `Sigo desde la conversación "${from.title}", que quedó guardada. Lo que tengo de ella: ${summary}`
    : `Sigo en una conversación nueva; "${from.title}" quedó guardada.`;
  return { ...fresh, title: from.title, summary, updatedAt: now, items: [{ kind: 'assistant', id: itemId, at: now, text, cancelled: false, offline: true }] };
}

// Answered by the app itself, without the assistant (M4). Not in the API
// history: the model hears about it through the notes, if the driver agrees.
export function addOfflineAnswer(c: Conversation, id: string, text: string, now: number): Conversation {
  const item: ChatItem = { kind: 'assistant', id, at: now, text, cancelled: false, offline: true };
  return { ...c, updatedAt: now, items: [...c.items, item].slice(-MAX_MESSAGES) };
}

export function addNote(c: Conversation, note: OfflineNote): Conversation {
  const notes = c.notes ?? [];
  // The same words sent again (the send failed and was tapped again) are one note.
  if (notes.at(-1)?.text === note.text) return c;
  return { ...c, notes: [...notes, note].slice(-MAX_NOTES) };
}

// A send that failed leaves the driver's message and an error (or the "I noted it"
// answer). Sending the same words again replaces them instead of piling up
// copies: the 2026-10-21 chat has the same note six times in a row.
export function dropFailedAttempt(c: Conversation, text: string): Conversation {
  const n = c.items.length;
  const reply = c.items[n - 1];
  const sent = c.items[n - 2];
  const failed = reply?.kind === 'error' || (reply?.kind === 'assistant' && reply.offline === true);
  if (failed && sent?.kind === 'user' && sent.photos === 0 && sent.text === text) return { ...c, items: c.items.slice(0, n - 2) };
  return c;
}

// The notes reached the assistant, or the driver discarded them.
export function clearNotes(c: Conversation, ids: readonly string[]): Conversation {
  return { ...c, notes: (c.notes ?? []).filter((n) => !ids.includes(n.id)) };
}

// The model summarised the turns a turn left out of its context: they leave
// the history and the summary stands in for them. Only if the history still
// starts with those same messages (another turn may have changed it meanwhile).
export function applySummary(c: Conversation, dropped: readonly ApiMessage[], summary: string): Conversation {
  if (dropped.length === 0 || dropped.length > c.api.length) return c;
  if (!dropped.every((m, i) => c.api[i] === m)) return c;
  return { ...c, api: c.api.slice(dropped.length), summary };
}

// The model's next questions, kept only if nothing was said since.
export function setNextQuestions(c: Conversation, afterId: string, questions: readonly string[]): Conversation {
  if (c.items[c.items.length - 1]?.id !== afterId || questions.length === 0) return c;
  return { ...c, next: { afterId, questions } };
}

// Newest first, at most MAX_CONVERSATIONS; empty ones are not kept.
export function upsertConversation(list: readonly Conversation[], c: Conversation): Conversation[] {
  const rest = list.filter((x) => x.id !== c.id);
  return [c, ...rest].filter((x, i) => i === 0 || x.items.length > 0).slice(0, MAX_CONVERSATIONS);
}

// The answer's bubbles: answerId, then answerId.1, answerId.2… after tool rows.
const isAnswerPart = (id: string, answerId: string) => id === answerId || id.startsWith(`${answerId}.`);

function updateTool(c: Conversation, id: string, status: ToolStatus, detail: string | null, places?: readonly MapPin[], sources?: readonly SourceLink[]): Conversation {
  return {
    ...c,
    items: c.items.map((i) => (i.kind === 'tool' && i.id === id ? { ...i, status, detail, ...(places ? { places } : {}), ...(sources ? { sources } : {}) } : i)),
  };
}

function withoutPhotos(m: ApiMessage): ApiMessage {
  if (m.role !== 'user' || typeof m.content === 'string') return m;
  const text = m.content.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('\n');
  const photos = m.content.length - m.content.filter((p) => p.type === 'text').length;
  return photos ? { role: 'user', content: `${text}\n${PHOTO_MARKER}` } : m;
}

// Drops the oldest whole turns beyond MAX_MESSAGES (a turn starts at a user
// message, so tool calls never lose their results).
function bound(api: ApiMessage[]): ApiMessage[] {
  if (api.length <= MAX_MESSAGES) return api;
  let start = api.length - MAX_MESSAGES;
  while (start < api.length && api[start]!.role !== 'user') start++;
  return api.slice(start);
}

function titleFrom(text: string, photos: number): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t) return photos ? 'Foto' : 'Conversación nueva';
  return t.length > TITLE_CHARS ? `${t.slice(0, TITLE_CHARS - 1)}…` : t;
}
