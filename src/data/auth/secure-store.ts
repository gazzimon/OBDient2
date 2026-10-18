// SecretStore on the phone: expo-secure-store (Android Keystore). Not backed up
// (allowBackup: false), gone on uninstall: the user signs in again.

import * as SecureStore from 'expo-secure-store';
import type { SecretStore } from './account-service';

export const secureStore: SecretStore = {
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value),
  remove: (key) => SecureStore.deleteItemAsync(key),
};
