// One new-api token per Firebase account, all under the service user
// (ADR-0008 §2). new-api only lets a user manage its own tokens, so the
// service acts as that user with its access token.
//
// Token name: the account's email, so the usage logs say who it is (an email
// is the account id since the move to email login, ADR-0008). new-api allows
// 50 characters; a longer email is cut and given a short hash to stay unique.
// Accounts from before (Firebase, 2026-10-18) were named "fb-" + 20 hex of
// sha256(uid); they are renamed on their next login, keeping the same key.

import { createHash } from 'node:crypto';

// new-api token status
const ENABLED = 1;
const STATUS_ERROR = { 2: 'disabled', 3: 'expired', 4: 'exhausted' };
const MAX_NAME = 50;

export class AccountUnavailable extends Error {
  name = 'AccountUnavailable';
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

const hex = (s, n) => createHash('sha256').update(s).digest('hex').slice(0, n);

export function legacyTokenName(uid) {
  return 'fb-' + hex(uid, 20);
}

export function tokenName(uid) {
  if (!uid.startsWith('email:')) return legacyTokenName(uid);
  const email = uid.slice('email:'.length);
  return email.length <= MAX_NAME ? email : `${email.slice(0, MAX_NAME - 9)}~${hex(email, 8)}`;
}

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

  // An account from the old naming: give it its new name, same key and quota.
  // new-api's update takes every field (missing ones would be zeroed).
  async function renameLegacy(uid, name) {
    const legacy = await find(legacyTokenName(uid));
    if (!legacy || legacy.name === name) return legacy;
    const { key: _key, ...fields } = legacy;
    await call('PUT', '/api/token/', { ...fields, name });
    return { ...legacy, name };
  }

  const cache = new Map(); // name → { key, at }

  return {
    // The account's key, created on first login.
    tokenFor(uid) {
      const name = tokenName(uid);
      const hit = cache.get(name);
      if (hit && now() - hit.at < CACHE_MS) return Promise.resolve(hit.key);
      return once(name, async () => {
        let token = await find(name);
        if (!token) token = await renameLegacy(uid, name);
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
      const token = (await find(tokenName(uid))) ?? (await find(legacyTokenName(uid)));
      if (token) await call('DELETE', `/api/token/${token.id}`);
      return token != null;
    },
  };
}
