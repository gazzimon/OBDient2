// The fault history's storage on the phone: one JSON document in its own MMKV
// instance, apart from the settings, so clearing one never touches the other.

import { createMMKV } from 'react-native-mmkv';
import type { FaultHistoryStorage } from '@/domain/faults/fault-history';

const KEY = 'events';

export function createMmkvFaultStorage(): FaultHistoryStorage {
  const mmkv = createMMKV({ id: 'obdient2-faults' });
  return {
    load: () => mmkv.getString(KEY) ?? null,
    save: (json) => mmkv.set(KEY, json),
  };
}
