/// <reference types="node" />
// Replays a recorded trip through the phone's fusion code and prints findings.
//   npm run replay -- trips/trip-20261016-101500.jsonl [--sign -1]

import { readFileSync } from 'node:fs';
import { formatSummary, replayTrip } from '@/domain/recording/replay';
import { parseTripLog } from '@/domain/recording/trip-log';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const signArg = args.indexOf('--sign');
const sign = signArg >= 0 && args[signArg + 1] === '-1' ? -1 : 1;

if (!file) {
  console.error('Uso: npm run replay -- <archivo.jsonl> [--sign -1]');
  process.exit(1);
}

const records = parseTripLog(readFileSync(file, 'utf8'));
const header = records.find((r) => r.k === 'hdr');
console.log(`${file} — ${records.length} registros`);
if (header && 'meta' in header) console.log(`Inicio ${header.startedAt}`, JSON.stringify(header.meta));
console.log('');
console.log(formatSummary(replayTrip(records, sign)));
