// The service log in MMKV (its own store, like the fault history).

import { createMMKV } from 'react-native-mmkv';
import type { ServiceEntry, ServiceStorage } from '@/domain/service/service-log';

const KEY = 'entries.v1';

export function createMmkvServiceStorage(): ServiceStorage {
  const mmkv = createMMKV({ id: 'obdient2-service' });
  return {
    load: () => {
      try {
        const raw = mmkv.getString(KEY);
        return raw ? (JSON.parse(raw) as ServiceEntry[]) : [];
      } catch {
        return [];
      }
    },
    save: (entries) => mmkv.set(KEY, JSON.stringify(entries)),
  };
}
