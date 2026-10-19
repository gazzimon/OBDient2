// HTTP front of obdient-tools, behind Caddy at /tools (127.0.0.1 only).
//
//   POST /tools/v1/web_search   Authorization: Bearer <account's model key>
//        { "query": "taller mecánico Posadas" }
//        → 200 { results: [{ title, domain, snippet, addresses? }] }
//   GET  /tools/healthz          → 200
//
// Errors: 400 bad query, 401 bad key, 429 too many, 502 search or new-api down.
// Keys and queries are never logged (a query can say where someone is).

import { createServer } from 'node:http';
import { toToolResults } from './results.mjs';

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const MAX_BODY = 4_096;
const QUERY_MIN = 2;
const QUERY_MAX = 200;

export function createApp({ search, isValidKey, log = () => {}, now = () => Date.now() }) {
  const hits = new Map(); // key prefix → { start, count }

  function limited(who) {
    const t = now();
    const h = hits.get(who);
    if (!h || t - h.start > WINDOW_MS) {
      hits.set(who, { start: t, count: 1 });
      if (hits.size > 10_000) hits.clear();
      return false;
    }
    h.count++;
    return h.count > MAX_PER_WINDOW;
  }

  async function readJson(req) {
    let size = 0;
    const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BODY) return null;
      chunks.push(c);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return null;
    }
  }

  async function handle(req) {
    const url = new URL(req.url, 'http://local');
    if (req.method === 'GET' && url.pathname === '/tools/healthz') return [200, { ok: true }];
    if (!(req.method === 'POST' && url.pathname === '/tools/v1/web_search')) return [404, { error: 'not_found' }];

    const auth = String(req.headers.authorization ?? '');
    const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!key) return [401, { error: 'missing_key' }];
    if (limited(key.slice(0, 24))) return [429, { error: 'too_many_requests' }];
    let valid;
    try {
      valid = await isValidKey(key);
    } catch (err) {
      log(`new-api check failed: ${err.message}`);
      return [502, { error: 'upstream' }];
    }
    if (!valid) return [401, { error: 'invalid_key' }];

    const body = await readJson(req);
    const query = typeof body?.query === 'string' ? body.query.trim() : '';
    if (query.length < QUERY_MIN || query.length > QUERY_MAX) return [400, { error: 'bad_query' }];

    try {
      const started = now();
      const results = toToolResults(await search(query));
      log(`web_search ok: ${results.length} results in ${now() - started} ms`);
      return [200, { results }];
    } catch (err) {
      log(`search failed: ${err.message}`);
      return [502, { error: 'search_unavailable' }];
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
    res.end(JSON.stringify(body));
  };
}

export function listen(app, port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = createServer(app);
    server.listen(port, host, () => resolve(server));
  });
}
