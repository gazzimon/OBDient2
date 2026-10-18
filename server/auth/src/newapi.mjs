// One new-api token per Firebase account, all under the service user
// (ADR-0008 §2). new-api only lets a user manage its own tokens, so the
// service acts as that user with its access token.
//
// Token name: "fb-" + 20 hex of sha256(uid). Stable, short, and the uid itself
// never reaches new-api.

import { createHash } from 'node:crypto';

// new-api token status
const ENABLED = 1;
const STATUS_ERROR = { 2: 'disabled', 3: 'expired', 4: 'exhausted' };

export class AccountUnavailable extends Error {
  name = 'AccountUnavailable';
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

export function tokenName(uid) {
  return 'fb-' + createHash('sha256').update(uid).digest('hex').slice(0, 20);
}

// new-api rate-limits token search and key reads per IP, and every call
// from here comes from 127.0.0.1: a key stays cached this long before its
// status is checked again (a disabled account takes at most this to cut).
export const CACHE_MS = 10 * 60_000;

export function newApiAccounts({ baseUrl, userId, accessToken, model, quota, fetch = globalThis.fetch, now = () => Date.now() }) {
  for (const [k, v] of Object.entries({ baseUrl, userId, accessToken, model })) {
    if (!v) throw new Error(`new-api config: ${k} is required`);
  }
  const headers = { Authorization: `Bearer ${accessToken}`, 'New-Api-User': String(userId), 'Content-Type': 'application/json' };

  async function call(method, path, body) {
    const res = await fetch(baseUrl + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) throw new Error(`new-api ${method} ${path.split('?')[0]}: HTTP ${res.status}`);
    const out = await res.json();
    if (!out.success) throw new Error(`new-api ${method} ${path.split('?')[0]}: ${out.message}`);
    return out;
  }

  const items = (out) => (Array.isArray(out.data) ? out.data : (out.data?.items ?? []));

  async function find(name) {
    const out = await call('GET', `/api/token/search?keyword=${encodeURIComponent(name)}`);
    return items(out).find((t) => t.name === name) ?? null;
  }

  async function keyOf(token) {
    let key = token.key ?? '';
    // Newer versions mask keys in listings; the full key has its own endpoint.
    if (!key || key.includes('*')) key = (await call('POST', `/api/token/${token.id}/key`)).data?.key ?? '';
    if (!key || key.includes('*')) throw new Error('new-api: could not read the token key');
    return key.startsWith('sk-') ? key : `sk-${key}`;
  }

  // Two logins of the same account at once must not create two tokens.
  const inFlight = new Map();
  const once = (name, work) => {
    if (!inFlight.has(name)) inFlight.set(name, work().finally(() => inFlight.delete(name)));
    return inFlight.get(name);
  };

  const cache = new Map(); // name → { key, at }

  return {
    // The account's key, created on first login.
    tokenFor(uid) {
      const name = tokenName(uid);
      const hit = cache.get(name);
      if (hit && now() - hit.at < CACHE_MS) return Promise.resolve(hit.key);
      return once(name, async () => {
        let token = await find(name);
        if (!token) {
          await call('POST', '/api/token/', {
            name,
            remain_quota: quota,
            unlimited_quota: false,
            expired_time: -1,
            model_limits_enabled: true,
            model_limits: model,
          });
          token = await find(name);
          if (!token) throw new Error('new-api: token not found after creating it');
        }
        if (token.status !== ENABLED) {
          cache.delete(name);
          throw new AccountUnavailable(STATUS_ERROR[token.status] ?? 'disabled');
        }
        const key = hit?.key ?? (await keyOf(token));
        cache.set(name, { key, at: now() });
        return key;
      });
    },

    // Account deleted: its token goes too. Idempotent.
    async remove(uid) {
      cache.delete(tokenName(uid));
      const token = await find(tokenName(uid));
      if (token) await call('DELETE', `/api/token/${token.id}`);
      return token != null;
    },
  };
}
