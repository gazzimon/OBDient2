// The user's account (ADR-0008): email code login (IdentityPort, Magic today)
// → the account's key for the model from obdient-auth, kept in SecureStore.
//
// The key is fetched once and reused; it is asked for again only when the
// model rejects it (renewLlmKey). Nothing here is needed to drive: without an
// account everything but the assistant works (ADR-0001).

export interface IdentityPort {
  // Sends the code and runs the provider's screens; null if the user cancelled.
  signIn(email: string): Promise<{ idToken: string; email: string } | null>;
  // A fresh token for the server, or null if the session ended.
  idToken(): Promise<string | null>;
  signOut(): Promise<void>;
}

export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface LlmCredentials {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

export interface AccountProfile {
  readonly email: string;
}

interface Stored extends AccountProfile {
  readonly llm: LlmCredentials;
}

export type SignInResult =
  | { readonly ok: true; readonly profile: AccountProfile }
  | {
      readonly ok: false;
      readonly reason: 'cancelled' | 'invalid_email' | 'disabled' | 'exhausted' | 'network' | 'failed';
      readonly detail?: string;
    };

const KEY = 'obdient2.account';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class AccountService {
  private stored: Stored | null = null;

  constructor(
    private readonly deps: {
      readonly identity: IdentityPort;
      readonly secrets: SecretStore;
      readonly authUrl: string;
      // obdient-tools: asked to forget the person's contributions before the key is revoked.
      readonly toolsUrl?: string;
      // Erases what the phone keeps (chats, trips, faults, service log) once the account is gone.
      readonly wipeLocal?: () => Promise<void> | void;
      readonly fetchFn?: typeof fetch;
    },
  ) {}

  private get fetchFn(): typeof fetch {
    return this.deps.fetchFn ?? fetch;
  }

  // Reads the saved account; no network. Call once at start.
  async restore(): Promise<AccountProfile | null> {
    try {
      const raw = await this.deps.secrets.get(KEY);
      const s = raw ? (JSON.parse(raw) as Partial<Stored>) : null;
      // Accounts from the Google sign-in (before 2026-10-18) had no email field.
      this.stored = s?.email && s.llm ? (s as Stored) : null;
    } catch {
      this.stored = null; // unreadable (e.g. keystore reset): the user signs in again
    }
    return this.profile();
  }

  profile(): AccountProfile | null {
    return this.stored ? { email: this.stored.email } : null;
  }

  llmCredentials(): LlmCredentials | null {
    return this.stored?.llm ?? null;
  }

  async signIn(email: string): Promise<SignInResult> {
    const address = email.trim().toLowerCase();
    if (!EMAIL.test(address)) return { ok: false, reason: 'invalid_email' };
    let session: { idToken: string; email: string } | null;
    try {
      session = await this.deps.identity.signIn(address);
    } catch (err) {
      return { ok: false, reason: err instanceof TypeError ? 'network' : 'failed', detail: describe(err) };
    }
    if (!session) return { ok: false, reason: 'cancelled' };
    try {
      const llm = await this.exchange(session.idToken);
      if ('error' in llm) return { ok: false, reason: llm.error };
      await this.save({ email: session.email.toLowerCase(), llm });
      return { ok: true, profile: this.profile()! };
    } catch (err) {
      return { ok: false, reason: err instanceof TypeError ? 'network' : 'failed', detail: describe(err) };
    }
  }

  // The model said 401: the key was rotated or revoked. Ask for it again.
  async renewLlmKey(): Promise<LlmCredentials | null> {
    if (!this.stored) return null;
    const idToken = await this.deps.identity.idToken().catch(() => null);
    if (!idToken) return null;
    const llm = await this.exchange(idToken);
    if ('error' in llm) return null;
    await this.save({ ...this.stored, llm });
    return llm;
  }

  async signOut(): Promise<void> {
    this.stored = null;
    await this.deps.secrets.remove(KEY);
    await this.deps.identity.signOut();
  }

  // Revokes the account's model key, then signs out. Needs a live session.
  async deleteAccount(): Promise<{ ok: true } | { ok: false; reason: 'session_expired' | 'failed'; detail?: string }> {
    if (!this.stored) return { ok: true };
    try {
      const idToken = await this.deps.identity.idToken();
      if (!idToken) return { ok: false, reason: 'session_expired' };
      // 1) The lab's shared base stops naming the person. Needs the key, so it goes first.
      //    A 401 means the key is already revoked (a half-done earlier attempt): go on.
      if (this.deps.toolsUrl) {
        const r = await this.fetchFn(`${this.deps.toolsUrl.replace(/\/$/, '')}/v1/forget`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.stored.llm.apiKey}`, 'Content-Type': 'application/json' },
          body: '{}',
        });
        if (!r.ok && r.status !== 401) return { ok: false, reason: 'failed', detail: `tools ${r.status}` };
      }
      // 2) The account and its model key.
      const res = await this.fetchFn(`${this.deps.authUrl}/v1/account`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (res.status !== 204 && res.status !== 200) return { ok: false, reason: 'failed', detail: `auth ${res.status}` };
      // 3) The phone: the session first, then every local copy of the person's data.
      await this.signOut();
      await this.deps.wipeLocal?.();
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: 'failed', detail: describe(err) };
    }
  }

  private async exchange(idToken: string): Promise<LlmCredentials | { error: 'disabled' | 'exhausted' | 'failed' }> {
    const res = await this.fetchFn(`${this.deps.authUrl}/v1/session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 403) return { error: body.error === 'exhausted' ? 'exhausted' : 'disabled' };
    if (!res.ok || typeof body.apiKey !== 'string') return { error: 'failed' };
    return { baseUrl: String(body.baseUrl), apiKey: body.apiKey, model: String(body.model) };
  }

  private async save(s: Stored): Promise<void> {
    this.stored = s;
    await this.deps.secrets.set(KEY, JSON.stringify(s));
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}
