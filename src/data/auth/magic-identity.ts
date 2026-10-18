// Email code login with Magic (ADR-0008): the only file that knows the
// provider. Magic shows its own screens for the code and, on a phone it has
// not seen, sends an email to approve the device. Moving to another provider
// (Supabase past 1,000 users) means replacing this file.

import Constants from 'expo-constants';
import { Magic } from '@magic-sdk/react-native-expo';
import type { IdentityPort } from './account-service';

const publishableKey = (Constants.expoConfig?.extra as { magicPublishableKey: string }).magicPublishableKey;

export const magic = new Magic(publishableKey);

// Magic's screens live in a hidden WebView; render once at the app root.
export const MagicRelayer = magic.Relayer;

// Error codes Magic uses when the user closes its screen.
const CANCELLED = /cancel|reject|closed/i;

export const magicIdentity: IdentityPort = {
  async signIn(email) {
    try {
      const idToken = await magic.auth.loginWithEmailOTP({ email });
      if (!idToken) return null;
      const info = await magic.user.getInfo();
      return { idToken, email: info.email ?? email };
    } catch (err) {
      const code = String((err as { code?: unknown }).code ?? (err as Error).message ?? '');
      if (CANCELLED.test(code)) return null;
      throw err;
    }
  },
  // A fresh token while Magic's session lasts; null when the user must log in again.
  async idToken() {
    if (!(await magic.user.isLoggedIn())) return null;
    return magic.user.getIdToken({ lifespan: 900 });
  },
  async signOut() {
    await magic.user.logout().catch(() => undefined);
  },
};
