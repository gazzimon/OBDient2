// Used and new car prices: the monthly list of the Cámara del Comercio
// Automotor (CCA, cca.org.ar/lista-de-precios, public PDF). Values are in
// thousands of pesos, for cars in very good condition, by model year (0 km
// and the last ~15 years).
//
// Read from `pdftotext -tsv` (each word with its position): the text layout
// does not keep the year columns aligned across pages, the coordinates do.
// A price is right-aligned under its year.

export const CCA_PDF_URL = 'https://www.cca.org.ar/descargas/precios/Autos.pdf';

const ROW_TOLERANCE = 2; // points: words of one row
// Points between a price's right edge and its year's: wide prices overhang
// (0 km "111,660" ends 15 pt right of "Km"). Capped by half the gap between
// the closest columns of the page.
const COLUMN_TOLERANCE = 18;
// A version without prices this month ("4P 1,4 TDCI MAX AMBIENTE ONE"), not a name.
const LOOKS_LIKE_VERSION = /^(?:\d[PD]\b|[CD]\/[CS]\b|CHASIS\b|FURGON\b)|\d,\d/;
const MONTHS = /(Enero|Febrero|Marzo|Abril|Mayo|Junio|Julio|Agosto|Septiembre|Setiembre|Octubre|Noviembre|Diciembre)\s+(\d{4})/;

export function carsFromTsv(tsv) {
  const pages = new Map(); // page → words
  for (const line of tsv.split('\n').slice(1)) {
    const f = line.split('\t');
    if (f[0] !== '5' || !f[11] || f[11].startsWith('###')) continue;
    const w = { page: Number(f[1]), left: Number(f[6]), top: Number(f[7]), right: Number(f[6]) + Number(f[8]), text: f[11] };
    if (!pages.has(w.page)) pages.set(w.page, []);
    pages.get(w.page).push(w);
  }

  const cars = [];
  let month = null;
  let brand = null;
  let model = null;
  let pendingName = null;

  for (const page of [...pages.keys()].sort((a, b) => a - b)) {
    const rows = toRows(pages.get(page));
    const headerAt = rows.findIndex((r) => r.some((w) => w.text === 'Km') && r.some((w) => /^20\d\d$/.test(w.text)));
    if (headerAt < 0) continue;
    const columns = rows[headerAt]
      .filter((w) => w.text === 'Km' || /^(19|20)\d\d$/.test(w.text))
      .map((w) => ({ label: w.text === 'Km' ? '0km' : w.text, right: w.right }));
    // Names end well before the first column; a wide 0 km price can start left of its header.
    const firstRight = Math.min(...columns.map((c) => c.right));
    const rights = columns.map((c) => c.right).sort((a, b) => a - b);
    const gap = Math.min(...rights.slice(1).map((r, i) => r - rights[i]));
    const tolerance = Math.min(COLUMN_TOLERANCE, gap / 2 - 0.5);
    for (const r of rows.slice(0, headerAt)) {
      const m = MONTHS.exec(r.map((w) => w.text).join(' '));
      if (m && !month) month = `${m[1]} ${m[2]}`;
    }

    for (const row of rows.slice(headerAt + 1)) {
      const isPrice = (w) => /^\d[\d,]*$/.test(w.text) && w.right > firstRight - 40 && nearest(columns, w.right, tolerance) != null;
      const priceWords = row.filter(isPrice);
      const nameWords = row.filter((w) => !isPrice(w));
      const name = nameWords.map((w) => w.text).join(' ').trim();
      if (!name || /Visite|Autos - Pick Ups|nuestrosautos/.test(name)) continue;

      if (priceWords.length === 0) {
        if (LOOKS_LIKE_VERSION.test(name)) continue; // a version with no prices
        if (pendingName) {
          brand = pendingName;
          model = name;
          pendingName = null;
        } else pendingName = name;
        continue;
      }
      if (pendingName) {
        model = pendingName;
        pendingName = null;
      }
      if (!brand || !model) continue;
      const prices = {};
      for (const p of priceWords) {
        const col = nearest(columns, p.right, tolerance);
        if (col) prices[col.label] = toNumber(p.text);
      }
      if (Object.keys(prices).length) cars.push({ brand, model, version: name, prices });
    }
  }
  return { month, cars };
}

function toRows(words) {
  const sorted = [...words].sort((a, b) => a.top - b.top || a.left - b.left);
  const rows = [];
  for (const w of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].top - w.top) <= ROW_TOLERANCE) row.push(w);
    else rows.push([w]);
  }
  return rows.map((r) => r.sort((a, b) => a.left - b.left));
}

// "111,660" = 111660; "41254,9" = 41254.9.
function toNumber(s) {
  return /,\d{3}$/.test(s) ? Number(s.replace(/,/g, '')) : Number(s.replace(',', '.'));
}

function nearest(columns, right, tolerance) {
  let best = null;
  for (const c of columns) if (!best || Math.abs(c.right - right) < Math.abs(best.right - right)) best = c;
  return best && Math.abs(best.right - right) <= tolerance ? best : null;
}
