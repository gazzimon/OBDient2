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

// Tokens of a block of text (the system prompt, the tool definitions).
export const estimateChars = (chars: number): number => Math.ceil(chars / CHARS_PER_TOKEN);

export function estimateTokens(m: ApiMessage): number {
  let chars = 0;
  let images = 0;
  if (m.role === 'user' && typeof m.content !== 'string') {
    for (const part of m.content) {
      if (part.type === 'text') chars += part.text.length;
      else images += 1;
    }
  } else if (typeof m.content === 'string') {
    chars += m.content.length;
  }
  if (m.role === 'assistant' && m.tool_calls) {
    for (const tc of m.tool_calls) chars += tc.function.name.length + tc.function.arguments.length + 16;
  }
  return Math.ceil(chars / CHARS_PER_TOKEN) + PER_MESSAGE + images * IMAGE_TOKENS;
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

// The last turn is always kept, even over budget: it is the question.
export function trimHistory(messages: readonly ApiMessage[], budgetTokens: number): TrimmedHistory {
  const turns = splitTurns(messages);
  const cost = turns.map((t) => t.reduce((sum, m) => sum + estimateTokens(m), 0));
  let total = cost.reduce((a, b) => a + b, 0);
  let first = 0;
  while (first < turns.length - 1 && total > budgetTokens) {
    total -= cost[first]!;
    first += 1;
  }
  return { kept: turns.slice(first).flat(), dropped: turns.slice(0, first).flat() };
}
