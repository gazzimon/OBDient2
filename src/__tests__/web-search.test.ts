import { OnlineTools, researchSources } from '@/data/tools/online-tools';
import { ToolsClient, type ToolsFetch } from '@/data/tools/tools-client';
import { parseToolCall } from '@/domain/assistant/tools';

const CREDS = { baseUrl: 'https://x/llm/v1', apiKey: 'sk-test', model: 'm' };
const call = { name: 'web_search' as const, query: 'taller Posadas' };
const signal = new AbortController().signal;
const online = (deps: ConstructorParameters<typeof ToolsClient>[0] & { fetchFn: ToolsFetch }) => new OnlineTools(new ToolsClient(deps));

describe('web_search', () => {
  it('parses strictly', () => {
    expect(parseToolCall('web_search', '{"query":"taller Posadas"}', [])).toEqual({ ok: true, call });
    expect(parseToolCall('web_search', '{"query":"x"}', []).ok).toBe(false);
    expect(parseToolCall('web_search', '{"query":"ok ok","url":"http://x"}', []).ok).toBe(false);
  });

  it('asks obdient-tools with the account key and returns at most 5 results', async () => {
    const seen: { url: string; auth: string; body: string }[] = [];
    const t = online({
      url: 'https://obdient.duckdns.org/tools/',
      credentials: () => CREDS,
      fetchFn: async (url, init) => {
        seen.push({ url, auth: init.headers.Authorization!, body: init.body });
        const results = Array.from({ length: 7 }, (_, i) => ({ title: `T${i}`, domain: 'a.com', snippet: 's' }));
        return { ok: true, status: 200, json: async () => ({ results }) };
      },
    });
    const r = await t.execute(call, signal);
    expect(seen).toEqual([{ url: 'https://obdient.duckdns.org/tools/v1/web_search', auth: 'Bearer sk-test', body: '{"query":"taller Posadas"}' }]);
    expect(r.ok && (r.data as { results: unknown[] }).results).toHaveLength(5);
  });

  it('fails in words the model can tell', async () => {
    const make = (f: () => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>) =>
      online({ url: 'u', credentials: () => CREDS, fetchFn: f });
    expect(await make(async () => ({ ok: false, status: 429, json: async () => ({}) })).execute(call, signal)).toMatchObject({ ok: false, error: 'too_many_calls' });
    expect(await make(async () => ({ ok: false, status: 502, json: async () => ({}) })).execute(call, signal)).toMatchObject({ ok: false, error: 'not_supported' });
    expect(await make(async () => Promise.reject(new TypeError('Network request failed'))).execute(call, signal)).toMatchObject({ ok: false, error: 'timeout' });
    const noAccount = online({ url: 'u', credentials: () => null, fetchFn: async () => ({ ok: true, status: 200, json: async () => ({}) }) });
    expect(await noAccount.execute(call, signal)).toMatchObject({ ok: false });
  });
});

describe('research', () => {
  const reply = (grade: 'good' | 'weak' | 'none', passages = 2) => ({
    query: 'q',
    grade,
    passages: Array.from({ length: grade === 'none' ? 0 : passages }, (_, i) => ({ n: i + 1, site: 'github.com', source: 'https://github.com/x', title: 'GM DIDs', section: 'Odómetro', fetchedAt: '2026-10-25', text: '«a1b2»22 F1 90«/a1b2»' })),
    read: [
      { url: 'https://github.com/x', site: 'github.com', title: 'GM DIDs', status: 'read' },
      { url: 'https://foro.example/y', site: 'foro.example', title: 'Foro', status: 'cached' },
      { url: 'https://falla.example/z', site: 'falla.example', title: 'X', status: 'failed' },
    ],
    also: [],
    hint: 'h',
  });

  it('parses query and the optional English twin; web_fetch takes an optional focus', () => {
    expect(parseToolCall('research', '{"query":"odómetro Tracker","query_en":"Tracker odometer"}', [])).toEqual({ ok: true, call: { name: 'research', query: 'odómetro Tracker', queryEn: 'Tracker odometer' } });
    expect(parseToolCall('research', '{"query":"odómetro Tracker"}', [])).toEqual({ ok: true, call: { name: 'research', query: 'odómetro Tracker', queryEn: null } });
    expect(parseToolCall('research', '{"query":"o"}', []).ok).toBe(false);
    expect(parseToolCall('research', '{"query":"ok ok","url":"http://x"}', []).ok).toBe(false);
    expect(parseToolCall('web_fetch', '{"url":"https://a.b/c","focus":"DID del odómetro"}', [])).toEqual({ ok: true, call: { name: 'web_fetch', url: 'https://a.b/c', focus: 'DID del odómetro' } });
    expect(parseToolCall('web_fetch', '{"url":"https://a.b/c"}', [])).toEqual({ ok: true, call: { name: 'web_fetch', url: 'https://a.b/c', focus: null } });
  });

  it('the row says which sites were read and whether the answer was there', async () => {
    const seen: string[] = [];
    const make = (grade: 'good' | 'weak' | 'none') =>
      online({ url: 'u', credentials: () => CREDS, fetchFn: async (url, init) => (seen.push(`${url} ${init.body}`), { ok: true, status: 200, json: async () => reply(grade) }) });
    const good = await make('good').execute({ name: 'research', query: 'odómetro', queryEn: 'odometer' }, signal);
    expect(good).toMatchObject({ ok: true, summary: 'Leí github.com, foro.example: 2 fragmentos' });
    expect(seen[0]).toBe('u/v1/research {"query":"odómetro","query_en":"odometer"}');
    expect(await make('weak').execute({ name: 'research', query: 'odómetro', queryEn: null }, signal)).toMatchObject({ summary: 'Leí github.com, foro.example: 2 fragmentos (parcial)' });
    expect(await make('none').execute({ name: 'research', query: 'odómetro', queryEn: null }, signal)).toMatchObject({ summary: 'Leí github.com, foro.example: no apareció el dato' });
    expect(seen[1]).toBe('u/v1/research {"query":"odómetro"}');
  });

  it('web_fetch with a focus returns the fragments of that page', async () => {
    const t = online({
      url: 'u',
      credentials: () => CREDS,
      fetchFn: async (_url, init) => ({ ok: true, status: 200, json: async () => ({ url: 'https://a.b/c', domain: 'a.b', title: 'T', grade: 'good', passages: reply('good').passages, hint: 'h', sent: init.body }) }),
    });
    const r = await t.execute({ name: 'web_fetch', url: 'https://a.b/c', focus: 'odómetro' }, signal);
    expect(r).toMatchObject({ ok: true, summary: 'Leí a.b: 2 fragmentos sobre "odómetro"' });
    expect(r.ok && (r.data as { passages: unknown[] }).passages).toHaveLength(2);
  });
});

describe('sources for the buttons under the row', () => {
  const read = (status: 'read' | 'cached' | 'failed', site: string, url = `https://${site}/x`) => ({ url, site, title: site, status });
  const base = { query: 'q', grade: 'good' as const, passages: [{ n: 1, site: 'b.example', source: 'https://b.example/x', title: 't', section: null, fetchedAt: '2026-10-26', text: 't' }], also: [], hint: 'h' };

  it('lists the pages that were read, those that gave fragments first, never a failed one', () => {
    const s = researchSources({ ...base, read: [read('read', 'a.example'), read('failed', 'caida.example'), read('cached', 'b.example')] });
    expect(s.map((x) => x.site)).toEqual(['b.example', 'a.example']);
    expect(s[0]).toEqual({ site: 'b.example', title: 'b.example', url: 'https://b.example/x' });
  });

  it('offers only web addresses', () => {
    const s = researchSources({ ...base, read: [read('read', 'a.example', 'javascript:alert(1)'), read('read', 'b.example')] });
    expect(s.map((x) => x.site)).toEqual(['b.example']);
  });

  it('research and web_fetch send them to the screen, not to the model', async () => {
    const t = online({
      url: 'u',
      credentials: () => CREDS,
      fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ ...base, read: [read('read', 'b.example')] }) }),
    });
    const out = await t.execute({ name: 'research', query: 'odómetro', queryEn: null }, signal);
    expect(out.ok && out.sources).toEqual([{ site: 'b.example', title: 'b.example', url: 'https://b.example/x' }]);
    expect(JSON.stringify(out.ok && out.data)).not.toContain('"sources"');
  });
});
