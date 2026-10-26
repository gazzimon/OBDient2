// Keeps a conversation inside the model's context (16k tokens with the system
// prompt and tools): the oldest whole turns go first.
//
// A turn starts at a user message, so an assistant tool call and its tool
// results always stay together: the API rejects one without the other. The
// dropped part is returned so the caller can summarise it (ADR-0007).

import type { ApiMessage } from '@/domain/ports/llm.port';

// Rough, conservative for Spanish and JSON with this tokenizer: ~3.2 characters
// a token (a 2026-10-21 conversation measured ~3.3), plus a few for the envelope.
const CHARS_PER_TOKEN = 3.2;
const PER_MESSAGE = 4;
// An attached image (≤ 1024 px, see presentation/services/photo.ts): Qwen3.8
// counts ~1.3k vision tokens at that size; a 164 kB photo with a short question
// measured 2.5k prompt tokens (2026-10-18).
const IMAGE_TOKENS = 1500;
// Qwen's tokenizer splits digits one by one, so a CAN/OBD dump ("4A 00 18DAF111
// 41 01 00 07 E1 21") costs about a token per character, twice what prose does.
// The 2026-10-21 chat pasted two ~4 kB captures: at 3.2 they were counted as
// ~1.2k tokens each, and the window ran out with the estimate saying it fit.
const HEX_CHARS_PER_TOKEN = 1.4;
const HEX_RUN = /(?:[0-9A-Fa-f]{2}[ :]?){6,}/g;

// Tokens of a text: prose at ~3.2 characters a token, runs of hex bytes at ~1.4.
export function textTokens(text: string): number {
  let hex = 0;
  const rest = text.replace(HEX_RUN, (run) => {
    hex += run.length;
    return '';
  });
  return Math.ceil(rest.length / CHARS_PER_TOKEN + hex / HEX_CHARS_PER_TOKEN);
}

// Tokens of a block of text of known length (the system prompt, the tool definitions).
export const estimateChars = (chars: number): number => Math.ceil(chars / CHARS_PER_TOKEN);

export function estimateTokens(m: ApiMessage): number {
  let tokens = PER_MESSAGE;
  if (m.role === 'user' && typeof m.content !== 'string') {
    for (const part of m.content) {
      if (part.type === 'text') tokens += textTokens(part.text);
      else tokens += IMAGE_TOKENS;
    }
  } else if (typeof m.content === 'string') {
    tokens += textTokens(m.content);
  }
  if (m.role === 'assistant' && m.tool_calls) {
    for (const tc of m.tool_calls) tokens += textTokens(tc.function.name + tc.function.arguments) + Math.ceil(16 / CHARS_PER_TOKEN);
  }
  return tokens;
}

export function splitTurns(messages: readonly ApiMessage[]): ApiMessage[][] {
  const turns: ApiMessage[][] = [];
  for (const m of messages) {
    if (m.role === 'system') continue; // the loop adds its own
    if (m.role === 'user' || turns.length === 0) turns.push([m]);
    else turns[turns.length - 1]!.push(m);
  }
  return turns;
}

export interface TrimmedHistory {
  readonly kept: ApiMessage[];
  readonly dropped: ApiMessage[];
}

// By default the last turn is kept even over budget: it is the question. The
// agent loop passes `keepLast: false` because its question travels apart from
// the history, so a last turn that is a pasted dump can give way like any other.
export function trimHistory(messages: readonly ApiMessage[], budgetTokens: number, { keepLast = true } = {}): TrimmedHistory {
  const turns = splitTurns(messages);
  const cost = turns.map((t) => t.reduce((sum, m) => sum + estimateTokens(m), 0));
  let total = cost.reduce((a, b) => a + b, 0);
  let first = 0;
  while (first < turns.length - (keepLast ? 1 : 0) && total > budgetTokens) {
    total -= cost[first]!;
    first += 1;
  }
  return { kept: turns.slice(first).flat(), dropped: turns.slice(0, first).flat() };
}

// Summarise before the window is full, not when turns already fall out of it:
// past SUMMARY_FROM tokens of history, the oldest turns down to SUMMARY_KEEP are
// handed to the summary (in the background, after the answer). Then the next turns
// start with a summary in place, and nothing measured is lost to a sudden cut.
export const SUMMARY_FROM = 6_000;
export const SUMMARY_KEEP = 3_500;

export function turnsToSummarize(messages: readonly ApiMessage[]): ApiMessage[] {
  const total = messages.reduce((sum, m) => sum + estimateTokens(m), 0);
  return total > SUMMARY_FROM ? trimHistory(messages, SUMMARY_KEEP).dropped : [];
}
