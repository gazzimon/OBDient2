// The user's account (ADR-0008): Google sign-in → Firebase session → the
// account's key for the model from obdient-auth, all kept in SecureStore.
//
// The key is fetched once and reused; it is asked for again only when the
// model rejects it (renewLlmKey). Nothing here is needed to drive: without an
// account everything but the assistant works (ADR-0001).

import { FirebaseAuthError, type FirebaseRest } from './firebase-rest';

export interface GoogleSignInPort {
  // Google ID token, or null if the user cancelled.
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
  readonly uid: string;
  readonly email: string | null;
  readonly name: string | null;
}

interface Stored extends AccountProfile {
  readonly refreshToken: string;
  readonly llm: LlmCredentials;
}

export type SignInResult =
  | { readonly ok: true; readonly profile: AccountProfile }
  | { readonly ok: false; readonly reason: 'cancelled' | 'disabled' | 'exhausted' | 'network' | 'failed'; readonly detail?: string };

const KEY = 'obdient2.account';
const REFRESH_MARGIN_MS = 60_000;

export class AccountService {
  private stored: Stored | null = null;
  private idToken: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly deps: {
      readonly google: GoogleSignInPort;
      readonly firebase: FirebaseRest;
      readonly secrets: SecretStore;
      readonly authUrl: string;
      readonly fetchFn?: typeof fetch;
      readonly now?: () => number;
    },
  ) {}

  private get fetchFn(): typeof fetch {
    return this.deps.fetchFn ?? fetch;
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  // Reads the saved account; no network. Call once at start.
  async restore(): Promise<AccountProfile | null> {
    try {
      const raw = await this.deps.secrets.get(KEY);
      this.stored = raw ? (JSON.parse(raw) as Stored) : null;
    } catch {
      this.stored = null; // unreadable (e.g. keystore reset): the user signs in again
    }
    return this.profile();
  }

  profile(): AccountProfile | null {
    const s = this.stored;
    return s ? { uid: s.uid, email: s.email, name: s.name } : null;
  }

  llmCredentials(): LlmCredentials | null {
    return this.stored?.llm ?? null;
  }

  async signIn(): Promise<SignInResult> {
    let googleToken: string | null;
    try {
      googleToken = await this.deps.google.idToken();
    } catch (err) {
      return { ok: false, reason: 'failed', detail: describe(err) };
    }
    if (!googleToken) return { ok: false, reason: 'cancelled' };
    try {
      const session = await this.deps.firebase.signInWithGoogle(googleToken);
      this.idToken = { value: session.idToken, expiresAt: session.expiresAt };
      const llm = await this.exchange(session.idToken);
      if ('error' in llm) return { ok: false, reason: llm.error };
      await this.save({ uid: session.uid, email: session.email, name: session.name, refreshToken: session.refreshToken, llm });
      return { ok: true, profile: this.profile()! };
    } catch (err) {
      return { ok: false, reason: err instanceof TypeError ? 'network' : 'failed', detail: describe(err) };
    }
  }

  // The model said 401: the key was rotated or revoked. Ask for it again.
  async renewLlmKey(): Promise<LlmCredentials | null> {
    if (!this.stored) return null;
    const llm = await this.exchange(await this.freshIdToken());
    if ('error' in llm) return null;
    await this.save({ ...this.stored, llm });
    return llm;
  }

  async signOut(): Promise<void> {
    this.stored = null;
    this.idToken = null;
    await this.deps.secrets.remove(KEY);
    await this.deps.google.signOut();
  }

  // Revokes the model key, deletes the Firebase account, signs out. Firebase
  // wants a recent sign-in to delete: if it is too old, Google is asked again.
  async deleteAccount(): Promise<{ ok: true } | { ok: false; reason: 'cancelled' | 'failed'; detail?: string }> {
    if (!this.stored) return { ok: true };
    try {
      let idToken = await this.freshIdToken();
      const res = await this.fetchFn(`${this.deps.authUrl}/v1/account`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (res.status !== 204 && res.status !== 200) return { ok: false, reason: 'failed', detail: `auth ${res.status}` };
      try {
        await this.deps.firebase.deleteAccount(idToken);
      } catch (err) {
        if (!(err instanceof FirebaseAuthError) || err.code !== 'CREDENTIAL_TOO_OLD_LOGIN_AGAIN') throw err;
        const google = await this.deps.google.idToken();
        if (!google) return { ok: false, reason: 'cancelled' };
        idToken = (await this.deps.firebase.signInWithGoogle(google)).idToken;
        await this.deps.firebase.deleteAccount(idToken);
      }
      await this.signOut();
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: 'failed', detail: describe(err) };
    }
  }

  private async freshIdToken(): Promise<string> {
    if (this.idToken && this.idToken.expiresAt - REFRESH_MARGIN_MS > this.now()) return this.idToken.value;
    if (!this.stored) throw new Error('not signed in');
    const r = await this.deps.firebase.refresh(this.stored.refreshToken);
    this.idToken = { value: r.idToken, expiresAt: r.expiresAt };
    if (r.refreshToken !== this.stored.refreshToken) await this.save({ ...this.stored, refreshToken: r.refreshToken });
    return r.idToken;
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
