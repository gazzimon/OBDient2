// Engine-sound references, one per car (by VIN, or one shared without a VIN):
// only the fingerprint, never the audio. Own MMKV instance, wiped with the account.

import { createMMKV } from 'react-native-mmkv';
import type { SoundPrint } from '@/domain/sound/engine-sound';

const mmkv = createMMKV({ id: 'obdient2-engine-sound' });
const key = (vin: string | null) => `ref:${vin ?? '_'}`;

export const engineSoundStore = {
  reference(vin: string | null): SoundPrint | null {
    try {
      const raw = mmkv.getString(key(vin));
      return raw ? (JSON.parse(raw) as SoundPrint) : null;
    } catch {
      return null;
    }
  },
  setReference(vin: string | null, print: SoundPrint): void {
    mmkv.set(key(vin), JSON.stringify(print));
  },
};
