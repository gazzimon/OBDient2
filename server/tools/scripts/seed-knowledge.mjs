// One-shot: loads data/module-seed.json into the lab knowledge base, marked as
// a seed, so knowledge_lookup returns something before the first real scan.
// Real scans (scan_modules) add to it. Expand the seed from commaai/opendbc.
//
//   node scripts/seed-knowledge.mjs [path-to-knowledge.json]

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { knowledgeStore } from '../src/knowledge.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(join(here, '../data/module-seed.json'), 'utf8'));
const file = process.argv[2] ?? process.env.KNOWLEDGE_FILE ?? join(homedir(), '.local/share/obdient/knowledge.json');
const kb = knowledgeStore(file);

let n = 0;
for (const v of seed.vehicles) {
  kb.report({ make: v.make, model: v.model, protocol: v.protocol, modules: v.modules, note: 'semilla' });
  n += 1;
}
console.log(`Sembrados ${n} vehículos en ${file}`);
