// Google sign-in on the phone: Android Credential Manager through
// react-native-nitro-google-signin. The web client ID comes from
// google-services.json ("autoDetect"); Firebase accepts the resulting ID token.

import { GoogleOneTapSignIn, isSuccessResponse } from 'react-native-nitro-google-signin';
import type { GoogleSignInPort } from './account-service';

let configured = false;

function ensureConfigured(): void {
  if (configured) return;
  GoogleOneTapSignIn.configure({ webClientId: 'autoDetect', scopes: ['email', 'profile'] });
  configured = true;
}

export const googleSignIn: GoogleSignInPort = {
  // An account already used with the app signs in with one tap; otherwise the
  // sheet with every account on the phone. null when the user backs out.
  async idToken() {
    ensureConfigured();
    let res = await GoogleOneTapSignIn.signIn();
    if (res.type === 'noSavedCredentialFound') res = await GoogleOneTapSignIn.createAccount();
    return isSuccessResponse(res) ? res.data.idToken : null;
  },
  async signOut() {
    ensureConfigured();
    await GoogleOneTapSignIn.signOut().catch(() => undefined);
  },
};
