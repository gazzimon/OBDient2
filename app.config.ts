// Variants of the same app (app.json is the base).
//
// APP_VARIANT=development (eas.json "development" profile) installs next to the
// normal app as "OBDient2 Dev": its own package, name, scheme and an amber
// "DEV" icon, so the two are never confused on the phone.

//
// Accounts (ADR-0008): the Firebase project and its web API key come from
// google-services.json, the same file the Google sign-in plugin reads, so they
// cannot drift apart. The key is not a secret (it ships in every Firebase app).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConfigContext, ExpoConfig } from 'expo/config';

const AUTH_URL = 'https://obdient.duckdns.org/auth';

function firebaseExtra() {
  const gs = JSON.parse(readFileSync(join(__dirname, 'google-services.json'), 'utf8'));
  return {
    projectId: gs.project_info.project_id as string,
    apiKey: gs.client[0].api_key[0].current_key as string,
  };
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const withAccounts = config as ExpoConfig;
  const base: ExpoConfig = {
    ...withAccounts,
    extra: { ...withAccounts.extra, firebase: firebaseExtra(), authUrl: AUTH_URL },
  };
  if (process.env.APP_VARIANT !== 'development') return base;
  return {
    ...base,
    name: 'OBDient2 Dev',
    scheme: 'obdient2-dev',
    icon: './assets/dev/icon.png',
    android: {
      ...base.android,
      package: 'com.obdient.obdient2.dev',
      adaptiveIcon: {
        ...base.android?.adaptiveIcon,
        foregroundImage: './assets/dev/android-icon-foreground.png',
        backgroundImage: './assets/dev/android-icon-background.png',
        monochromeImage: './assets/dev/android-icon-monochrome.png',
      },
    },
  };
};
