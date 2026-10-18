// LlmPort over HTTP: OpenAI-style chat/completions with streaming (SSE), as
// served by new-api → vLLM (ADR-0008).
//
// `fetch` is injected: on the phone it is expo/fetch (streams response bodies
// on Android), in Node scripts the global one. Timeouts follow ADR-0007's plan:
// a slow first byte or a stalled stream aborts the call.

import { ChatStreamAccumulator, SseDecoder } from '@/domain/assistant/sse';
import type { LlmCallOptions, LlmPort, LlmRequest, LlmResult } from '@/domain/ports/llm.port';

type FetchLike = (url: string, init: {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
}) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  body: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> } } | null;
}>;

export interface OpenAiChatClientConfig {
  readonly baseUrl: string; // …/llm/v1
  readonly apiKey: string;
  readonly model: string; // the alias, e.g. obdient-chat
  readonly fetch: FetchLike;
  readonly firstByteTimeoutMs?: number;
  readonly idleTimeoutMs?: number;
}

export class LlmHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// Sampling recommended for Qwen3.8 (tested 2026-10-18): thinking off for chat.
const SAMPLING = { temperature: 0.7, top_p: 0.8, top_k: 20 };
const SAMPLING_THINKING = { temperature: 0.6, top_p: 0.95, top_k: 20 };

export class OpenAiChatClient implements LlmPort {
  constructor(private readonly config: OpenAiChatClientConfig) {}

  async complete(request: LlmRequest, options: LlmCallOptions = {}): Promise<LlmResult> {
    const { firstByteTimeoutMs = 8_000, idleTimeoutMs = 15_000 } = this.config;
    const controller = new AbortController();
    const outer = options.signal;
    const onAbort = () => controller.abort();
    outer?.addEventListener('abort', onAbort);
    let timer: ReturnType<typeof setTimeout> | null = null;
    let timedOut = false;
    const arm = (ms: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, ms);
    };

    try {
      arm(firstByteTimeoutMs);
      const res = await this.config.fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: request.messages,
          tools: request.tools,
          tool_choice: request.toolChoice,
          max_tokens: request.maxTokens,
          stream: true,
          chat_template_kwargs: { enable_thinking: request.thinking },
          ...(request.thinking ? SAMPLING_THINKING : SAMPLING),
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new LlmHttpError(res.status, (await res.text()).slice(0, 300));
      if (!res.body) throw new LlmHttpError(res.status, 'La respuesta no tiene cuerpo.');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const sse = new SseDecoder();
      const acc = new ChatStreamAccumulator();
      for (;;) {
        arm(idleTimeoutMs);
        const { done, value } = await reader.read();
        if (done) break;
        for (const payload of sse.push(decoder.decode(value, { stream: true }))) {
          const delta = acc.push(payload);
          if (delta) options.onText?.(delta);
        }
        if (acc.done) break;
      }
      return { content: acc.content, toolCalls: acc.toolCalls, finishReason: acc.finishReason };
    } catch (err) {
      if (timedOut && !outer?.aborted) throw new LlmHttpError(0, 'El asistente no respondió a tiempo.');
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
      outer?.removeEventListener('abort', onAbort);
    }
  }
}
