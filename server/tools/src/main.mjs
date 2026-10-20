// Entry point: settings from ~/.config/obdient/tools.env if present (where
// new-api, SearXNG and the speech server are; STT_API_KEY is vLLM's key, so
// with it the file must be private), and serves on 127.0.0.1:$PORT.
// Unit: obdient-tools.service.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readData } from './data.mjs';
import { newApiKeyCheck } from './keys.mjs';
import { weatherFromApi, weatherUrl } from './queries/weather.mjs';
import { searxng } from './searxng.mjs';
import { createApp, listen } from './server.mjs';
import { keyOwnerLookup } from './key-owners.mjs';
import { makeFetchPage } from './fetch-page.mjs';
import { knowledgeStore } from './knowledge.mjs';
import { attachStt } from './stt-proxy.mjs';

function readEnv(file) {
  const env = {};
  if (!existsSync(file)) return env;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  if (env.STT_API_KEY && statSync(file).mode & 0o077) throw new Error(`${file} has a key: chmod 600 ${file}`);
  return env;
}

const env = readEnv(process.env.TOOLS_ENV ?? join(homedir(), '.config/obdient/tools.env'));
const log = (msg) => console.log(`${new Date().toISOString()} ${msg}`);

const isValidKey = newApiKeyCheck({ baseUrl: env.NEWAPI_URL ?? 'http://127.0.0.1:3000' });
const app = createApp({
  search: searxng({ baseUrl: env.SEARXNG_URL ?? 'http://127.0.0.1:8888' }),
  isValidKey,
  data: (name) => readData(name),
  weather: async (p) => {
    const res = await fetch(weatherUrl(p), { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    return weatherFromApi(await res.json());
  },
  // Driver of each position: the account's email (written by obdient-auth at login).
  ownerOf: keyOwnerLookup(env.KEY_OWNERS_FILE ?? join(homedir(), '.local/share/obdient/key-owners.json')),
  // Full-page reader for the agent (SSRF-guarded), and the lab's shared facts.
  fetchPage: makeFetchPage(),
  knowledge: knowledgeStore(env.KNOWLEDGE_FILE ?? join(homedir(), '.local/share/obdient/knowledge.json')),
  // Live position into Traccar's OsmAnd port (docker, server/traccar), local only.
  track: async (query) => {
    const res = await fetch(`${env.TRACCAR_OSMAND_URL ?? 'http://127.0.0.1:5055'}/?${query}`, {
      method: 'POST',
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`Traccar HTTP ${res.status}`);
  },
  log,
});

const port = Number(env.PORT ?? 8791);
const server = await listen(app, port);
// Speech to text: Voxtral Realtime on the Z440 (docker-compose `stt`).
attachStt(server, {
  upstreamUrl: env.STT_URL ?? 'ws://192.168.100.210:8002/v1/realtime',
  upstreamKey: env.STT_API_KEY ?? null,
  model: env.STT_MODEL ?? 'voxtral-realtime',
  isValidKey,
  log,
});
log(`obdient-tools on 127.0.0.1:${port}`);
