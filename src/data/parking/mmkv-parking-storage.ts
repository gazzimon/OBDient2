// Where each car was left ("dónde estacioné"), on the phone only. Own MMKV
// instance, wiped with the account.

import { createMMKV } from 'react-native-mmkv';
import type { ParkingSpot, ParkingStorage } from '@/domain/parking/parking';

const KEY = 'spots';

export function createMmkvParkingStorage(): ParkingStorage {
  const mmkv = createMMKV({ id: 'obdient2-parking' });
  return {
    load() {
      try {
        const raw = mmkv.getString(KEY);
        return raw ? (JSON.parse(raw) as ParkingSpot[]) : [];
      } catch {
        return [];
      }
    },
    save(spots) {
      mmkv.set(KEY, JSON.stringify(spots));
    },
  };
}
