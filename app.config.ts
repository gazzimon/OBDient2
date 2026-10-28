// Variants of the same app (app.json is the base).
//
// APP_VARIANT=development (eas.json "development" profile) installs next to the
// normal app as "OBDient2 Dev": its own package, name, scheme and an amber
// "DEV" icon, so the two are never confused on the phone.

import type { ConfigContext, ExpoConfig } from 'expo/config';

const AUTH_URL = 'https://obdient.duckdns.org/auth';
// The assistant's tools that need internet (obdient-tools: web search).
const TOOLS_URL = 'https://obdient.duckdns.org/tools';
// Magic (email code login, ADR-0008). Publishable, but not kept in git: set MAGIC_PUBLISHABLE_KEY
// in the build environment (EAS env var, or .env.local for local builds; see .env.example).
const MAGIC_PUBLISHABLE_KEY = process.env.MAGIC_PUBLISHABLE_KEY ?? '';

export default ({ config }: ConfigContext): ExpoConfig => {
  if (!MAGIC_PUBLISHABLE_KEY) throw new Error('MAGIC_PUBLISHABLE_KEY is not set (see .env.example).');
  const withAccounts = config as ExpoConfig;
  const base: ExpoConfig = {
    ...withAccounts,
    extra: { ...withAccounts.extra, authUrl: AUTH_URL, toolsUrl: TOOLS_URL, magicPublishableKey: MAGIC_PUBLISHABLE_KEY },
  };
  // Partner build (mecánicos socios de OBDient, FIUI): private APK, apart from the public app.
  // Own package, name and scheme, so it installs next to either of the others.
  if (process.env.APP_VARIANT === 'socios') {
    return {
      ...base,
      name: 'OBDient FIUI Socios',
      scheme: 'obdient2-socios',
      icon: './assets/socios/icon.png',
      web: { ...base.web, favicon: './assets/socios/favicon.png' },
      android: {
        ...base.android,
        package: 'com.obdient.obdient2.socios',
        adaptiveIcon: {
          ...base.android?.adaptiveIcon,
          foregroundImage: './assets/socios/android-icon-foreground.png',
          backgroundImage: './assets/socios/android-icon-background.png',
          monochromeImage: './assets/socios/android-icon-monochrome.png',
        },
      },
    };
  }
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
