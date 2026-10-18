// Verifies a Magic DID token (email code login, ADR-0008): signature and
// expiry with @magic-sdk/admin, then the account's email from Magic.
//
// The account id is the email, not Magic's issuer: if the login provider
// changes (Supabase past 1,000 users), the same person keeps the same model
// key, because the key's name comes from this id (newapi.mjs).

import { Magic } from '@magic-sdk/admin';
import { InvalidIdToken } from './firebase.mjs';

export function magicVerifier(secretKey, { magic } = {}) {
  if (!secretKey && !magic) throw new Error('MAGIC_SECRET_KEY is required');
  let client = magic ? Promise.resolve(magic) : null;
  const get = () => (client ??= Magic.init(secretKey).catch((err) => {
    client = null; // retried on the next login
    throw err;
  }));

  return async (didToken) => {
    const m = await get();
    try {
      m.token.validate(didToken);
    } catch (err) {
      throw new InvalidIdToken(err?.code ?? 'invalid');
    }
    const meta = await m.users.getMetadataByToken(didToken);
    const email = typeof meta?.email === 'string' ? meta.email.trim().toLowerCase() : '';
    if (!email) throw new InvalidIdToken('no_email');
    return { uid: `email:${email}`, email, provider: 'magic' };
  };
}
