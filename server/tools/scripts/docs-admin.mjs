// Admin of the lab's text base, on the K16 (anyone can delete only what they
// added through the app; this can delete anything).
//
//   node scripts/docs-admin.mjs list
//   node scripts/docs-admin.mjs delete <source>     # "doc:<name>" or a page's URL
//   node scripts/docs-admin.mjs purge               # drop expired fragments
//   node scripts/docs-admin.mjs reindex             # embed the fragments stored without a vector
//
// Reads ~/.config/obdient/tools.env like obdient-tools (DOCS_FILE, EMBED_URL, keys).

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { docsStore } from '../src/docs-store.mjs';
import { embedClient } from '../src/embed.mjs';

const env = {};
const envFile = process.env.TOOLS_ENV ?? join(homedir(), '.config/obdient/tools.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const store = docsStore(env.DOCS_FILE ?? join(homedir(), '.local/share/obdient/docs.sqlite'));
const [cmd, arg] = process.argv.slice(2);

switch (cmd) {
  case 'list':
    for (const s of store.list()) console.log(`${s.fetched}  ${String(s.chunks).padStart(4)}  ${s.kind.padEnd(3)}  ${s.addedBy ?? '-'}  ${s.source}`);
    console.log(store.count());
    break;
  case 'delete':
    if (!arg) throw new Error('delete <source>');
    console.log(`borrados ${store.remove(arg)} fragmentos`);
    break;
  case 'purge':
    console.log(`vencidos borrados: ${store.purge()}`);
    break;
  case 'reindex': {
    const embed = embedClient({ url: env.EMBED_URL ?? 'http://192.168.100.210:8003', key: env.EMBED_API_KEY ?? env.STT_API_KEY ?? null });
    let done = 0;
    for (;;) {
      const rows = store.missingEmbeddings(64);
      if (rows.length === 0) break;
      const vecs = await embed.embedDocs(rows.map((r) => r.text));
      rows.forEach((r, i) => store.setEmbedding(r.id, vecs[i]));
      done += rows.length;
    }
    console.log(`con vector ahora: ${done}`, store.count());
    break;
  }
  default:
    console.log('uso: list | delete <source> | purge | reindex');
}
store.close();
