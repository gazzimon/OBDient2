// The saved reports' list, on the phone only. Own MMKV instance, wiped with the
// account (the PDFs themselves live in documents/informes).

import { createMMKV } from 'react-native-mmkv';
import type { SavedReport, SavedReportStorage } from '@/domain/report/saved-reports';

const KEY = 'reports';

export function createMmkvSavedReports(): SavedReportStorage {
  const mmkv = createMMKV({ id: 'obdient2-reports' });
  return {
    load() {
      try {
        const raw = mmkv.getString(KEY);
        return raw ? (JSON.parse(raw) as SavedReport[]) : [];
      } catch {
        return [];
      }
    },
    save(reports) {
      mmkv.set(KEY, JSON.stringify(reports));
    },
  };
}
