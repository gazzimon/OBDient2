// Data jobs for obdient-tools (systemd --user timers, see server/tools/README.md):
//   node src/jobs.mjs daily     fuel prices + dollar rates
//   node src/jobs.mjs monthly   CCA car price list
// A failed source keeps yesterday's file: the tools say how old the data is.

import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { writeData } from './data.mjs';
import { CCA_PDF_URL, carsFromTsv } from './jobs/cars.mjs';
import { DOLLAR_URL, ratesFromApi } from './jobs/dollar.mjs';
import { FUEL_CSV_URL, stationsFromCsv } from './jobs/fuel.mjs';

const run = promisify(execFile);
const log = (msg) => console.log(`${new Date().toISOString()} ${msg}`);
const UA = { 'User-Agent': 'OBDient2-tools/0.1 (+https://obdient.duckdns.org)' };

async function get(url, timeoutMs = 120_000) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res;
}

async function fuel() {
  const stations = stationsFromCsv(await (await get(FUEL_CSV_URL)).text());
  if (stations.length < 500) throw new Error(`only ${stations.length} stations: kept the previous file`);
  writeData('fuel', { updated: new Date().toISOString(), source: 'Secretaría de Energía, Res. 314/2016 (datos.gob.ar)', stations });
  log(`fuel: ${stations.length} stations, ${stations.filter((s) => Object.keys(s.prices).length).length} with recent prices`);
}

async function dollar() {
  const rates = ratesFromApi(await (await get(DOLLAR_URL, 20_000)).json());
  if (rates.length === 0) throw new Error('no rates');
  writeData('dollar', { updated: new Date().toISOString(), source: 'dolarapi.com', rates });
  log(`dollar: ${rates.map((r) => r.kind).join(', ')}`);
}

async function cars() {
  const dir = mkdtempSync(join(tmpdir(), 'cca-'));
  try {
    const pdf = join(dir, 'Autos.pdf');
    writeFileSync(pdf, Buffer.from(await (await get(CCA_PDF_URL)).arrayBuffer()));
    const { stdout } = await run('pdftotext', ['-tsv', pdf, '-'], { maxBuffer: 64 * 1024 * 1024 });
    const { month, cars: list } = carsFromTsv(stdout);
    if (list.length < 1000) throw new Error(`only ${list.length} cars: kept the previous file`);
    writeData('cars', { updated: new Date().toISOString(), month, source: 'Cámara del Comercio Automotor (cca.org.ar)', unit: 'miles de pesos', cars: list });
    log(`cars: ${list.length} versions, ${month}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const JOBS = { daily: [fuel, dollar], monthly: [cars] };
const which = process.argv[2];
if (!JOBS[which]) {
  console.error('usage: node src/jobs.mjs daily|monthly');
  process.exit(2);
}
let failed = 0;
for (const job of JOBS[which]) {
  try {
    await job();
  } catch (err) {
    failed++;
    log(`${job.name} failed: ${err.message}`);
  }
}
process.exit(failed ? 1 : 0);
