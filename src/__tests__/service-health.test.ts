import { checkServices, type HealthFetch } from '@/data/service-health';

const TARGETS = {
  toolsUrl: 'https://x/tools',
  authUrl: 'https://x/auth/',
  routingUrl: 'https://x/osrm',
  geocoderUrl: 'https://x/photon',
  llm: { baseUrl: 'https://x/llm/v1', apiKey: 'sk-test', model: 'obdient-chat' },
};

describe('Estado del servidor', () => {
  it('asks each server once; the model with a real one-token answer', async () => {
    const calls: { url: string; method: string | undefined; body: string | undefined }[] = [];
    const fetchFn: HealthFetch = async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body });
      return url.includes('/llm/') ? { ok: false, status: 500 } : { ok: true, status: 200 };
    };
    const out = await checkServices(TARGETS, fetchFn);
    expect(out.map((c) => [c.id, c.ok])).toEqual([
      ['tools', true],
      ['auth', true],
      ['model', false],
      ['routing', true],
      ['geocoder', true],
    ]);
    expect(out.find((c) => c.id === 'model')!.detail).toBe('error 500');
    expect(calls.map((c) => c.url)).toContain('https://x/auth/healthz');
    const model = calls.find((c) => c.url.endsWith('/chat/completions'))!;
    expect(model.method).toBe('POST');
    expect(JSON.parse(model.body!)).toMatchObject({ model: 'obdient-chat', max_tokens: 1 });
  });

  it('no account: the model is not tried; a server that cannot be reached says so', async () => {
    const out = await checkServices({ ...TARGETS, llm: null }, async (url) => {
      if (url.includes('photon')) throw new Error('network');
      return { ok: true, status: 200 };
    });
    expect(out.find((c) => c.id === 'model')).toMatchObject({ ok: null, detail: 'necesita la cuenta' });
    expect(out.find((c) => c.id === 'geocoder')).toMatchObject({ ok: false, detail: 'sin conexión' });
  });
});
