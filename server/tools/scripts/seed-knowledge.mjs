// One-shot: loads the seeds into the lab knowledge base, marked as such, so
// knowledge_lookup returns something before the first real scan. Real scans
// (scan_modules) add to it. Re-running is safe: report() merges.
//
//   data/module-seed.json   standard ISO 15765-4 addresses
//   data/opendbc-seed.json  per-platform addresses from commaai/opendbc
//                           (regenerate with scripts/opendbc-extract.py)
//
//   node scripts/seed-knowledge.mjs [path-to-knowledge.json]

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { knowledgeStore } from '../src/knowledge.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] ?? process.env.KNOWLEDGE_FILE ?? join(homedir(), '.local/share/obdient/knowledge.json');
const kb = knowledgeStore(file);

const seeds = [
  ['module-seed.json', 'semilla'],
  ['opendbc-seed.json', 'semilla opendbc'],
];
let n = 0;
for (const [name, note] of seeds) {
  const seed = JSON.parse(readFileSync(join(here, '../data', name), 'utf8'));
  for (const v of seed.vehicles) {
    kb.report({ make: v.make, model: v.model, protocol: v.protocol, modules: v.modules, note });
    n += 1;
  }
}
console.log(`Sembrados ${n} vehículos en ${file}`);
