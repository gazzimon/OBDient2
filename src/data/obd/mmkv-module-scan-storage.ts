// The module scans' reports, on the phone only. Own MMKV instance, wiped with the account.

import { createMMKV } from 'react-native-mmkv';
import type { ModuleScanReport, ModuleScanStorage } from '@/domain/obd/module-scan-report';

const KEY = 'reports';

export function createMmkvModuleScanStorage(): ModuleScanStorage {
  const mmkv = createMMKV({ id: 'obdient2-module-scans' });
  return {
    load() {
      try {
        const raw = mmkv.getString(KEY);
        return raw ? (JSON.parse(raw) as ModuleScanReport[]) : [];
      } catch {
        return [];
      }
    },
    save(reports) {
      mmkv.set(KEY, JSON.stringify(reports));
    },
  };
}
