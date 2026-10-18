// HTTP front of the service, behind Caddy at /auth (127.0.0.1 only).
//
//   POST   /auth/v1/session   Authorization: Bearer <Firebase ID token>
//          → 200 { apiKey, model, baseUrl }    the account's model key
//   DELETE /auth/v1/account   same header      → 204, the key is revoked
//   GET    /auth/healthz                        → 200
//
// Errors: 401 bad ID token, 403 { error: disabled|expired|exhausted },
// 429 too many requests, 502 new-api failed. Tokens are never logged.

import { createServer } from 'node:http';
import { InvalidIdToken } from './firebase.mjs';
import { AccountUnavailable } from './newapi.mjs';

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;

export function createApp({ verify, accounts, model, publicBaseUrl, log = () => {}, now = () => Date.now() }) {
  const hits = new Map(); // ip → { start, count }

  function limited(ip) {
    const t = now();
    const h = hits.get(ip);
    if (!h || t - h.start > WINDOW_MS) {
      hits.set(ip, { start: t, count: 1 });
      if (hits.size > 10_000) hits.clear(); // bounded memory under a flood
      return false;
    }
    h.count++;
    return h.count > MAX_PER_WINDOW;
  }

  async function handle(req) {
    const url = new URL(req.url, 'http://local');
    if (req.method === 'GET' && url.pathname === '/auth/healthz') return [200, { ok: true }];

    const route = `${req.method} ${url.pathname}`;
    if (route !== 'POST /auth/v1/session' && route !== 'DELETE /auth/v1/account') return [404, { error: 'not_found' }];

    // Caddy sets X-Forwarded-For; the socket is always 127.0.0.1 behind it.
    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
    if (limited(ip)) return [429, { error: 'too_many_requests' }];

    const auth = String(req.headers.authorization ?? '');
    const idToken = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!idToken) return [401, { error: 'missing_token' }];

    let account;
    try {
      account = await verify(idToken);
    } catch (err) {
      if (err instanceof InvalidIdToken) return [401, { error: 'invalid_token' }];
      throw err;
    }

    try {
      if (route === 'DELETE /auth/v1/account') {
        await accounts.remove(account.uid);
        log(`account removed (${account.provider ?? '?'})`);
        return [204, null];
      }
      const apiKey = await accounts.tokenFor(account.uid);
      return [200, { apiKey, model, baseUrl: publicBaseUrl }];
    } catch (err) {
      if (err instanceof AccountUnavailable) return [403, { error: err.reason }];
      log(`new-api error: ${err.message}`);
      return [502, { error: 'upstream' }];
    }
  }

  return async (req, res) => {
    let status = 500;
    let body = { error: 'internal' };
    try {
      [status, body] = await handle(req);
    } catch (err) {
      log(`internal error: ${err.message}`);
    }
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(body == null ? '' : JSON.stringify(body));
  };
}

export function listen(app, port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = createServer(app);
    server.listen(port, host, () => resolve(server));
  });
}
