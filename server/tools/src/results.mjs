// What the model gets from web_search (shops, addresses, prices): a few results
// as short, plain fields. A search engine's snippet, clipped, flattened and
// without markup; addresses and prices found in it come apart, so the app can
// look them up on the map. Page text for questions goes through research.mjs,
// marked as third-party by untrusted() below (ADR-0012).

import { randomBytes } from 'node:crypto';

export const MAX_RESULTS = 5;
const TITLE_CHARS = 90;
const SNIPPET_CHARS = 180;

// Text of a page (third party) for the model, in delimiters that say so
// (spotlighting, Hines et al. 2024): «a3f1»…«/a3f1». The mark is random on each
// answer, so a page cannot close it, and the guillemets inside the text are
// taken out. The system prompt says what is between them is data, never orders.
// The page's own brackets and braces stay: they are the commands and JSON.
export function untrusted(text, mark = randomBytes(2).toString('hex')) {
  return `«${mark}»${String(text).replace(/[«»]/g, '"')}«/${mark}»`;
}

// Plain text: no tags, no brackets or braces (no fake tool calls or markers),
// no control characters, one line.
export function plain(text, max) {
  const t = String(text ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u001f\u007f[\]{}<>`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// "Av F De Haro, 4083", "Dirección: Juan Ambrosetti 2263", "Florencio Sanchez 2243":
// a street name (capitalised words, maybe Av./Calle) and a door number.
const ADDRESS =
  /(?:\b(?:Av(?:da)?\.?|Avenida|Calle|Bv\.?|Boulevard|Ruta)\s+)?\b[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ']*(?:\s+(?:de|del|la|las|los|y|[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ']*)){0,4},?\s+(?:N[°º]\s*)?\d{2,5}\b/g;
// Words that look like a street but are not.
const NOT_STREET = /^(?:Tel|Teléfono|Telefono|Cel|Whatsapp|CP|Código|Codigo|Km|Ruta Nacional|Año|Ano|Modelo|Hace|Abierto|Lunes|Martes|Miércoles|Jueves|Viernes|Sábado|Domingo)\b/i;

export function extractAddresses(text) {
  const found = [];
  for (const m of String(text ?? '').matchAll(ADDRESS)) {
    const a = m[0].replace(/,\s+(\d)/, ' $1').replace(/\s+/g, ' ').trim();
    if (NOT_STREET.test(a) || /\b(?:19|20)\d{2}$/.test(a)) continue; // years, phones
    if (!found.includes(a)) found.push(a);
  }
  return found.slice(0, 3);
}

// "$ 12.500", "$12.500,50", "ARS 8.900": prices in a snippet (Mercado Libre and shops).
const PRICE = /(?:\$|ARS|AR\$)\s?\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|(?:\$|ARS|AR\$)\s?\d{3,7}(?:,\d{1,2})?/g;

export function extractPrices(text) {
  const found = [];
  for (const m of String(text ?? '').matchAll(PRICE)) {
    const p = m[0].replace(/^(?:ARS|AR\$)\s?/, '$ ').replace(/^\$(?=\d)/, '$ ');
    if (!found.includes(p)) found.push(p);
  }
  return found.slice(0, 3);
}

export function toToolResults(raw, max = MAX_RESULTS) {
  const seen = new Set();
  const results = [];
  for (const r of raw ?? []) {
    const domain = domainOf(r.url);
    if (!domain || seen.has(r.url)) continue;
    seen.add(r.url);
    const snippet = plain(r.content, SNIPPET_CHARS);
    const addresses = extractAddresses(r.content);
    const prices = extractPrices(`${r.title ?? ''} ${r.content ?? ''}`);
    results.push({
      title: plain(r.title, TITLE_CHARS),
      domain,
      snippet,
      ...(addresses.length ? { addresses } : {}),
      ...(prices.length ? { prices } : {}),
    });
    if (results.length >= max) break;
  }
  return results;
}
