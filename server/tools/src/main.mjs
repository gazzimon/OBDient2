// Entry point: settings from ~/.config/obdient/tools.env if present (no
// secrets in it: it only says where new-api and SearXNG are), and serves on
// 127.0.0.1:$PORT. Unit: obdient-tools.service.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { newApiKeyCheck } from './keys.mjs';
import { searxng } from './searxng.mjs';
import { createApp, listen } from './server.mjs';

function readEnv(file) {
  const env = {};
  if (!existsSync(file)) return env;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = readEnv(process.env.TOOLS_ENV ?? join(homedir(), '.config/obdient/tools.env'));
const log = (msg) => console.log(`${new Date().toISOString()} ${msg}`);

const app = createApp({
  search: searxng({ baseUrl: env.SEARXNG_URL ?? 'http://127.0.0.1:8888' }),
  isValidKey: newApiKeyCheck({ baseUrl: env.NEWAPI_URL ?? 'http://127.0.0.1:3000' }),
  log,
});

const port = Number(env.PORT ?? 8791);
await listen(app, port);
log(`obdient-tools on 127.0.0.1:${port}`);
