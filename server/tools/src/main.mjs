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
import { rerankClient } from './rerank.mjs';
import { makeJudge, makeResearch } from './research.mjs';
import { knowledgeStore } from './knowledge.mjs';
import { docsStore } from './docs-store.mjs';
import { makeDocs } from './docs.mjs';
import { embedClient } from './embed.mjs';
import { llmClassifier } from './doc-filter.mjs';
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

// The lab's text base: pages the agent read and documents, searched by words and
// by meaning. Embeddings: Qwen3-Embedding-0.6B on the Z440 (docker-compose
// `embed`), with the same vLLM key as the speech server. The personal-data
// classifier (Qwen3.8 on :8000) is off unless DOCS_CLASSIFY=1.
const docs = makeDocs({
  store: docsStore(env.DOCS_FILE ?? join(homedir(), '.local/share/obdient/docs.sqlite')),
  embed: embedClient({
    url: env.EMBED_URL ?? 'http://192.168.100.210:8003',
    key: env.EMBED_API_KEY ?? env.STT_API_KEY ?? null,
  }),
  classify:
    env.DOCS_CLASSIFY === '1'
      ? llmClassifier({ url: env.LLM_URL ?? 'http://192.168.100.210:8000', key: env.LLM_API_KEY ?? env.STT_API_KEY ?? null })
      : null,
  log,
});
docs.store.purge();
const knowledge = knowledgeStore(env.KNOWLEDGE_FILE ?? join(homedir(), '.local/share/obdient/knowledge.json'));
{
  // A file written before the lab stopped keeping VINs is cleaned once, here.
  const cleaned = knowledge.purge();
  if (cleaned) log(`knowledge: ${cleaned} vehicle records cleaned of VINs`);
}
const search = searxng({ baseUrl: env.SEARXNG_URL ?? 'http://127.0.0.1:8888' });
const fetchPage = makeFetchPage();
const app = createApp({
  search,
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
  fetchPage,
  knowledge,
  docs,
  // Search + read + rank in one call (research.mjs): the web part of the assistant.
  research: makeResearch({
    search,
    fetchPage,
    docs,
    // The chat model on the Z440 tells an answer from a page on the same subject.
    judge: makeJudge({ url: env.LLM_URL ?? 'http://192.168.100.210:8000', key: env.LLM_API_KEY ?? env.STT_API_KEY ?? null }),
    // Qwen3-Reranker-0.6B on the second GPU orders the candidates before the judge;
    // RERANK_URL empty turns it off, and if it is down the search order stays.
    rerank: env.RERANK_URL === '' ? null : rerankClient({ url: env.RERANK_URL ?? 'http://192.168.100.210:8004', key: env.RERANK_API_KEY ?? env.STT_API_KEY ?? null }),
    log,
  }),
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
