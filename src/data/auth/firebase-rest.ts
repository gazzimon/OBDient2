// Firebase Authentication over its REST API (Identity Toolkit + Secure Token).
//
// Three calls are all the app needs: turn a Google ID token into a Firebase
// session, refresh that session, and delete the account. The REST API avoids
// the JS SDK's persistence setup in React Native; the session lives in
// SecureStore (account-service.ts). Firestore (history sync) is a later step.

const IDENTITY = 'https://identitytoolkit.googleapis.com/v1';
const SECURE_TOKEN = 'https://securetoken.googleapis.com/v1/token';

export interface FirebaseSession {
  readonly uid: string;
  readonly email: string | null;
  readonly name: string | null;
  readonly idToken: string;
  readonly refreshToken: string;
  // Epoch ms when idToken expires.
  readonly expiresAt: number;
}

// Firebase's error code, e.g. CREDENTIAL_TOO_OLD_LOGIN_AGAIN, TOKEN_EXPIRED.
export class FirebaseAuthError extends Error {
  name = 'FirebaseAuthError';
  constructor(readonly code: string) {
    super(code);
  }
}

type Fetch = typeof fetch;

export class FirebaseRest {
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: Fetch = fetch,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async signInWithGoogle(googleIdToken: string): Promise<FirebaseSession> {
    const r = await this.post(`${IDENTITY}/accounts:signInWithIdp`, {
      postBody: `id_token=${encodeURIComponent(googleIdToken)}&providerId=google.com`,
      requestUri: 'http://localhost',
      returnIdpCredential: true,
      returnSecureToken: true,
    });
    return {
      uid: String(r.localId),
      email: typeof r.email === 'string' ? r.email : null,
      name: typeof r.displayName === 'string' ? r.displayName : null,
      idToken: String(r.idToken),
      refreshToken: String(r.refreshToken),
      expiresAt: this.now() + Number(r.expiresIn ?? 3600) * 1000,
    };
  }

  // A fresh ID token from the long-lived refresh token.
  async refresh(refreshToken: string): Promise<{ idToken: string; refreshToken: string; expiresAt: number }> {
    const res = await this.fetchFn(`${SECURE_TOKEN}?key=${this.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
    });
    const r = await this.json(res);
    return {
      idToken: String(r.id_token),
      refreshToken: String(r.refresh_token),
      expiresAt: this.now() + Number(r.expires_in ?? 3600) * 1000,
    };
  }

  // Needs a recent sign-in: CREDENTIAL_TOO_OLD_LOGIN_AGAIN otherwise.
  async deleteAccount(idToken: string): Promise<void> {
    await this.post(`${IDENTITY}/accounts:delete`, { idToken });
  }

  private async post(url: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await this.fetchFn(`${url}?key=${this.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return this.json(res);
  }

  private async json(res: Response): Promise<Record<string, unknown>> {
    const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const err = out.error as { message?: unknown } | string | undefined;
      const message = typeof err === 'string' ? err : String(err?.message ?? `HTTP_${res.status}`);
      // "INVALID_IDP_RESPONSE : details" → the code only.
      throw new FirebaseAuthError(message.split(' ')[0]!);
    }
    return out;
  }
}
