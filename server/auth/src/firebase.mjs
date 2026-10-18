// Verifies a Firebase Authentication ID token: RS256 signature against
// Google's published keys, issuer and audience of our project, a subject, and
// an auth time in the past. Only the token is needed: no service account.

import { createRemoteJWKSet, jwtVerify } from 'jose';

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const CLOCK_SKEW_S = 60;

export class InvalidIdToken extends Error {
  name = 'InvalidIdToken';
}

// Returns verify(idToken) → { uid, email, provider }.
export function firebaseVerifier(projectId, { jwks = createRemoteJWKSet(new URL(JWKS_URL)) } = {}) {
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID is required');
  return async (idToken) => {
    let payload;
    try {
      ({ payload } = await jwtVerify(idToken, jwks, {
        issuer: `https://securetoken.google.com/${projectId}`,
        audience: projectId,
        algorithms: ['RS256'],
        clockTolerance: CLOCK_SKEW_S,
      }));
    } catch (err) {
      throw new InvalidIdToken(err.code ?? 'invalid');
    }
    const uid = payload.sub;
    if (typeof uid !== 'string' || uid === '' || uid.length > 128) throw new InvalidIdToken('subject');
    if (typeof payload.auth_time !== 'number' || payload.auth_time > Date.now() / 1000 + CLOCK_SKEW_S) {
      throw new InvalidIdToken('auth_time');
    }
    return {
      uid,
      email: typeof payload.email === 'string' ? payload.email : null,
      provider: payload.firebase?.sign_in_provider ?? null,
    };
  };
}
