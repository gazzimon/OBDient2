// web_search, dollar_rate and car_price (M8): obdient-tools answers them with
// plain, short fields; nothing here needs the phone's position.

import type { SourceLink, ToolCall, ToolOutcome } from '@/domain/assistant/tools';
import type { ScanTarget } from '@/domain/obd/module-scan';
import type { ToolsClient } from './tools-client';

interface WebResult {
  readonly title: string;
  readonly domain: string;
  readonly snippet: string;
  readonly addresses?: readonly string[];
  readonly prices?: readonly string[];
}

// A fragment of the lab's text base (obdient-tools /docs): third-party text with
// its source and the day it was read.
interface DocHit {
  readonly text: string;
  readonly source: string;
  readonly title: string | null;
  readonly page: number | null;
  readonly fetchedAt: string;
  readonly score: number;
}

// research (obdient-tools /research): the fragments that answer, and how good they are.
type Grade = 'good' | 'weak' | 'none';
interface Passage {
  readonly n: number;
  readonly site: string;
  readonly source: string;
  readonly title: string | null;
  readonly section: string | null;
  readonly fetchedAt: string;
  readonly text: string;
}
interface ResearchReply {
  readonly query: string;
  readonly grade: Grade;
  readonly passages: readonly Passage[];
  readonly read: readonly { readonly url: string; readonly site: string; readonly title: string | null; readonly status: 'read' | 'cached' | 'failed' }[];
  readonly also: readonly { readonly site: string; readonly title: string; readonly url: string }[];
  readonly hint: string;
}

// Reading three pages and indexing them takes longer than a plain search; the corrective round (more pages) can double it.
const RESEARCH_TIMEOUT_MS = 60_000;

// The line under the tool row: which sites were read and whether the answer is there.
export function researchSummary(d: ResearchReply): string {
  const sites = [...new Set(d.read.filter((r) => r.status !== 'failed').map((r) => r.site))];
  const where = sites.length ? sites.join(', ') : 'ninguna página se pudo leer';
  if (d.grade === 'none') return `Leí ${where}: no apareció el dato`;
  const n = d.passages.length;
  return `Leí ${where}: ${n} ${n === 1 ? 'fragmento' : 'fragmentos'}${d.grade === 'weak' ? ' (parcial)' : ''}`;
}

// The pages that were read, for the buttons: only http(s), the ones that gave
// fragments first. (A page the app cannot open is not offered.)
export function researchSources(d: ResearchReply): SourceLink[] {
  const used = new Set(d.passages.map((p) => p.source));
  return d.read
    .filter((r) => r.status !== 'failed' && /^https?:\/\//i.test(r.url))
    .sort((a, b) => Number(used.has(b.url)) - Number(used.has(a.url)))
    .map((r) => ({ site: r.site, title: r.title, url: r.url }));
}

export class OnlineTools {
  constructor(private readonly client: ToolsClient) {}

  // Saves a module scan into the lab's shared knowledge (fire and forget).
  async reportKnowledge(rec: Record<string, unknown>, signal: AbortSignal): Promise<void> {
    await this.client.post('knowledge', { action: 'report', ...rec }, signal, 'La base del laboratorio').catch(() => undefined);
  }

  // The addresses the lab knows for a make (this model first, then the rest of
  // the make), for scan_modules to probe. Offline or unknown → none.
  async scanTargets(make: string, model: string | null, signal: AbortSignal): Promise<ScanTarget[]> {
    type Mod = { id?: string; reqHeader?: string; rxHeader?: string; label?: string; sub?: string };
    const r = await this.client.post<{ exact?: { modules?: Mod[] } | null; close?: { modules?: Mod[] }[]; sameMake?: Mod[] }>(
      'knowledge',
      { action: 'lookup', make, ...(model ? { model } : {}) },
      signal,
      'La base del laboratorio',
    );
    if (!r.ok) return [];
    const mods = [...(r.data.exact?.modules ?? []), ...(r.data.close ?? []).flatMap((c) => c.modules ?? []), ...(r.data.sameMake ?? [])];
    const out = new Map<string, ScanTarget>();
    for (const m of mods) {
      // Extended addressing (a sub-address byte, Toyota) is not probed yet.
      if (!m.id || m.sub || !m.reqHeader || !m.rxHeader || !/^([0-9A-F]{3}|[0-9A-F]{8})$/.test(m.reqHeader) || !/^([0-9A-F]{3}|[0-9A-F]{8})$/.test(m.rxHeader)) continue;
      if (!out.has(m.id)) out.set(m.id, { id: m.id, reqHeader: m.reqHeader, rxHeader: m.rxHeader, label: m.label ?? 'módulo' });
    }
    return [...out.values()];
  }

  async execute(call: Extract<ToolCall, { name: 'web_search' | 'research' | 'web_fetch' | 'knowledge_lookup' | 'docs_search' | 'dollar_rate' | 'car_price' }>, signal: AbortSignal): Promise<ToolOutcome> {
    switch (call.name) {
      case 'research': {
        // Search, read and rank happen on the server: up to three pages in parallel.
        const body = { query: call.query, ...(call.queryEn ? { query_en: call.queryEn } : {}) };
        const r = await this.client.post<ResearchReply>('research', body, signal, 'La investigación en internet', RESEARCH_TIMEOUT_MS);
        if (!r.ok) return r;
        return { ok: true, data: r.data, summary: researchSummary(r.data), sources: researchSources(r.data) };
      }
      case 'web_fetch': {
        const body = { url: call.url, ...(call.focus ? { focus: call.focus } : {}) };
        const r = await this.client.post<{ url: string; domain: string; title?: string | null; text?: string; grade?: Grade; passages?: Passage[]; hint?: string }>('web_fetch', body, signal, 'La lectura de la página', call.focus ? RESEARCH_TIMEOUT_MS : undefined);
        if (!r.ok) return r;
        const { domain, url, title, text, grade, passages, hint } = r.data;
        if (passages) {
          const summary = grade === 'none' ? `Leí ${domain}: no habla de "${call.focus}"` : `Leí ${domain}: ${passages.length} fragmentos sobre "${call.focus}"`;
          return { ok: true, data: { url, site: domain, title: title ?? null, grade, passages, hint }, summary, sources: grade === 'none' ? [] : [{ site: domain, title: title ?? null, url }] };
        }
        return { ok: true, data: { url, site: domain, title: title ?? null, text }, summary: `Leí ${domain}`, sources: [{ site: domain, title: title ?? null, url }] };
      }
      case 'knowledge_lookup': {
        const body = { action: 'lookup', ...(call.make ? { make: call.make } : {}), ...(call.model ? { model: call.model } : {}), ...(call.year ? { year: call.year } : {}) };
        const r = await this.client.post<{ exact: unknown; close?: unknown[]; sameMake: unknown[] }>('knowledge', body, signal, 'La base del laboratorio');
        if (!r.ok) return r;
        const known = r.data.exact != null || (r.data.close?.length ?? 0) > 0 || (r.data.sameMake?.length ?? 0) > 0;
        return { ok: true, data: r.data, summary: known ? 'Datos del laboratorio sobre este auto' : 'El laboratorio no tiene datos de este auto todavía' };
      }
      case 'docs_search': {
        const r = await this.client.post<{ results?: DocHit[] }>('docs', { action: 'search', query: call.query }, signal, 'La base de textos');
        if (!r.ok) return r;
        const results = r.data.results ?? [];
        return {
          ok: true,
          data: { query: call.query, results },
          summary: results.length ? `${results.length} fragmentos de la base de textos` : 'La base de textos no tiene nada sobre eso',
        };
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
