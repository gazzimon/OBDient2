// The 0–100 runs and each car's mass, on the phone (own MMKV instance, wiped
// with the account).

import { createMMKV } from 'react-native-mmkv';
import type { RunResult } from '@/domain/performance/acceleration';

export interface SavedRun {
  readonly at: number;
  readonly vin: string | null;
  readonly massKg: number | null;
  readonly result: RunResult;
}

const MAX_RUNS = 30;
const mmkv = createMMKV({ id: 'obdient2-performance' });

function read<T>(key: string, fallback: T): T {
  try {
    const raw = mmkv.getString(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export const performanceStore = {
  // The mass last used for this car (or for any, without a VIN).
  massFor(vin: string | null): number | null {
    return read<Record<string, number>>('mass', {})[vin ?? '_'] ?? null;
  },
  setMass(vin: string | null, kg: number): void {
    mmkv.set('mass', JSON.stringify({ ...read<Record<string, number>>('mass', {}), [vin ?? '_']: kg }));
  },
  runs(vin: string | null): SavedRun[] {
    return read<SavedRun[]>('runs', []).filter((r) => r.vin === vin);
  },
  add(run: SavedRun): void {
    mmkv.set('runs', JSON.stringify([run, ...read<SavedRun[]>('runs', [])].slice(0, MAX_RUNS)));
  },
};
