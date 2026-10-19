// web_search, dollar_rate and car_price (M8): obdient-tools answers them with
// plain, short fields; nothing here needs the phone's position.

import type { ToolCall, ToolOutcome } from '@/domain/assistant/tools';
import type { ToolsClient } from './tools-client';

interface WebResult {
  readonly title: string;
  readonly domain: string;
  readonly snippet: string;
  readonly addresses?: readonly string[];
  readonly prices?: readonly string[];
}

export class OnlineTools {
  constructor(private readonly client: ToolsClient) {}

  async execute(call: Extract<ToolCall, { name: 'web_search' | 'dollar_rate' | 'car_price' }>, signal: AbortSignal): Promise<ToolOutcome> {
    switch (call.name) {
      case 'web_search': {
        const r = await this.client.post<{ results?: WebResult[] }>('web_search', { query: call.query }, signal, 'La búsqueda web');
        if (!r.ok) return r;
        const results = (r.data.results ?? []).slice(0, 5);
        return {
          ok: true,
          data: { query: call.query, results },
          summary: results.length ? `${results.length} resultados de la web` : 'Sin resultados en la web',
        };
      }
      case 'dollar_rate': {
        const r = await this.client.post<{ rates?: unknown[]; updated?: string; source?: string }>('dollar', {}, signal, 'El dólar');
        if (!r.ok) return r;
        return { ok: true, data: r.data, summary: `${r.data.rates?.length ?? 0} cotizaciones del dólar` };
      }
      case 'car_price': {
        const body = { query: call.query, ...(call.year ? { year: call.year } : {}) };
        const r = await this.client.post<{ results?: unknown[]; month?: string; unit?: string; source?: string }>('car_price', body, signal, 'La lista de precios');
        if (!r.ok) return r;
        const n = r.data.results?.length ?? 0;
        return { ok: true, data: r.data, summary: n ? `${n} versiones en la lista de ${r.data.month ?? 'la CCA'}` : 'No está en la lista de precios' };
      }
    }
  }
}
