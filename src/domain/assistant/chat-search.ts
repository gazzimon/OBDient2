// Looking back in what was said before (decision 2026-10-22): "la cafetería de
// la que hablamos ayer", "ese lugar que me mostraste". Searches the saved
// conversations — never the one in progress — for the words of the question:
// what the user and the assistant wrote, each conversation's summary, and the
// places that showed on its maps. Pure: the store hands the conversations in.
//
// What goes back to the model is short, flat text with no coordinates: to go to
// a place it searches it again by name (search_place), like a place from the web.

import type { Conversation } from './conversation';

export type ChatHitWho = 'usuario' | 'asistente' | 'mapa' | 'resumen';

export interface ChatHit {
  // "2026-10-21 (ayer)".
  readonly when: string;
  readonly who: ChatHitWho;
  readonly text: string;
  // A place that was on a map in that conversation.
  readonly place?: { readonly name: string; readonly detail: string };
}

export const MAX_HITS = 4;
const MAX_TOTAL_CHARS = 900;
const SNIPPET_CHARS = 200;
const MIN_TOKEN = 3;

// Words that match everything (and the time words of "ayer" or "la otra vez",
// which are in the question but not in the text that is looked for).
const STOP = new Set(
  ('el la los las un una unos unas de del al a en y o u que se me te mi tu su por para con sin sobre es era fue son ' +
    'lo le les nos ya no si como cual cuales donde cuando ayer anteayer antes hoy anoche semana pasada pasado mes otra ' +
    'vez hablamos hablamos charlamos dijiste dijimos mostraste mostro lugar sitio').split(' '),
);

// Lower case, no accents: "Cafetería" matches "cafeteria".
export const normalise = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

export function queryWords(query: string): string[] {
  const words = normalise(query).match(/[a-z0-9]+/g) ?? [];
  return [...new Set(words.filter((w) => w.length >= MIN_TOKEN && !STOP.has(w)))].slice(0, 8);
}

// No markers or backticks that could pass for an instruction, no control characters.
const clean = (s: string): string =>
  s
    .replace(/[\u0000-\u001f\u007f<>`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// A window of text around the first word that matched.
function snippet(text: string, words: readonly string[]): string {
  const flat = clean(text);
  if (flat.length <= SNIPPET_CHARS) return flat;
  const lower = normalise(flat);
  const at = Math.min(...words.map((w) => lower.indexOf(w)).filter((i) => i >= 0));
  const start = Math.max(0, (Number.isFinite(at) ? at : 0) - 60);
  const piece = flat.slice(start, start + SNIPPET_CHARS);
  return `${start > 0 ? '…' : ''}${piece}${start + SNIPPET_CHARS < flat.length ? '…' : ''}`;
}

const AR_OFFSET_MS = 3 * 3_600_000;
const dayOf = (ms: number): string => new Date(ms - AR_OFFSET_MS).toISOString().slice(0, 10);

export function whenLabel(at: number, now: number): string {
  const days = Math.round((Date.parse(dayOf(now)) - Date.parse(dayOf(at))) / 86_400_000);
  const rel = days <= 0 ? 'hoy' : days === 1 ? 'ayer' : `hace ${days} días`;
  return `${dayOf(at)} (${rel})`;
}

interface Candidate {
  readonly at: number;
  readonly who: ChatHitWho;
  readonly text: string;
  readonly place?: { readonly name: string; readonly detail: string };
}

function candidates(c: Conversation): Candidate[] {
  const out: Candidate[] = [];
  if (c.summary) out.push({ at: c.updatedAt, who: 'resumen', text: c.summary });
  for (const item of c.items) {
    if (item.kind === 'user') out.push({ at: item.at, who: 'usuario', text: item.text });
    else if (item.kind === 'assistant' && item.text) out.push({ at: item.at, who: 'asistente', text: item.text });
    else if (item.kind === 'tool') {
      for (const p of item.places ?? []) out.push({ at: item.at, who: 'mapa', text: [p.name, p.detail].filter(Boolean).join(', '), place: { name: p.name, detail: p.detail } });
    }
  }
  return out;
}

export function searchChats(
  conversations: readonly Conversation[],
  query: string,
  opts: { readonly excludeId?: string | null; readonly now?: number } = {},
): ChatHit[] {
  const words = queryWords(query);
  if (words.length === 0) return [];
  const now = opts.now ?? Date.now();
  const need = Math.max(1, Math.ceil(words.length / 2));

  const scored: { c: Candidate; score: number }[] = [];
  for (const conv of conversations) {
    if (conv.id === opts.excludeId) continue;
    for (const cand of candidates(conv)) {
      const text = normalise(cand.text);
      const matched = words.filter((w) => text.includes(w)).length;
      if (matched >= need) scored.push({ c: cand, score: matched });
    }
  }
  scored.sort((a, b) => b.score - a.score || b.c.at - a.c.at);

  // The same text said twice (a place shown again, a repeated answer) counts once.
  const seen = new Set<string>();
  const hits: ChatHit[] = [];
  let chars = 0;
  for (const { c } of scored) {
    const text = snippet(c.text, words);
    const key = normalise(text);
    if (seen.has(key)) continue;
    if (hits.length >= MAX_HITS || (hits.length > 0 && chars + text.length > MAX_TOTAL_CHARS)) break;
    seen.add(key);
    chars += text.length;
    hits.push({
      when: whenLabel(c.at, now),
      who: c.who,
      text,
      ...(c.place ? { place: { name: clean(c.place.name), detail: clean(c.place.detail) } } : {}),
    });
  }
  return hits;
}

// How far back the saved conversations go: the assistant says it when it finds nothing.
export function oldestDay(conversations: readonly Conversation[], excludeId?: string | null): string | null {
  const times = conversations.filter((c) => c.id !== excludeId).map((c) => c.createdAt);
  return times.length ? dayOf(Math.min(...times)) : null;
}
