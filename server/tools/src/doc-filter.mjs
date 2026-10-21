// What may enter the lab's text base, fragment by fragment (decision
// 2026-10-21): a document is never refused as a whole. In each fragment the
// identifiers of a person are covered ([PATENTE], [VIN]…), and a fragment is
// dropped if it carries prices (they change every day: the live tools answer
// those), a licence footer, or — with the optional classifier — personal data.
// What happened goes to the log only, never to the user.

const LICENCE = /\b(?:licensed to\b|single[- ]user licen[cs]e|copying and networking prohibited|ISO Store order)/i;

const CURRENCY_AMOUNT = /(?:[$€£]\s?\d[\d.,]{2,}|\bUS\$\s?\d|\bU\$S\s?\d|\b(?:USD|ARS|EUR)\s?\d[\d.,]*|\d[\d.,]*\s?(?:USD|ARS|EUR|pesos|d[oó]lares)\b)/i;
const PRICE_WORDS = /\b(?:precio|precios|cotizaci[oó]n|d[oó]lar|oferta|ofertas|descuento|comprar|cuotas|financiaci[oó]n|price|prices|pricing|discount|buy now|add to cart)\b/gi;

const luhn = (digits) => {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
};

// Ordered: a pattern that covers a longer number goes before one that could cut it.
const RULES = [
  ['EMAIL', /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[EMAIL]'],
  // CUIT/CUIL with hyphens is unmistakable; without them only after the word.
  ['CUIT', /\b(?:20|23|24|27|30|33|34)-\d{8}-\d\b/g, '[CUIT]'],
  ['CUIT', /(\b(?:CUIT|CUIL)\b\W{0,4})\d{11}\b/gi, '$1[CUIT]'],
  ['DNI', /(\b(?:DNI|D\.N\.I\.?|documento)\b\W{0,4})\d{1,2}[.\s]?\d{3}[.\s]?\d{3}\b/gi, '$1[DNI]'],
  ['VIN', /\b[A-HJ-NPR-Z0-9]{8}[0-9X][A-HJ-NPR-Z0-9]{2}[0-9]{6}\b/g, '[VIN]'],
  // The new plate (AB123CD) is distinctive. The old one (ABC123) also looks
  // like ELM327 or CAN500, so it is covered only after "patente/dominio".
  ['PATENTE', /\b[A-Z]{2}\d{3}[A-Z]{2}\b/g, '[PATENTE]'],
  ['PATENTE', /(\b(?:patente|dominio|matr[ií]cula)\b\W{0,6})(?:[A-Z]{2}\s?\d{3}\s?[A-Z]{2}|[A-Z]{3}\s?\d{3})\b/gi, '$1[PATENTE]'],
  ['TEL', /(?:\+54|\b0054)[\d\s().-]{8,16}\d/g, '[TEL]'],
  ['TEL', /(\b(?:tel|tel[eé]fono|cel|celular|whatsapp|m[oó]vil|contacto)\b\.?:?\s*)\+?\d[\d\s().-]{6,16}\d/gi, '$1[TEL]'],
  ['CBU', /\b\d{22}\b/g, '[CBU]'],
];

// A card number: 13–19 digits (spaces or hyphens between) that pass Luhn.
// Binary strings ("0000 0011 0000 0010") do not count.
function redactCards(text, counts) {
  return text.replace(/\b(?:\d[ -]?){12,18}\d\b/g, (m) => {
    const digits = m.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19 || /^[01]+$/.test(digits) || !luhn(digits)) return m;
    counts.TARJETA = (counts.TARJETA ?? 0) + 1;
    return '[TARJETA]';
  });
}

export function redact(text) {
  const counts = {};
  let out = String(text);
  for (const [kind, rx, to] of RULES) {
    out = out.replace(rx, (...m) => {
      counts[kind] = (counts[kind] ?? 0) + 1;
      return to.replace(/\$(\d)/g, (_, i) => m[Number(i)] ?? '');
    });
  }
  return { text: redactCards(out, counts), counts };
}

export function isVolatile(text) {
  return CURRENCY_AMOUNT.test(text) || (text.match(PRICE_WORDS)?.length ?? 0) >= 2;
}

// → { text, redactions } to keep, or { text: null, dropped } (and why).
export function filterFragment(text) {
  if (LICENCE.test(text)) return { text: null, dropped: 'licencia', redactions: {} };
  const { text: covered, counts } = redact(text);
  if (isVolatile(covered)) return { text: null, dropped: 'precios', redactions: counts };
  // Nothing left but covered identifiers (or a stray character): not worth keeping.
  if (covered.replace(/\[[A-Z]+\]/g, '').trim().length < 4) return { text: null, dropped: 'vacío', redactions: counts };
  return { text: covered, redactions: counts };
}

// A model that points out fragments with a person's data (name and surname,
// address, a customer's or owner's history, a private chat). One call per
// batch; the answer is read only for numbers, so a fragment cannot talk the
// classifier into anything but "this one is fine".
const CLASSIFY_BATCH = 10;
const CLASSIFY_PROMPT =
  'Sos un filtro de privacidad. Te paso fragmentos de un documento, numerados. Decime cuáles contienen datos personales de una ' +
  'persona concreta: nombre y apellido, domicilio, historial de un cliente o dueño de un auto, una conversación privada. ' +
  'El texto técnico (manuales, especificaciones, comandos, tablas, códigos) NO es personal. ' +
  'Respondé SOLO con JSON: {"personal":[números]} ({"personal":[]} si ninguno).';

export function llmClassifier({ url, key, model = 'qwen3.8-27b', fetchFn = fetch }) {
  async function batch(texts) {
    const res = await fetchFn(`${url.replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 200,
        chat_template_kwargs: { enable_thinking: false },
        messages: [
          { role: 'system', content: CLASSIFY_PROMPT },
          { role: 'user', content: texts.map((t, i) => `[${i + 1}] ${t}`).join('\n\n') },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`classifier HTTP ${res.status}`);
    const content = String((await res.json()).choices?.[0]?.message?.content ?? '');
    const m = /"personal"\s*:\s*\[([\d,\s]*)\]/.exec(content);
    if (!m) throw new Error('classifier: no answer');
    return new Set(
      m[1]
        .split(',')
        .map((n) => Number(n.trim()) - 1)
        .filter((i) => i >= 0 && i < texts.length),
    );
  }

  // → Set of the indexes (in `texts`) that are personal. Throws if a batch fails.
  return async function personalIn(texts) {
    const out = new Set();
    for (let i = 0; i < texts.length; i += CLASSIFY_BATCH) {
      for (const j of await batch(texts.slice(i, i + CLASSIFY_BATCH))) out.add(i + j);
    }
    return out;
  };
}
