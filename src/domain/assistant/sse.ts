// Server-sent events from chat/completions, decoded incrementally.
//
// The network hands over arbitrary chunks: an event can arrive split anywhere,
// even mid-line. SseDecoder turns chunks into complete event payloads;
// ChatStreamAccumulator turns those into visible text, tool calls (whose
// fragments arrive by index) and the finish reason.

import type { AssembledToolCall } from '@/domain/ports/llm.port';

export class SseDecoder {
  private buffer = '';
  private data: string[] = [];

  // Returns the payloads of the events completed by this chunk.
  push(chunk: string): string[] {
    this.buffer += chunk;
    const out: string[] = [];
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      let line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line === '') {
        // Blank line: end of event.
        if (this.data.length) out.push(this.data.join('\n'));
        this.data = [];
      } else if (line.startsWith('data:')) {
        this.data.push(line.slice(line.startsWith('data: ') ? 6 : 5));
      }
      // Comments (":") and other fields (event, id, retry) are not used.
    }
    return out;
  }
}

interface PartialCall {
  id: string;
  name: string;
  arguments: string;
}

export class ChatStreamAccumulator {
  content = '';
  finishReason: string | null = null;
  done = false;
  reasoningChars = 0;
  // Payloads that were not JSON: counted, never fatal.
  malformed = 0;
  private calls = new Map<number, PartialCall>();

  // Feeds one event payload; returns the visible text it added ('' if none).
  push(payload: string): string {
    if (payload.trim() === '[DONE]') {
      this.done = true;
      return '';
    }
    let event: unknown;
    try {
      event = JSON.parse(payload);
    } catch {
      this.malformed += 1;
      return '';
    }
    const choice = (event as { choices?: unknown[] }).choices?.[0] as
      | { delta?: Record<string, unknown>; finish_reason?: string | null }
      | undefined;
    if (!choice) return '';
    if (choice.finish_reason) this.finishReason = choice.finish_reason;
    const delta = choice.delta ?? {};

    for (const raw of (delta.tool_calls as unknown[] | undefined) ?? []) {
      const tc = raw as { index?: number; id?: string; function?: { name?: string; arguments?: string } };
      const index = tc.index ?? 0;
      const call = this.calls.get(index) ?? { id: '', name: '', arguments: '' };
      if (tc.id) call.id = tc.id;
      if (tc.function?.name) call.name += tc.function.name;
      if (tc.function?.arguments) call.arguments += tc.function.arguments;
      this.calls.set(index, call);
    }

    // Reasoning (reasoning / reasoning_content) is never shown, only counted: an
    // empty answer after a long reasoning is a different failure from a cut stream.
    for (const key of ['reasoning_content', 'reasoning'] as const) {
      const r = delta[key];
      if (typeof r === 'string') this.reasoningChars += r.length;
    }
    const text = typeof delta.content === 'string' ? delta.content : '';
    if (!text) return '';
    // With thinking on, the visible answer starts with blank lines.
    const visible = this.content === '' ? text.replace(/^\s+/, '') : text;
    this.content += visible;
    return visible;
  }

  get toolCalls(): AssembledToolCall[] {
    return [...this.calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, c]) => ({ id: c.id || `call_${index}`, name: c.name, arguments: c.arguments }));
  }
}
