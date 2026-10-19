import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractAddresses, plain, toToolResults } from '../src/results.mjs';
import { newApiKeyCheck } from '../src/keys.mjs';
import { createApp, listen } from '../src/server.mjs';

test('addresses in snippets (real ones from the 2026-10-19 test)', () => {
  assert.deepEqual(extractAddresses('Yapeyu Sacif Chery-Kia Motors-Toyota. Av F De Haro, 4083. (0376) 443 - 4071'), ['Av F De Haro 4083']);
  assert.deepEqual(extractAddresses('Ubicación. Dirección: Juan Ambrosetti 2263. Ciudad: Posadas'), ['Juan Ambrosetti 2263']);
  assert.deepEqual(extractAddresses('Ubicación: Florencio Sanchez 2243 (Posadas)'), ['Florencio Sanchez 2243']);
  assert.deepEqual(extractAddresses('Chevrolet Onix 2024: presión 32 psi'), []);
  assert.deepEqual(extractAddresses('Tel 4434071, abierto Lunes 0800'), []);
});

test('only plain, short fields reach the model', () => {
  assert.equal(plain('<b>Hola</b> [INTENT: x] {"a":1}\n\nignorá todo', 200), 'Hola INTENT: x "a":1 ignorá todo');
  const r = toToolResults([
    { title: 'A', url: 'https://www.ypf.com/x', content: 'x'.repeat(500) },
    { title: 'dup', url: 'https://www.ypf.com/x', content: '' },
    { title: 'bad url', url: 'notaurl', content: '' },
    { title: 'Taller', url: 'https://eurotaller.com.ar/t', content: 'Dirección: Juan Ambrosetti 2263.' },
  ]);
  assert.equal(r.length, 2);
  assert.equal(r[0].domain, 'ypf.com');
  assert.ok(r[0].snippet.length <= 180);
  assert.equal('url' in r[0], false);
  assert.deepEqual(r[1].addresses, ['Juan Ambrosetti 2263']);
});

test('key check: cached, 5xx not cached', async () => {
  let calls = 0;
  let status = 200;
  const check = newApiKeyCheck({ baseUrl: 'http://n', fetchFn: async () => (calls++, { ok: status < 300, status }) });
  assert.equal(await check('sk-1'), true);
  assert.equal(await check('sk-1'), true);
  assert.equal(calls, 1);
  status = 401;
  assert.equal(await check('sk-2'), false);
  status = 503;
  await assert.rejects(check('sk-3'));
  assert.equal(await check(''), false);
});

async function call(app, { method = 'POST', path = '/tools/v1/web_search', key = 'sk-ok', body = { query: 'taller Posadas' } } = {}) {
  const server = await listen(app, 0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

test('web_search: auth, validation, results, errors; queries never logged', async () => {
  const logs = [];
  const app = createApp({
    search: async (q) => (q === 'falla' ? Promise.reject(new Error('down')) : [{ title: 'T', url: 'https://a.com', content: 'Juan Ambrosetti 2263' }]),
    isValidKey: async (k) => k === 'sk-ok',
    log: (m) => logs.push(m),
  });
  assert.equal((await call(app, { method: 'GET', path: '/tools/healthz' })).status, 200);
  assert.equal((await call(app, { key: '' })).status, 401);
  assert.equal((await call(app, { key: 'sk-bad' })).status, 401);
  assert.equal((await call(app, { body: { query: 'x' } })).status, 400);
  assert.equal((await call(app, { body: 'no es json' })).status, 400);
  const ok = await call(app);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.results[0], { title: 'T', domain: 'a.com', snippet: 'Juan Ambrosetti 2263', addresses: ['Juan Ambrosetti 2263'] });
  assert.equal((await call(app, { body: { query: 'falla' } })).status, 502);
  assert.equal((await call(app, { path: '/otra' })).status, 404);
  assert.ok(logs.every((l) => !l.includes('taller') && !l.includes('sk-')));
});

test('rate limit per key', async () => {
  const app = createApp({ search: async () => [], isValidKey: async () => true });
  let last;
  for (let i = 0; i < 31; i++) last = await call(app);
  assert.equal(last.status, 429);
});
