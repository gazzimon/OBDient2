// HTTP front of obdient-tools, behind Caddy at /tools (127.0.0.1 only).
// Every call: POST, Authorization: Bearer <account's model key>, JSON body.
//
//   /tools/v1/web_search  { query }                  → { results: [{ title, domain, snippet, addresses?, prices? }] }
//   /tools/v1/fuel        { lat, lng, product? }     → { nearest, cheapest, updated, source }
//   /tools/v1/dollar      {}                         → { rates, updated, source }
//   /tools/v1/weather     { lat, lng }               → { now, nextHours, maxRainChance, source }
//   /tools/v1/car_price   { query, year? }           → { results, month, unit, source }
//   /tools/v1/track       { device, points: [...] }  → { accepted }   (live position → Traccar, track.mjs)
//   GET /tools/healthz                               → 200
//
// Errors: 400 bad input, 401 bad key, 429 too many, 502 a source is down,
// 503 no data yet. Keys, queries and positions are never logged.

import { createServer } from 'node:http';
import { toToolResults } from './results.mjs';
import { findCars } from './queries/cars.mjs';
import { FUEL_PRODUCTS, nearestStations } from './queries/fuel.mjs';
import { validPoint } from './queries/geo.mjs';
import { BadTrack, checkTrack } from './track.mjs';

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
const MAX_BODY = 8_192;

class BadInput extends Error {}

export function createApp({ search, isValidKey, data = () => null, weather = null, track = null, log = () => {}, now = () => Date.now() }) {
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

  const point = (b) => {
    const p = { lat: Number(b.lat), lng: Number(b.lng) };
    if (!validPoint(p)) throw new BadInput('bad_position');
    return p;
  };
  const needData = (name) => {
    const d = data(name);
    if (!d) throw Object.assign(new Error(`no ${name} data`), { status: 503 });
    return d;
  };

  const routes = {
    async web_search(b) {
      const query = typeof b.query === 'string' ? b.query.trim() : '';
      if (query.length < 2 || query.length > 200) throw new BadInput('bad_query');
      return { results: toToolResults(await search(query)) };
    },
    async fuel(b) {
      const product = b.product ?? null;
      if (product !== null && !FUEL_PRODUCTS.includes(product)) throw new BadInput('bad_product');
      return nearestStations(needData('fuel'), point(b), product, now());
    },
    async dollar() {
      const d = needData('dollar');
      return { rates: d.rates, updated: d.updated, source: d.source };
    },
    async weather(b) {
      if (!weather) throw Object.assign(new Error('no weather'), { status: 503 });
      return weather(point(b));
    },
    async car_price(b) {
      const query = typeof b.query === 'string' ? b.query.trim() : '';
      if (query.length < 2 || query.length > 100) throw new BadInput('bad_query');
      const year = b.year == null ? null : String(b.year);
      if (year !== null && !/^(19|20)\d\d$/.test(year)) throw new BadInput('bad_year');
      return findCars(needData('cars'), query, year);
    },
    async track(b) {
      if (!track) throw Object.assign(new Error('no tracking'), { status: 503 });
      let queries;
      try {
        queries = checkTrack(b, now());
      } catch (err) {
        if (err instanceof BadTrack) throw new BadInput(err.message);
        throw err;
      }
      for (const q of queries) await track(q);
      return { accepted: queries.length };
    },
  };

  async function readJson(req) {
    let size = 0;
    const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BODY) return null;
      chunks.push(c);
    }
    try {
      const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  }

  async function handle(req) {
    const url = new URL(req.url, 'http://local');
    if (req.method === 'GET' && url.pathname === '/tools/healthz') return [200, { ok: true }];
    const name = /^\/tools\/v1\/([a-z_]+)$/.exec(url.pathname)?.[1];
    const route = name && Object.hasOwn(routes, name) ? routes[name] : null;
    if (req.method !== 'POST' || !route) return [404, { error: 'not_found' }];

    const auth = String(req.headers.authorization ?? '');
    const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!key) return [401, { error: 'missing_key' }];
    // Positions every few seconds have their own allowance, apart from the chat's tools.
    if (limited(`${name === 'track' ? 'track:' : ''}${key.slice(0, 24)}`)) return [429, { error: 'too_many_requests' }];
    let valid;
    try {
      valid = await isValidKey(key);
    } catch (err) {
      log(`new-api check failed: ${err.message}`);
      return [502, { error: 'upstream' }];
    }
    if (!valid) return [401, { error: 'invalid_key' }];

    const body = await readJson(req);
    if (!body) return [400, { error: 'bad_body' }];
    const started = now();
    try {
      const result = await route(body);
      if (name !== 'track') log(`${name} ok in ${now() - started} ms`);
      return [200, result];
    } catch (err) {
      if (err instanceof BadInput) return [400, { error: err.message }];
      log(`${name} failed: ${err.message}`);
      return [err.status ?? 502, { error: err.status === 503 ? 'no_data' : 'source_unavailable' }];
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
