// Fuel prices at the pump (Secretaría de Energía, Res. 314/2016, open data):
// the daily CSV becomes one entry per station with its prices.
//
// Since the 2025 deregulation many stations stopped reporting (2026-10-19:
// 4,613 stations, 823 with a price from the last 30 days). So every station
// seen in the last two years is kept as a place ("la más cercana"), and a
// price only while it is recent, always with its date.

import { parseCsv } from '../csv.mjs';

export const FUEL_CSV_URL =
  'http://datos.energia.gob.ar/dataset/1c181390-5045-475e-94dc-410429be4b17/resource/80ac25de-a44a-4445-9215-090cf55cfda5/download/precios-en-surtidor-resolucin-3142016.csv';

// The dataset's product names → the tool's.
export const PRODUCTS = {
  'Nafta (súper) entre 92 y 95 Ron': 'nafta',
  'Nafta (premium) de más de 95 Ron': 'nafta_premium',
  'Gas Oil Grado 2': 'gasoil',
  'Gas Oil Grado 3': 'gasoil_premium',
  GNC: 'gnc',
};

// A station not heard of in this long is gone; a price this old is not a price.
const STATION_DAYS = 730;
const PRICE_DAYS = 90;

export function stationsFromCsv(text, now = Date.now()) {
  const byStation = new Map();
  for (const r of parseCsv(text)) {
    const product = PRODUCTS[r.producto];
    const lat = Number(r.latitud);
    const lng = Number(r.longitud);
    const price = Number(r.precio);
    if (!product || r.tipohorario !== 'Diurno' || !Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || !(price > 0)) continue;
    const at = Date.parse(r.fecha_vigencia.replace(' ', 'T') + '-03:00');
    if (!Number.isFinite(at) || now - at > STATION_DAYS * 86_400_000) continue;
    const key = `${r.idempresa}:${lat.toFixed(5)},${lng.toFixed(5)}`;
    let s = byStation.get(key);
    if (!s) {
      s = {
        brand: brandName(r.empresabandera),
        company: titleCase(r.empresa),
        address: r.direccion.trim(),
        town: titleCase(r.localidad),
        province: titleCase(r.provincia),
        lat,
        lng,
        prices: {},
      };
      byStation.set(key, s);
    }
    if (now - at > PRICE_DAYS * 86_400_000) continue;
    const prev = s.prices[product];
    if (!prev || prev.at < at) s.prices[product] = { price, at };
  }
  return [...byStation.values()];
}

// Short brands are acronyms (YPF, ACA); the rest, title case (Shell C.A.P.S.A. → Shell C.a.p.s.a. is fine).
function brandName(s) {
  const t = String(s ?? '').trim();
  return t.length <= 4 ? t.toUpperCase() : titleCase(t);
}

function titleCase(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/(^|[\s(./-])([a-záéíóúñ])/g, (_, a, b) => a + b.toUpperCase());
}
