// Ajustes › Dev › Estado del servidor (2026-10-31): which of the app's servers
// answer right now. Started by hand, never in the background. The model is asked
// for one token: its gateway lists the model even when the GPU behind it is down
// (2026-10-29, the Z440 rebooted without its NVIDIA driver and only a real
// answer showed it).

import type { LlmCredentials } from '@/data/auth/account-service';

export type HealthFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

export interface HealthCheck {
  readonly id: 'tools' | 'auth' | 'model' | 'routing' | 'geocoder';
  readonly label: string;
  // null: not tried (the model without an account).
  readonly ok: boolean | null;
  readonly ms: number | null;
  readonly detail: string;
}

export interface HealthTargets {
  readonly toolsUrl: string;
  readonly authUrl: string;
  readonly routingUrl: string;
  readonly geocoderUrl: string;
  readonly llm: LlmCredentials | null;
}

const TIMEOUT_MS = 10_000;
const base = (url: string) => url.replace(/\/+$/, '');

export async function checkServices(t: HealthTargets, fetchFn: HealthFetch, now: () => number = Date.now): Promise<HealthCheck[]> {
  const probe = async (id: HealthCheck['id'], label: string, url: string, init?: Parameters<HealthFetch>[1]): Promise<HealthCheck> => {
    const started = now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await fetchFn(url, { ...init, signal: ctrl.signal });
      return { id, label, ok: r.ok, ms: now() - started, detail: r.ok ? 'responde' : `error ${r.status}` };
    } catch {
      return { id, label, ok: false, ms: null, detail: ctrl.signal.aborted ? 'no respondió a tiempo' : 'sin conexión' };
    } finally {
      clearTimeout(timer);
    }
  };
  const model: Promise<HealthCheck> = t.llm
    ? probe('model', 'Modelo del asistente', `${base(t.llm.baseUrl)}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${t.llm.apiKey}` },
        body: JSON.stringify({ model: t.llm.model, messages: [{ role: 'user', content: 'ok' }], max_tokens: 1 }),
      })
    : Promise.resolve({ id: 'model', label: 'Modelo del asistente', ok: null, ms: null, detail: 'necesita la cuenta' });
  return Promise.all([
    probe('tools', 'Herramientas y laboratorio', `${base(t.toolsUrl)}/healthz`),
    probe('auth', 'Cuentas', `${base(t.authUrl)}/healthz`),
    model,
    // A short route in Buenos Aires and one search: the servers in Argentina.
    probe('routing', 'Rutas (OSRM)', `${base(t.routingUrl)}/route/v1/driving/-58.3816,-34.6037;-58.3700,-34.6083?overview=false`),
    probe('geocoder', 'Búsqueda (Photon)', `${base(t.geocoderUrl)}/api?q=obelisco&limit=1`),
  ]);
}
