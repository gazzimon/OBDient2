// Entry point: reads ~/.config/obdient/auth.env (0600) and serves on
// 127.0.0.1:$PORT. Setup: setup-app-user.py; unit: obdient-auth.service.

import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { firebaseVerifier } from './firebase.mjs';
import { newApiAccounts } from './newapi.mjs';
import { createApp, listen } from './server.mjs';

function readEnv(file) {
  if (statSync(file).mode & 0o077) throw new Error(`${file} must be private: chmod 600 ${file}`);
  const env = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = readEnv(process.env.AUTH_ENV ?? join(homedir(), '.config/obdient/auth.env'));
const model = env.MODEL ?? 'obdient-chat';
const log = (msg) => console.log(`${new Date().toISOString()} ${msg}`);

const app = createApp({
  verify: firebaseVerifier(env.FIREBASE_PROJECT_ID),
  accounts: newApiAccounts({
    baseUrl: env.NEWAPI_URL ?? 'http://127.0.0.1:3000',
    userId: env.NEWAPI_APP_USER_ID,
    accessToken: env.NEWAPI_APP_ACCESS_TOKEN,
    model,
    quota: Number(env.TOKEN_QUOTA ?? 5_000_000),
  }),
  model,
  publicBaseUrl: env.PUBLIC_LLM_URL ?? 'https://obdient.duckdns.org/llm/v1',
  log,
});

const port = Number(env.PORT ?? 8790);
await listen(app, port);
log(`obdient-auth on 127.0.0.1:${port} (project ${env.FIREBASE_PROJECT_ID})`);
