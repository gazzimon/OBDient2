// The cars' baselines on the phone: one JSON document in its own MMKV
// instance, like the fault history, so the account wipe can clear it alone.

import { createMMKV } from 'react-native-mmkv';
import type { BaselineStorage } from '@/domain/vehicle/baseline';

export const BASELINE_STORE_ID = 'obdient2-baseline';
const KEY = 'cars';

export function createMmkvBaselineStorage(): BaselineStorage {
  const mmkv = createMMKV({ id: BASELINE_STORE_ID });
  return {
    load: () => mmkv.getString(KEY) ?? null,
    save: (json) => mmkv.set(KEY, json),
  };
}
