import { OnlineTools } from '@/data/tools/online-tools';
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
