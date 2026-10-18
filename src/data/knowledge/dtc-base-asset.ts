// Reads the bundled trouble-code base from disk (expo-asset copies it out of
// the APK; Metro serves it in development).

import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import type { DtcBase } from './dtc-base';

export async function loadDtcBaseAsset(): Promise<DtcBase> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const asset = await Asset.fromModule(require('../../../assets/dtc/obdex.dtcdb')).downloadAsync();
  if (!asset.localUri) throw new Error('dtc base: no local file');
  return JSON.parse(await new File(asset.localUri).text()) as DtcBase;
}
