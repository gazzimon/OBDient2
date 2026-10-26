// web_fetch: reads the full readable text of a public page (decision
// 2026-10-20), so the assistant is not blind to pages search only summarised —
// this is how proprietary PIDs/DIDs come from GitHub, forums and OBDLink docs.
//
// SSRF guard: obdient-tools runs on the K16 next to private services (new-api,
// Traccar, SearXNG). Only http/https public hosts are allowed; private and
// local ranges are refused, the DNS is resolved and the resolved IP checked on
// every redirect hop (DNS rebinding), with a size and time cap.

import { spawn } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { pageStructure, plainStructure } from './page-text.mjs';
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

// A GitHub file page is HTML around the file; the file itself is what matters
// (a README, a .dbc, a source): github.com/o/r/blob/ref/path → raw.githubusercontent.com.
export function rawGithub(rawUrl) {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+?)(?:[?#].*)?$/.exec(String(rawUrl));
  return m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}` : rawUrl;
}

export function makeFetchPage({ fetchFn = fetch, resolve = lookup, readPdf = popplerReader, pdfMaxBytes = PDF_MAX_BYTES } = {}) {
  return async function fetchPage(requested) {
    const rawUrl = rawGithub(requested);
    await assertPublicUrl(rawUrl, resolve);
    let url = rawUrl;
    let res;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      res = await fetchFn(url, {
        redirect: 'manual',
        headers: { 'User-Agent': 'OBDient/1.0 (+lab)', Accept: 'text/html,text/plain,application/pdf' },
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
    const host = new URL(url).hostname.replace(/^www\./, '');
    const name = decodeURIComponent(url.split(/[?#]/)[0].split('/').pop() || host);
    const firstPart = (t) => (t.length > MAX_TEXT ? t.slice(0, t.lastIndexOf('\n\n', MAX_TEXT) > MAX_TEXT / 2 ? t.lastIndexOf('\n\n', MAX_TEXT) : MAX_TEXT) : t);

    // A PDF (datasheets and programming manuals: where commands and DIDs are),
    // through poppler's pdftotext, one entry per page so a fragment can cite it.
    if (/application\/pdf/.test(type) || (/octet-stream/.test(type) && /\.pdf$/i.test(name))) {
      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > pdfMaxBytes) throw new BadFetch('el PDF es demasiado grande');
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > pdfMaxBytes) throw new BadFetch('el PDF es demasiado grande');
      const { title, pages } = await pdfPages(buf, name, readPdf);
      if (!pages.length) throw new BadFetch('el PDF no tiene texto (puede ser una imagen escaneada)');
      const full = pages.map((p) => p.text).join('\n\n');
      return { url: requested, domain: host, weight: domainWeight(host), title, text: firstPart(full), full, pages };
    }

    if (!/text\/html|text\/plain|text\/markdown|application\/(json|xml)/.test(type)) throw new BadFetch('la página no es texto');
    const buf = Buffer.from(await res.arrayBuffer()).subarray(0, MAX_BYTES);
    const body = buf.toString('utf8');
    // HTML keeps its structure (headings, code, tables, lists); a file is already text.
    const page = /text\/html/.test(type) ? pageStructure(body) : plainStructure(body, name);
    return {
      // What the caller asked for, so the source it cites is the page it knows.
      url: requested,
      domain: host,
      weight: domainWeight(host),
      title: page.title,
      // The first part, for web_fetch without a focus.
      text: firstPart(page.text),
      // The whole, for the text base.
      full: page.text,
    };
  };
}

// ── PDF ──────────────────────────────────────────────────────────────────────

const PDF_MAX_BYTES = 20_000_000;
const PDF_MAX_CHARS = 300_000;
const PDF_TIMEOUT_MS = 30_000;

// Runs a poppler tool with the PDF on stdin; resolves its stdout.
export function popplerRun(cmd, args, input, timeoutMs = PDF_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'ignore'] });
    const out = [];
    let size = 0;
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (c) => {
      size += c.length;
      if (size > PDF_MAX_CHARS * 4) child.kill('SIGKILL');
      else out.push(c);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 || out.length) resolve(Buffer.concat(out).toString('utf8'));
      else reject(new Error(`${cmd} exited ${code}`));
    });
    child.stdin.on('error', () => {}); // a PDF poppler stopped reading
    child.stdin.end(input);
  });
}

// The default reader: pdftotext for the text (pages split by form feed), pdfinfo for the title.
const popplerReader = {
  text: (buf) => popplerRun('pdftotext', ['-q', '-enc', 'UTF-8', '-', '-'], buf),
  info: (buf) => popplerRun('pdfinfo', ['-'], buf).catch(() => ''),
};

export async function pdfPages(buf, name, reader = popplerReader) {
  const [text, info] = await Promise.all([reader.text(buf), reader.info(buf)]);
  const title = /^Title:\s*(.+)$/m.exec(info)?.[1]?.trim() || name;
  let total = 0;
  const pages = [];
  text.split('\f').forEach((raw, i) => {
    if (total >= PDF_MAX_CHARS) return;
    const t = plainStructure(raw).text;
    if (!t.trim()) return;
    total += t.length;
    pages.push({ page: i + 1, text: t });
  });
  return { title: title.slice(0, 160), pages };
}
