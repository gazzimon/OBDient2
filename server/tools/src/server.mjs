// HTTP front of obdient-tools, behind Caddy at /tools (127.0.0.1 only).
// Every call: POST, Authorization: Bearer <account's model key>, JSON body.
//
//   /tools/v1/web_search  { query }                  → { results: [{ title, domain, snippet, addresses?, prices? }] }
//   /tools/v1/fuel        { lat, lng, product? }     → { nearest, cheapest, updated, source }
//   /tools/v1/dollar      {}                         → { rates, updated, source }
//   /tools/v1/weather     { lat, lng }               → { now, nextHours, maxRainChance, source }
//   /tools/v1/car_price   { query, year? }           → { results, month, unit, source }
//   /tools/v1/track       { device, points: [...] }  → { accepted }   (live position → Traccar, track.mjs)
//   /tools/v1/web_fetch   { url, focus? }             → { url, domain, weight, title, text }   (page with its structure, SSRF-guarded;
//                                                        with `focus`: { …, grade, passages, hint } the fragments of it that answer)
//   /tools/v1/research    { query, query_en? }        → { grade: good|weak|none, passages, read, also, hint }   (research.mjs)
//   /tools/v1/knowledge   { action:'lookup'|'report', ... } → lab-shared facts of what a car supports
//   /tools/v1/docs        { action:'search', query, k? } → { results: [{ text, source, title, page, fetchedAt, score }] }
//                         { action:'add', source, title?, text | pages:[{page,text}] } → { chunks }   (docs.mjs: filtered per fragment)
//                         { action:'list' } → { sources }   { action:'delete', source } → { removed }  (only what you added)
//   /tools/v1/forget      {}                         → { anonymized }   (account deletion: contributions stop naming the person)
//   GET /tools/healthz                             → 200
//
// Errors: 400 bad input, 401 bad key, 429 too many, 502 a source is down,
// 503 no data yet. Keys, queries and positions are never logged.

import { createServer } from 'node:http';
import { toToolResults, untrusted } from './results.mjs';
import { buildPassages, byCloseness, HINT, WEAK_SIM } from './research.mjs';
import { findCars } from './queries/cars.mjs';
import { FUEL_PRODUCTS, nearestStations } from './queries/fuel.mjs';
import { validPoint } from './queries/geo.mjs';
import { BadTrack, checkTrack } from './track.mjs';
import { BadFetch } from './fetch-page.mjs';

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
const MAX_BODY = 8_192;
const MAX_DOCS_BODY = 2_000_000; // a document's text
const MAX_DOC_PAGES = 500;

class BadInput extends Error {}

export function createApp({ search, isValidKey, data = () => null, weather = null, track = null, fetchPage = null, knowledge = null, docs = null, research = null, ownerOf = () => null, log = () => {}, now = () => Date.now() }) {
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
    async web_fetch(b) {
      if (!fetchPage) throw Object.assign(new Error('no fetch'), { status: 503 });
      const url = typeof b.url === 'string' ? b.url.trim() : '';
      if (!url) throw new BadInput('bad_url');
      let page;
      try {
        page = await fetchPage(url);
      } catch (err) {
        if (err instanceof BadFetch) throw new BadInput(err.message);
        throw Object.assign(new Error('fetch failed'), { status: 502 });
      }
      // What was read stays in the lab's text base (a page, 30 days).
      const { full, text, pages, ...meta } = page; // a PDF's pages go to the base, not back to the phone
      const focus = typeof b.focus === 'string' ? b.focus.trim().slice(0, 200) : '';
      const stored = docs && full ? docs.ingest({ source: page.url, title: page.title ?? page.domain, text: full, pages: pages ?? null, kind: 'web', addedBy: 'web_fetch', structured: true }) : null;
      // With a focus ("what to look for in it") the answer is the fragments of the
      // page that speak of that, not its first lines: a long page's answer is rarely
      // at the top. It waits for the page to be indexed to rank them.
      if (focus.length >= 2 && stored) {
        try {
          await stored;
          const candidates = (await docs.search(focus, 8, { sources: [page.url] })).filter((h) => (h.sim ?? 0) >= WEAK_SIM || h.lex >= 0.4);
          const { grade, hits } = research ? await research.assess(focus, candidates) : byCloseness(candidates);
          return { ...meta, focus, grade, passages: buildPassages(hits, grade), hint: HINT[grade] };
        } catch (err) {
          log(`web_fetch focus failed (${err.message}): the start of the page instead`);
        }
      } else {
        // Without a focus the answer does not wait for the embeddings.
        stored?.catch((err) => log(`docs ingest failed: ${err.message}`));
      }
      return { ...meta, text: untrusted(text) };
    },
    async research(b) {
      if (!research) throw Object.assign(new Error('no research'), { status: 503 });
      const text = (v, lo, hi) => (typeof v === 'string' && v.trim().length >= lo && v.trim().length <= hi ? v.trim() : null);
      const query = text(b.query, 2, 200);
      if (!query) throw new BadInput('bad_query');
      if (b.query_en != null && !text(b.query_en, 2, 200)) throw new BadInput('bad_query_en');
      try {
        return await research.run({ query, queryEn: b.query_en != null ? text(b.query_en, 2, 200) : null });
      } catch (err) {
        log(`research failed: ${err.message}`);
        throw Object.assign(new Error('research failed'), { status: 502 });
      }
    },
    async docs(b, key) {
      if (!docs) throw Object.assign(new Error('no docs'), { status: 503 });
      const who = ownerOf(key);
      const str = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
      switch (b.action) {
        case 'search': {
          const query = str(b.query, 200);
          if (!query || query.length < 2) throw new BadInput('bad_query');
          return { results: await docs.search(query, b.k) };
        }
        case 'add': {
          const name = str(b.source, 200);
          if (!name) throw new BadInput('bad_source');
          let pages = null;
          if (b.pages !== undefined) {
            if (!Array.isArray(b.pages) || b.pages.length === 0 || b.pages.length > MAX_DOC_PAGES) throw new BadInput('bad_pages');
            pages = b.pages.map((p) => ({ page: Number.isInteger(p?.page) ? p.page : null, text: typeof p?.text === 'string' ? p.text : '' }));
          } else if (typeof b.text !== 'string' || !b.text.trim()) {
            throw new BadInput('bad_text');
          }
          const source = `doc:${name}`;
          const owner = docs.store.addedByOf(source);
          if (owner && owner !== (who ?? 'desconocido')) throw new BadInput('source_taken');
          return docs.ingest({ source, title: str(b.title, 200) ?? name, text: pages ? null : b.text, pages, kind: 'ref', addedBy: who ?? 'desconocido', classifyPersonal: true });
        }
        case 'list':
          return { sources: docs.store.list() };
        case 'delete': {
          const name = str(b.source, 200);
          if (!name || !who) throw new BadInput('bad_request');
          return { removed: docs.store.remove(`doc:${name}`, who) };
        }
        default:
          throw new BadInput('bad_action');
      }
    },
    // Account deletion, step 1 (the app calls it with the key BEFORE obdient-auth revokes it):
    // the person's contributions to the shared base stop naming them.
    async forget(_b, key) {
      const who = ownerOf(key);
      return { anonymized: docs && who ? docs.store.anonymize(who) : 0 };
    },
    async knowledge(b) {
      if (!knowledge) throw Object.assign(new Error('no knowledge'), { status: 503 });
      try {
        if (b.action === 'report') return knowledge.report(b);
        return knowledge.lookup(b ?? {});
      } catch (err) {
        throw new BadInput(err.message === 'bad_vehicle' ? 'bad_vehicle' : 'bad_request');
      }
    },
    async track(b, key) {
      if (!track) throw Object.assign(new Error('no tracking'), { status: 503 });
      let queries;
      try {
        queries = checkTrack(b, now(), ownerOf(key));
      } catch (err) {
        if (err instanceof BadTrack) throw new BadInput(err.message);
        throw err;
      }
      for (const q of queries) await track(q);
      return { accepted: queries.length };
    },
  };

  async function readJson(req, max = MAX_BODY) {
    let size = 0;
    const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > max) return null;
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

    const body = await readJson(req, name === 'docs' ? MAX_DOCS_BODY : MAX_BODY);
    if (!body) return [400, { error: 'bad_body' }];
    const started = now();
    try {
      const result = await route(body, key);
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
