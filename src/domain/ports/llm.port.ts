// The language model as the assistant sees it: OpenAI-style chat completions.
// The data layer implements it over HTTP + SSE (new-api → vLLM, ADR-0008).

import type { ToolSchema } from '@/domain/assistant/tools';

export interface ApiToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: { readonly name: string; readonly arguments: string };
}

export type UserContentPart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image_url'; readonly image_url: { readonly url: string } };

// Messages exactly as the API takes them: this is also what history stores,
// because it has to be sent back as is.
export type ApiMessage =
  | { readonly role: 'system'; readonly content: string }
  | { readonly role: 'user'; readonly content: string | readonly UserContentPart[] }
  | { readonly role: 'assistant'; readonly content: string | null; readonly tool_calls?: readonly ApiToolCall[] }
  | { readonly role: 'tool'; readonly tool_call_id: string; readonly content: string };

export interface LlmRequest {
  readonly messages: readonly ApiMessage[];
  readonly tools: readonly ToolSchema[];
  readonly toolChoice: 'auto' | 'none';
  readonly maxTokens: number;
  // Model-side reasoning: off by default (seconds of latency, not shown).
  readonly thinking: boolean;
}

export interface AssembledToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
}

export interface LlmResult {
  readonly content: string;
  readonly toolCalls: readonly AssembledToolCall[];
  readonly finishReason: string | null;
  // Characters of model-side reasoning that were not shown (diagnostics only).
  readonly reasoningChars?: number;
}

export interface LlmCallOptions {
  readonly signal?: AbortSignal;
  // Visible text as it streams.
  readonly onText?: (delta: string) => void;
}

export interface LlmPort {
  complete(request: LlmRequest, options?: LlmCallOptions): Promise<LlmResult>;
}
