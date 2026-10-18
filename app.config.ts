// Variants of the same app (app.json is the base).
//
// APP_VARIANT=development (eas.json "development" profile) installs next to the
// normal app as "OBDient2 Dev": its own package, name, scheme and an amber
// "DEV" icon, so the two are never confused on the phone.

import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const base = config as ExpoConfig;
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
