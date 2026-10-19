// Only accounts of the assistant use the tools: the phone sends the same model
// key it uses for chat, and new-api says whether it is valid (GET /v1/models).
// Answers are cached a few minutes by the key's hash; keys are never logged.

import { createHash } from 'node:crypto';

const VALID_MS = 10 * 60_000;
const INVALID_MS = 60_000;

export function newApiKeyCheck({ baseUrl, fetchFn = fetch, now = () => Date.now() }) {
  const cache = new Map(); // sha256(key) → { ok, until }
  return async function isValid(key) {
    if (!key || key.length > 200) return false;
    const id = createHash('sha256').update(key).digest('hex');
    const hit = cache.get(id);
    if (hit && hit.until > now()) return hit.ok;
    const res = await fetchFn(`${baseUrl.replace(/\/$/, '')}/v1/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5_000),
    });
    // 5xx: new-api is down. Not cached, and not the account's fault.
    if (res.status >= 500) throw new Error(`new-api HTTP ${res.status}`);
    const ok = res.ok;
    if (cache.size > 5_000) cache.clear();
    cache.set(id, { ok, until: now() + (ok ? VALID_MS : INVALID_MS) });
    return ok;
  };
}
