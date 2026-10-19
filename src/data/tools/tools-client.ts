// The phone's side of obdient-tools (K16): one POST per tool, with the
// account's model key, a timeout, and failures sorted into what the model can
// read (ToolOutcome errors).

import type { ToolErrorCode } from '@/domain/assistant/tools';
import type { LlmCredentials } from '@/data/auth/account-service';

export type ToolsFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type ToolsReply<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: ToolErrorCode; readonly message: string };

const TIMEOUT_MS = 10_000;

export class ToolsClient {
  constructor(
    private readonly deps: {
      readonly url: string;
      readonly credentials: () => LlmCredentials | null;
      readonly fetchFn?: ToolsFetch;
    },
  ) {}

  async post<T>(tool: string, body: Record<string, unknown>, signal: AbortSignal, what: string): Promise<ToolsReply<T>> {
    const creds = this.deps.credentials();
    if (!creds) return { ok: false, error: 'not_supported', message: `${what} necesita la cuenta.` };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const onAbort = () => controller.abort();
    signal.addEventListener('abort', onAbort);
    const fetchFn = this.deps.fetchFn ?? (fetch as unknown as ToolsFetch);
    try {
      const res = await fetchFn(`${this.deps.url.replace(/\/$/, '')}/v1/${tool}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${creds.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (res.status === 429) return { ok: false, error: 'too_many_calls', message: 'Demasiadas consultas seguidas: esperá un minuto.' };
      if (res.status === 503) return { ok: false, error: 'not_supported', message: `${what}: todavía no hay datos en el servidor.` };
      if (!res.ok) return { ok: false, error: 'not_supported', message: `${what} no está disponible (HTTP ${res.status}).` };
      return { ok: true, data: (await res.json()) as T };
    } catch {
      if (signal.aborted) return { ok: false, error: 'cancelled', message: 'Cancelado.' };
      return { ok: false, error: 'timeout', message: `Sin conexión: ${what.toLowerCase()} no respondió.` };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  }
}
