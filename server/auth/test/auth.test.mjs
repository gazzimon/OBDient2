import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { firebaseVerifier } from '../src/firebase.mjs';
import { CACHE_MS, newApiAccounts, tokenName } from '../src/newapi.mjs';
import { createApp, listen } from '../src/server.mjs';

const PROJECT = 'obdient2-test';

// A stand-in for Google's signing keys.
const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
const verify = firebaseVerifier(PROJECT, { jwks: createLocalJWKSet({ keys: [jwk] }) });

function idToken({ sub = 'uid-123', aud = PROJECT, iss = `https://securetoken.google.com/${PROJECT}`, exp = '1h', key = privateKey } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ auth_time: now - 10, email: 'a@b.c', firebase: { sign_in_provider: 'google.com' } })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setSubject(sub)
    .setAudience(aud)
    .setIssuer(iss)
    .setIssuedAt(now - 10)
    .setExpirationTime(exp)
    .sign(key);
}

// In-memory new-api: tokens of the service user.
function fakeNewApi() {
  const tokens = [];
  let nextId = 1;
  const calls = [];
  const fetch = async (url, { method, headers, body }) => {
    const u = new URL(url);
    calls.push(`${method} ${u.pathname}`);
    assert.equal(headers['New-Api-User'], '7');
    const json = (data) => ({ ok: true, json: async () => ({ success: true, data }) });
    if (method === 'GET' && u.pathname === '/api/token/search') {
      const kw = u.searchParams.get('keyword');
      return json({ items: tokens.filter((t) => t.name.includes(kw)).map((t) => ({ ...t, key: t.key.slice(0, 4) + '****' })) });
    }
    if (method === 'POST' && u.pathname === '/api/token/') {
      const b = JSON.parse(body);
      tokens.push({ id: nextId++, name: b.name, key: `key${nextId}secret`, status: 1, model_limits: b.model_limits });
      return json(null);
    }
    const keyMatch = /^\/api\/token\/(\d+)\/key$/.exec(u.pathname);
    if (method === 'POST' && keyMatch) return json({ key: tokens.find((t) => t.id === Number(keyMatch[1])).key });
    const del = /^\/api\/token\/(\d+)$/.exec(u.pathname);
    if (method === 'DELETE' && del) {
      tokens.splice(tokens.findIndex((t) => t.id === Number(del[1])), 1);
      return json(null);
    }
    return { ok: false, status: 404 };
  };
  return { tokens, calls, fetch };
}

async function server(api = fakeNewApi(), clock = { t: 0 }) {
  const accounts = newApiAccounts({
    baseUrl: 'http://newapi',
    userId: 7,
    accessToken: 'svc',
    model: 'obdient-chat',
    quota: 1000,
    fetch: api.fetch,
    now: () => clock.t,
  });
  const logs = [];
  const app = createApp({ verify, accounts, model: 'obdient-chat', publicBaseUrl: 'https://x/llm/v1', log: (m) => logs.push(m) });
  const srv = await listen(app, 0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const req = (method, path, token, ip = '1.1.1.1') =>
    fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'X-Forwarded-For': ip } });
  return { api, req, logs, close: () => srv.close() };
}

test('verifier accepts a good token and rejects the wrong project, issuer, expiry or key', async () => {
  assert.deepEqual(await verify(await idToken()), { uid: 'uid-123', email: 'a@b.c', provider: 'google.com' });
  const other = (await generateKeyPair('RS256')).privateKey;
  for (const bad of [
    await idToken({ aud: 'other' }),
    await idToken({ iss: 'https://securetoken.google.com/other' }),
    await idToken({ exp: Math.floor(Date.now() / 1000) - 3600 }),
    await idToken({ key: other }),
    'not-a-jwt',
  ]) {
    await assert.rejects(verify(bad), { name: 'InvalidIdToken' });
  }
});

test('first login creates the account token, later logins return the same key', async () => {
  const s = await server();
  try {
    const t = await idToken();
    const r1 = await s.req('POST', '/auth/v1/session', t);
    assert.equal(r1.status, 200);
    const b1 = await r1.json();
    assert.deepEqual(b1, { apiKey: 'sk-key2secret', model: 'obdient-chat', baseUrl: 'https://x/llm/v1' });
    const b2 = await (await s.req('POST', '/auth/v1/session', t)).json();
    assert.equal(b2.apiKey, b1.apiKey);
    assert.equal(s.api.tokens.length, 1);
    assert.equal(s.api.tokens[0].name, tokenName('uid-123'));
    assert.equal(s.api.tokens[0].model_limits, 'obdient-chat');
    assert.ok(!s.api.tokens[0].name.includes('uid-123'), 'the uid never reaches new-api');
  } finally {
    s.close();
  }
});

test('a cached key spares new-api; after the cache time its status is checked again', async () => {
  const clock = { t: 0 };
  const s = await server(fakeNewApi(), clock);
  try {
    const t = await idToken({ sub: 'cached' });
    await s.req('POST', '/auth/v1/session', t);
    const before = s.api.calls.length;
    await s.req('POST', '/auth/v1/session', t);
    assert.equal(s.api.calls.length, before, 'no new-api call within the cache time');
    s.api.tokens[0].status = 2;
    clock.t = CACHE_MS + 1;
    assert.equal((await s.req('POST', '/auth/v1/session', t)).status, 403);
    assert.ok(!s.api.calls.slice(before).includes('POST /api/token/1/key'), 'the key is not read again');
  } finally {
    s.close();
  }
});

test('two logins at once create one token', async () => {
  const s = await server();
  try {
    const t = await idToken({ sub: 'twice' });
    const [a, b] = await Promise.all([s.req('POST', '/auth/v1/session', t), s.req('POST', '/auth/v1/session', t)]);
    assert.equal((await a.json()).apiKey, (await b.json()).apiKey);
    assert.equal(s.api.tokens.length, 1);
  } finally {
    s.close();
  }
});

test('a disabled account gets 403; a bad token 401; deleting the account revokes the key', async () => {
  const clock = { t: 0 };
  const s = await server(fakeNewApi(), clock);
  try {
    const t = await idToken({ sub: 'gone' });
    await s.req('POST', '/auth/v1/session', t);
    s.api.tokens[0].status = 2;
    clock.t = CACHE_MS + 1;
    const r = await s.req('POST', '/auth/v1/session', t);
    assert.equal(r.status, 403);
    assert.deepEqual(await r.json(), { error: 'disabled' });

    assert.equal((await s.req('POST', '/auth/v1/session', 'garbage')).status, 401);
    assert.equal((await s.req('POST', '/auth/v1/session')).status, 401);

    assert.equal((await s.req('DELETE', '/auth/v1/account', t)).status, 204);
    assert.equal(s.api.tokens.length, 0);
  } finally {
    s.close();
  }
});

test('rate limit per client, health, unknown routes, and no secrets in logs', async () => {
  const s = await server();
  try {
    const t = await idToken({ sub: 'busy' });
    let last;
    for (let i = 0; i < 21; i++) last = await s.req('POST', '/auth/v1/session', t, '9.9.9.9');
    assert.equal(last.status, 429);
    assert.equal((await s.req('POST', '/auth/v1/session', t, '8.8.8.8')).status, 200);
    assert.equal((await s.req('GET', '/auth/healthz')).status, 200);
    assert.equal((await s.req('GET', '/auth/v1/session')).status, 404);
    const all = s.logs.join('\n');
    assert.ok(!all.includes('secret') && !all.includes(t));
  } finally {
    s.close();
  }
});

test('new-api down → 502, logged without secrets', async () => {
  const api = fakeNewApi();
  api.fetch = async () => ({ ok: false, status: 500 });
  const s = await server(api);
  try {
    assert.equal((await s.req('POST', '/auth/v1/session', await idToken())).status, 502);
    assert.match(s.logs.join('\n'), /new-api error: new-api GET \/api\/token\/search: HTTP 500/);
  } finally {
    s.close();
  }
});
