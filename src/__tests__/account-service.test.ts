import { AccountService, type SecretStore } from '@/data/auth/account-service';
import { FirebaseAuthError, FirebaseRest } from '@/data/auth/firebase-rest';

type Handler = (url: string, init: RequestInit) => { status: number; body: unknown };

function fakeFetch(handler: Handler) {
  const calls: string[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push(`${init.method} ${url.split('?')[0]}`);
    const { status, body } = handler(url, init);
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function memorySecrets(): SecretStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    remove: async (k) => void data.delete(k),
  };
}

const AUTH = 'https://example.test/auth';

// Firebase + obdient-auth answering like the real ones.
function backend(opts: { sessionStatus?: number; sessionError?: string; deleteError?: string } = {}) {
  let deleteAttempts = 0;
  return fakeFetch((url, init) => {
    if (url.includes('accounts:signInWithIdp')) {
      const body = JSON.parse(String(init.body));
      if (!String(body.postBody).includes('id_token=google-ok')) return { status: 400, body: { error: { message: 'INVALID_IDP_RESPONSE : bad' } } };
      return { status: 200, body: { localId: 'uid-1', email: 'a@b.c', displayName: 'Ana', idToken: 'fb-id', refreshToken: 'fb-refresh', expiresIn: '3600' } };
    }
    if (url.startsWith('https://securetoken.googleapis.com')) {
      return { status: 200, body: { id_token: 'fb-id-2', refresh_token: 'fb-refresh-2', expires_in: '3600' } };
    }
    if (url.includes('accounts:delete')) {
      deleteAttempts++;
      if (opts.deleteError && deleteAttempts === 1) return { status: 400, body: { error: { message: opts.deleteError } } };
      return { status: 200, body: {} };
    }
    if (url === `${AUTH}/v1/session`) {
      if (opts.sessionStatus) return { status: opts.sessionStatus, body: { error: opts.sessionError } };
      return { status: 200, body: { apiKey: 'sk-account', model: 'obdient-chat', baseUrl: 'https://x/llm/v1' } };
    }
    if (url === `${AUTH}/v1/account`) return { status: 204, body: null };
    return { status: 404, body: {} };
  });
}

function service(f = backend(), googleTokens: (string | null)[] = ['google-ok'], now = () => 0) {
  const secrets = memorySecrets();
  const google = { idToken: jest.fn(async () => (googleTokens.length ? googleTokens.shift()! : 'google-ok')), signOut: jest.fn(async () => undefined) };
  const s = new AccountService({ google, firebase: new FirebaseRest('KEY', f.fn, now), secrets, authUrl: AUTH, fetchFn: f.fn, now });
  return { s, secrets, google, calls: f.calls };
}

describe('AccountService', () => {
  it('signs in: Google → Firebase → account key, saved for the next start', async () => {
    const { s, secrets } = service();
    expect(await s.signIn()).toEqual({ ok: true, profile: { uid: 'uid-1', email: 'a@b.c', name: 'Ana' } });
    expect(s.llmCredentials()).toEqual({ baseUrl: 'https://x/llm/v1', apiKey: 'sk-account', model: 'obdient-chat' });

    const again = new AccountService({
      google: { idToken: async () => null, signOut: async () => undefined },
      firebase: new FirebaseRest('KEY', backend().fn),
      secrets,
      authUrl: AUTH,
    });
    expect(await again.restore()).toEqual({ uid: 'uid-1', email: 'a@b.c', name: 'Ana' });
    expect(again.llmCredentials()?.apiKey).toBe('sk-account');
  });

  it('cancelled Google sheet: nothing happens', async () => {
    const { s, calls } = service(backend(), [null]);
    expect(await s.signIn()).toEqual({ ok: false, reason: 'cancelled' });
    expect(calls).toEqual([]);
  });

  it('a disabled or exhausted account is reported, nothing saved', async () => {
    const disabled = service(backend({ sessionStatus: 403, sessionError: 'disabled' }));
    expect(await disabled.s.signIn()).toEqual({ ok: false, reason: 'disabled' });
    expect(disabled.secrets.data.size).toBe(0);
    const exhausted = service(backend({ sessionStatus: 403, sessionError: 'exhausted' }));
    expect(await exhausted.s.signIn()).toEqual({ ok: false, reason: 'exhausted' });
  });

  it('a rejected Google token surfaces as a failure with Firebase\'s code', async () => {
    const { s } = service(backend(), ['google-bad']);
    expect(await s.signIn()).toEqual({ ok: false, reason: 'failed', detail: 'FirebaseAuthError: INVALID_IDP_RESPONSE' });
  });

  it('renews the key with a refreshed Firebase token once the old one expires', async () => {
    let t = 0;
    const { s, calls, secrets } = service(backend(), ['google-ok'], () => t);
    await s.signIn();
    t = 2 * 3600 * 1000;
    expect(await s.renewLlmKey()).toEqual({ baseUrl: 'https://x/llm/v1', apiKey: 'sk-account', model: 'obdient-chat' });
    expect(calls).toContain('POST https://securetoken.googleapis.com/v1/token');
    expect(JSON.parse(secrets.data.get('obdient2.account')!).refreshToken).toBe('fb-refresh-2');
  });

  it('signs out: secrets gone, Google signed out', async () => {
    const { s, secrets, google } = service();
    await s.signIn();
    await s.signOut();
    expect(secrets.data.size).toBe(0);
    expect(s.profile()).toBeNull();
    expect(google.signOut).toHaveBeenCalled();
  });

  it('deletes the account: key revoked, Firebase account deleted, signed out', async () => {
    const { s, calls, secrets } = service();
    await s.signIn();
    expect(await s.deleteAccount()).toEqual({ ok: true });
    expect(calls).toEqual(expect.arrayContaining([`DELETE ${AUTH}/v1/account`, 'POST https://identitytoolkit.googleapis.com/v1/accounts:delete']));
    expect(secrets.data.size).toBe(0);
  });

  it('a sign-in too old to delete asks Google again, then deletes', async () => {
    const { s, google, calls } = service(backend({ deleteError: 'CREDENTIAL_TOO_OLD_LOGIN_AGAIN' }), ['google-ok', 'google-ok']);
    await s.signIn();
    expect(await s.deleteAccount()).toEqual({ ok: true });
    expect(google.idToken).toHaveBeenCalledTimes(2);
    expect(calls.filter((c) => c.endsWith('accounts:delete'))).toHaveLength(2);
  });

  it('an unreadable saved account means signed out, not a crash', async () => {
    const { s, secrets } = service();
    secrets.data.set('obdient2.account', '{broken');
    expect(await s.restore()).toBeNull();
  });
});

describe('FirebaseRest', () => {
  it('reports Firebase error codes', async () => {
    const f = fakeFetch(() => ({ status: 400, body: { error: { message: 'TOKEN_EXPIRED' } } }));
    await expect(new FirebaseRest('K', f.fn).refresh('r')).rejects.toEqual(new FirebaseAuthError('TOKEN_EXPIRED'));
  });
});
