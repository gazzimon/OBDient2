// web_search (M8): the phone asks obdient-tools (K16, SearXNG behind it) with
// the account's model key. The service already returns plain, short fields.

import type { ToolCall, ToolOutcome } from '@/domain/assistant/tools';
import type { LlmCredentials } from '@/data/auth/account-service';

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

const TIMEOUT_MS = 10_000;

interface WebResult {
  readonly title: string;
  readonly domain: string;
  readonly snippet: string;
  readonly addresses?: readonly string[];
}

export class WebSearchTool {
  constructor(
    private readonly deps: {
      readonly url: string;
      readonly credentials: () => LlmCredentials | null;
      readonly fetchFn?: Fetch;
    },
  ) {}

  async execute(call: Extract<ToolCall, { name: 'web_search' }>, signal: AbortSignal): Promise<ToolOutcome> {
    const creds = this.deps.credentials();
    if (!creds) return { ok: false, error: 'not_supported', message: 'La búsqueda web necesita la cuenta.' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const onAbort = () => controller.abort();
    signal.addEventListener('abort', onAbort);
    const fetchFn = this.deps.fetchFn ?? (fetch as unknown as Fetch);
    try {
      const res = await fetchFn(`${this.deps.url.replace(/\/$/, '')}/v1/web_search`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${creds.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: call.query }),
        signal: controller.signal,
      });
      if (res.status === 429) return { ok: false, error: 'too_many_calls', message: 'Demasiadas búsquedas seguidas: esperá un minuto.' };
      if (!res.ok) return { ok: false, error: 'not_supported', message: `La búsqueda web no está disponible (HTTP ${res.status}).` };
      const body = (await res.json()) as { results?: WebResult[] };
      const results = (body.results ?? []).slice(0, 5);
      return {
        ok: true,
        data: { query: call.query, results },
        summary: results.length ? `${results.length} resultados de la web` : 'Sin resultados en la web',
      };
    } catch {
      if (signal.aborted) return { ok: false, error: 'cancelled', message: 'Cancelado.' };
      return { ok: false, error: 'timeout', message: 'Sin conexión con la búsqueda web.' };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  }
}
