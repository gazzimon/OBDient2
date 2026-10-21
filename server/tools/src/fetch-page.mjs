// web_fetch: reads the full readable text of a public page (decision
// 2026-10-20), so the assistant is not blind to pages search only summarised —
// this is how proprietary PIDs/DIDs come from GitHub, forums and OBDLink docs.
//
// SSRF guard: obdient-tools runs on the K16 next to private services (new-api,
// Traccar, SearXNG). Only http/https public hosts are allowed; private and
// local ranges are refused, the DNS is resolved and the resolved IP checked on
// every redirect hop (DNS rebinding), with a size and time cap.

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { plain } from './results.mjs';

const MAX_BYTES = 2_000_000;
const MAX_TEXT = 12_000;
const MAX_FULL = 60_000;
const MAX_REDIRECTS = 4;
const TIMEOUT_MS = 12_000;

export class BadFetch extends Error {}

// Trusted sources weigh more; spam weighs less (the model still decides).
const TRUSTED = /(^|\.)(github\.com|githubusercontent\.com|gitlab\.com|forscan\.org|obdlink\.com|scantool\.net|readthedocs\.io|stackoverflow\.com|wikipedia\.org|iso\.org|sae\.org|nhtsa\.gov|autosar\.org)$/i;

export function domainWeight(hostname) {
  const h = String(hostname ?? '').toLowerCase();
  if (TRUSTED.test(h)) return 2;
  if (/(^|\.)(forum|forums|wiki|docs)\./.test(h)) return 1.5;
  return 1;
}

// A private, loopback, link-local or otherwise non-public address.
export function isPrivateAddress(ip) {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  if (v === 6) {
    const l = ip.toLowerCase();
    return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80') || l.startsWith('::ffff:');
  }
  return true; // not an IP literal
}

// A URL safe to fetch: public http(s) host whose DNS resolves to a public IP.
export async function assertPublicUrl(raw, resolve = lookup) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new BadFetch('url inválida');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new BadFetch('solo http/https');
  if (!u.hostname || u.hostname.endsWith('.local') || u.hostname === 'localhost') throw new BadFetch('host no público');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new BadFetch('dirección privada');
  } else {
    const addrs = await resolve(host, { all: true }).catch(() => []);
    if (addrs.length === 0) throw new BadFetch('no se pudo resolver el host');
    if (addrs.some((a) => isPrivateAddress(a.address))) throw new BadFetch('el host resuelve a una dirección privada');
  }
  return u;
}

// Main text of the page: drop scripts, styles, nav and markup; collapse.
export function readable(html, max = MAX_TEXT) {
  const body = String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|head|nav|footer|header|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|br|section|article)>/gi, '\n');
  return plain(body, max);
}

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };

// The whole readable text for the lab's text base: like readable() but the
// paragraphs stay (the chunker cuts on them), entities are decoded and the cap
// is much higher. Never sent to the model as is: it goes through the filter first.
export function readableFull(html, max = MAX_FULL) {
  const text = String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|head|nav|footer|header|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|pre|table)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (e) => ENTITIES[e])
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.slice(0, max);
}

export function makeFetchPage({ fetchFn = fetch, resolve = lookup } = {}) {
  return async function fetchPage(rawUrl) {
    await assertPublicUrl(rawUrl, resolve);
    let url = rawUrl;
    let res;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      res = await fetchFn(url, {
        redirect: 'manual',
        headers: { 'User-Agent': 'OBDient/1.0 (+lab)', Accept: 'text/html,text/plain' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = new URL(res.headers.get('location'), url).href;
        await assertPublicUrl(url, resolve); // re-check every hop (rebinding)
        continue;
      }
      break;
    }
    if (!res.ok) throw new BadFetch(`el sitio respondió HTTP ${res.status}`);
    const type = res.headers.get('content-type') ?? '';
    if (!/text\/html|text\/plain|application\/(json|xml)/.test(type)) throw new BadFetch('la página no es texto');
    const buf = Buffer.from(await res.arrayBuffer()).subarray(0, MAX_BYTES);
    const host = new URL(url).hostname.replace(/^www\./, '');
    const html = buf.toString('utf8');
    return { url, domain: host, weight: domainWeight(host), text: readable(html), full: readableFull(html) };
  };
}
