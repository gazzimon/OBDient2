// What the model gets from a web search: a few results as short, plain
// fields, never the pages themselves (defence against prompt injection,
// docs/plans/voz-y-lugares.md §3). A search engine's snippet is the only page
// text that passes, clipped, flattened and without markup. Addresses found in
// it come apart, so the app can look them up on the map.

export const MAX_RESULTS = 5;
const TITLE_CHARS = 90;
const SNIPPET_CHARS = 180;

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

export function toToolResults(raw, max = MAX_RESULTS) {
  const seen = new Set();
  const results = [];
  for (const r of raw ?? []) {
    const domain = domainOf(r.url);
    if (!domain || seen.has(r.url)) continue;
    seen.add(r.url);
    const snippet = plain(r.content, SNIPPET_CHARS);
    const addresses = extractAddresses(r.content);
    results.push({
      title: plain(r.title, TITLE_CHARS),
      domain,
      snippet,
      ...(addresses.length ? { addresses } : {}),
    });
    if (results.length >= max) break;
  }
  return results;
}
