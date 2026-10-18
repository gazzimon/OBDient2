import { AccountService, type IdentityPort, type SecretStore } from '@/data/auth/account-service';

type Handler = (url: string, init: RequestInit) => { status: number; body: unknown };

function fakeFetch(handler: Handler) {
  const calls: string[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push(`${init.method} ${url}`);
    const { status, body } = handler(url, init);
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function memorySecrets(): SecretStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: async (k) => data.get(k) ?? null, set: async (k, v) => void data.set(k, v), remove: async (k) => void data.delete(k) };
}

const AUTH = 'https://example.test/auth';

function backend(opts: { sessionStatus?: number; sessionError?: string } = {}) {
  return fakeFetch((url, init) => {
    if (url === `${AUTH}/v1/session`) {
      if ((init.headers as Record<string, string>).Authorization !== 'Bearer did-ok') return { status: 401, body: { error: 'invalid_token' } };
      if (opts.sessionStatus) return { status: opts.sessionStatus, body: { error: opts.sessionError } };
      return { status: 200, body: { apiKey: 'sk-account', model: 'obdient-chat', baseUrl: 'https://x/llm/v1' } };
    }
    if (url === `${AUTH}/v1/account`) return { status: 204, body: null };
    return { status: 404, body: {} };
  });
}

function identity(overrides: Partial<IdentityPort> = {}) {
  return {
    signIn: jest.fn(async (email: string) => ({ idToken: 'did-ok', email })),
    idToken: jest.fn(async () => 'did-ok' as string | null),
    signOut: jest.fn(async () => undefined),
    ...overrides,
  };
}

function service(f = backend(), id = identity()) {
  const secrets = memorySecrets();
  const s = new AccountService({ identity: id, secrets, authUrl: AUTH, fetchFn: f.fn });
  return { s, secrets, id, calls: f.calls };
}

describe('AccountService (email code)', () => {
  it('signs in with the email, gets the account key, and keeps it for the next start', async () => {
    const { s, secrets, id } = service();
    expect(await s.signIn('  Ana@Example.com ')).toEqual({ ok: true, profile: { email: 'ana@example.com' } });
    expect(id.signIn).toHaveBeenCalledWith('ana@example.com');
    expect(s.llmCredentials()).toEqual({ baseUrl: 'https://x/llm/v1', apiKey: 'sk-account', model: 'obdient-chat' });
    const again = new AccountService({ identity: identity(), secrets, authUrl: AUTH, fetchFn: backend().fn });
    expect(await again.restore()).toEqual({ email: 'ana@example.com' });
    expect(again.llmCredentials()?.apiKey).toBe('sk-account');
  });

  it('rejects a malformed email before calling the provider', async () => {
    const { s, id } = service();
    expect(await s.signIn('ana@')).toEqual({ ok: false, reason: 'invalid_email' });
    expect(id.signIn).not.toHaveBeenCalled();
  });

  it('closing the code screen is a cancel; nothing saved', async () => {
    const { s, secrets, calls } = service(backend(), identity({ signIn: jest.fn(async () => null) }));
    expect(await s.signIn('ana@example.com')).toEqual({ ok: false, reason: 'cancelled' });
    expect(calls).toEqual([]);
    expect(secrets.data.size).toBe(0);
  });

  it('a disabled or exhausted account is reported', async () => {
    expect(await service(backend({ sessionStatus: 403, sessionError: 'disabled' })).s.signIn('a@b.co')).toEqual({ ok: false, reason: 'disabled' });
    expect(await service(backend({ sessionStatus: 403, sessionError: 'exhausted' })).s.signIn('a@b.co')).toEqual({ ok: false, reason: 'exhausted' });
  });

  it('renews the key with a fresh token; none when the session ended', async () => {
    const { s, calls } = service();
    await s.signIn('a@b.co');
    expect(await s.renewLlmKey()).toMatchObject({ apiKey: 'sk-account' });
    expect(calls.filter((c) => c.endsWith('/v1/session'))).toHaveLength(2);

    const ended = service(backend(), identity({ idToken: jest.fn(async () => null) }));
    await ended.s.signIn('a@b.co');
    expect(await ended.s.renewLlmKey()).toBeNull();
  });

  it('signs out and deletes the account (revokes the key first)', async () => {
    const { s, secrets, id, calls } = service();
    await s.signIn('a@b.co');
    expect(await s.deleteAccount()).toEqual({ ok: true });
    expect(calls).toContain(`DELETE ${AUTH}/v1/account`);
    expect(secrets.data.size).toBe(0);
    expect(id.signOut).toHaveBeenCalled();

    const ended = service(backend(), identity({ idToken: jest.fn(async () => null) }));
    await ended.s.signIn('a@b.co');
    expect(await ended.s.deleteAccount()).toEqual({ ok: false, reason: 'session_expired' });
  });

  it('a saved account from the old Google sign-in (no email) means signed out', async () => {
    const { s, secrets } = service();
    secrets.data.set('obdient2.account', JSON.stringify({ uid: 'x', email: null, llm: { apiKey: 'k' } }));
    expect(await s.restore()).toBeNull();
  });
});
