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

  // Saves a module scan into the lab's shared knowledge (fire and forget).
  async reportKnowledge(rec: Record<string, unknown>, signal: AbortSignal): Promise<void> {
    await this.client.post('knowledge', { action: 'report', ...rec }, signal, 'La base del laboratorio').catch(() => undefined);
  }

  async execute(call: Extract<ToolCall, { name: 'web_search' | 'web_fetch' | 'knowledge_lookup' | 'dollar_rate' | 'car_price' }>, signal: AbortSignal): Promise<ToolOutcome> {
    switch (call.name) {
      case 'web_fetch': {
        const r = await this.client.post<{ url: string; domain: string; weight: number; text: string }>('web_fetch', { url: call.url }, signal, 'La lectura de la página');
        if (!r.ok) return r;
        return { ok: true, data: { url: r.data.url, site: r.data.domain, text: r.data.text }, summary: `Leí ${r.data.domain}` };
      }
      case 'knowledge_lookup': {
        const body = { action: 'lookup', ...(call.make ? { make: call.make } : {}), ...(call.model ? { model: call.model } : {}), ...(call.year ? { year: call.year } : {}) };
        const r = await this.client.post<{ exact: unknown; close?: unknown[]; byVin: unknown; sameMake: unknown[] }>('knowledge', body, signal, 'La base del laboratorio');
        if (!r.ok) return r;
        const known = r.data.exact != null || (r.data.close?.length ?? 0) > 0 || (r.data.sameMake?.length ?? 0) > 0;
        return { ok: true, data: r.data, summary: known ? 'Datos del laboratorio sobre este auto' : 'El laboratorio no tiene datos de este auto todavía' };
      }
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
