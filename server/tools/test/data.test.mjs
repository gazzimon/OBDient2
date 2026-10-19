import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/csv.mjs';
import { stationsFromCsv } from '../src/jobs/fuel.mjs';
import { ratesFromApi } from '../src/jobs/dollar.mjs';
import { carsFromTsv } from '../src/jobs/cars.mjs';
import { nearestStations } from '../src/queries/fuel.mjs';
import { findCars } from '../src/queries/cars.mjs';
import { weatherFromApi } from '../src/queries/weather.mjs';
import { extractPrices } from '../src/results.mjs';
import { createApp, listen } from '../src/server.mjs';

const NOW = Date.parse('2026-10-19T12:00:00-03:00');
const HEAD = 'indice_tiempo,idempresa,cuit,empresa,direccion,localidad,provincia,region,idproducto,producto,idtipohorario,tipohorario,precio,fecha_vigencia,idempresabandera,empresabandera,latitud,longitud,geojson';
const row = (id, product, horario, price, date, brand, lat, lng) =>
  `2026-10,${id},30-1,EMPRESA ${id},Calle ${id},POSADAS,MISIONES,NEA,1,${product},2,${horario},${price},${date},1,${brand},${lat},${lng},"{""type"":""Point"",""coordinates"":[${lng},${lat}]}"`;

test('csv: quotes, commas and doubled quotes', () => {
  assert.deepEqual(parseCsv('﻿a,b\n1,"x, ""y"""\r\n'), [{ a: '1', b: 'x, "y"' }]);
});

test('fuel: one station per place, recent day prices only, old stations out', () => {
  const csv = [
    HEAD,
    row(1, 'Nafta (súper) entre 92 y 95 Ron', 'Diurno', 2359, '2026-09-24 11:13:00', 'YPF', -27.368, -55.896),
    row(1, 'Nafta (súper) entre 92 y 95 Ron', 'Nocturno', 2500, '2026-09-24 11:13:00', 'YPF', -27.368, -55.896),
    row(1, 'GNC', 'Diurno', 900, '2025-01-01 10:00:00', 'YPF', -27.368, -55.896), // price too old, station kept
    row(2, 'Gas Oil Grado 2', 'Diurno', 2549, '2026-10-10 09:00:00', 'SHELL C.A.P.S.A.', -27.371, -55.897),
    row(3, 'Gas Oil Grado 2', 'Diurno', 2000, '2023-01-01 09:00:00', 'PUMA', -27.37, -55.9), // station gone
  ].join('\n');
  const st = stationsFromCsv(csv, NOW);
  assert.equal(st.length, 2);
  assert.equal(st[0].brand, 'YPF');
  assert.deepEqual(Object.keys(st[0].prices), ['nafta']);
  assert.equal(st[0].prices.nafta.price, 2359);
  assert.equal(st[1].brand, 'Shell C.A.P.S.A.');

  const r = nearestStations({ stations: st, updated: 'x' }, { lat: -27.3671, lng: -55.8961 }, 'nafta', NOW);
  assert.equal(r.nearest[0].brand, 'YPF');
  assert.equal(r.nearest[0].prices.nafta.daysOld, 25);
  assert.deepEqual(r.nearest[1].prices, {}); // Shell has no nafta price
  assert.equal(r.cheapest.brand, 'YPF');
});

test('dollar rates', () => {
  assert.deepEqual(ratesFromApi([{ casa: 'blue', nombre: 'Blue', compra: 1535, venta: 1555, fechaActualizacion: 't' }, { casa: 'x' }]), [
    { kind: 'blue', name: 'Blue', buy: 1535, sell: 1555, updated: 't' },
  ]);
});

// A page as pdftotext -tsv gives it: header with years, a brand, a model and
// versions whose prices sit right-aligned under their year.
function tsv(words) {
  const lines = ['level\tpage_num\tpar_num\tblock_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext'];
  for (const [left, top, width, text] of words) lines.push(`5\t1\t0\t0\t0\t0\t${left}\t${top}\t${width}\t9\t100\t${text}`);
  return lines.join('\n');
}
test('cars: CCA columns by position', () => {
  const page = tsv([
    [300, 20, 40, 'Octubre'], [345, 20, 25, '2026'],
    [200, 50, 6, '0'], [208, 50, 15, 'Km'], [260, 50, 22, '2025'], [320, 50, 22, '2016'], [380, 50, 22, '2015'],
    [30, 70, 60, 'CHEVROLET'],
    [30, 82, 30, 'ONIX'],
    [30, 94, 10, '5P'], [43, 94, 12, '1,4'], [57, 94, 10, 'LT'], [317, 94, 25, '10487'], [377, 94, 25, '10179'],
    [30, 106, 10, '4P'], [43, 106, 12, '1,4'], [57, 106, 30, 'TDCI'], // no prices: not a name
    [30, 118, 10, 'D/C'], [43, 118, 12, '1,2'], [180, 118, 43, '111,660'], [255, 118, 27, '41254,9'],
  ]);
  const r = carsFromTsv(page);
  assert.equal(r.month, 'Octubre 2026');
  assert.deepEqual(r.cars, [
    { brand: 'CHEVROLET', model: 'ONIX', version: '5P 1,4 LT', prices: { 2016: 10487, 2015: 10179 } },
    { brand: 'CHEVROLET', model: 'ONIX', version: 'D/C 1,2', prices: { '0km': 111660, 2025: 41254.9 } },
  ]);
  const q = findCars({ cars: r.cars, month: r.month, unit: 'miles de pesos' }, 'onix 1.4 lt 2015');
  assert.deepEqual(q.results, [{ brand: 'CHEVROLET', model: 'ONIX', version: '5P 1,4 LT', prices: { 2015: 10179 } }]);
  assert.equal(findCars({ cars: r.cars }, 'onix 2010').results.length, 0);
});

test('weather in words', () => {
  const w = weatherFromApi({
    current: { temperature_2m: 13.4, weather_code: 63, visibility: 28500 },
    hourly: { time: ['2026-10-19T14:00'], precipitation_probability: [70], precipitation: [1.2], weather_code: [95] },
  });
  assert.equal(w.now.sky, 'lluvia');
  assert.equal(w.now.visibilityKm, 28.5);
  assert.deepEqual(w.nextHours[0], { hour: '14:00', rainChance: 70, rainMm: 1.2, sky: 'tormenta' });
  assert.equal(w.maxRainChance, 70);
});

test('prices in snippets', () => {
  assert.deepEqual(extractPrices('Bujía NGK $ 12.500 envío gratis. Antes $15.990,50'), ['$ 12.500', '$ 15.990,50']);
  assert.deepEqual(extractPrices('ARS 8900 cuotas'), ['$ 8900']);
  assert.deepEqual(extractPrices('Modelo 2016 1,4'), []);
});

async function post(app, path, body) {
  const server = await listen(app, 0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/tools/v1/${path}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sk-ok', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

test('routes: fuel, dollar, weather, car_price; input checked; no data → 503', async () => {
  const data = {
    fuel: { stations: [{ brand: 'YPF', company: 'A', address: 'X 1', town: 'Posadas', lat: -27.368, lng: -55.896, prices: {} }] },
    dollar: { rates: [{ kind: 'blue', sell: 1555 }], updated: 'u', source: 's' },
  };
  const app = createApp({
    search: async () => [],
    isValidKey: async () => true,
    data: (n) => data[n] ?? null,
    weather: async () => ({ now: { sky: 'despejado' } }),
  });
  assert.equal((await post(app, 'fuel', { lat: -27.37, lng: -55.9 })).body.nearest[0].brand, 'YPF');
  assert.equal((await post(app, 'fuel', { lat: 'x', lng: 1 })).status, 400);
  assert.equal((await post(app, 'fuel', { lat: -27, lng: -55, product: 'kerosene' })).status, 400);
  assert.equal((await post(app, 'dollar', {})).body.rates[0].sell, 1555);
  assert.equal((await post(app, 'weather', { lat: -27, lng: -55 })).body.now.sky, 'despejado');
  assert.equal((await post(app, 'car_price', { query: 'onix' })).status, 503);
  assert.equal((await post(app, 'car_price', { query: 'onix', year: 'ayer' })).status, 400);
  assert.equal((await post(app, 'toString', {})).status, 404);
});
