// Account deleted: everything the phone keeps about the person goes too (chats,
// trips, fault history, service log, the cars' baselines, engine-sound
// references, acceleration runs, where each car was left, the module scans and the saved reports). Settings and permission flags stay: they
// say nothing about the person. The Keystore entry is removed by AccountService.

import { createMMKV } from 'react-native-mmkv';
import { Directory, Paths } from 'expo-file-system';
import { container } from '@/data/container';
import { useChatStore } from '@/store/chatStore';
import { trips } from '@/presentation/services/my-trips';

const PERSONAL_STORES = ['obdient2-chat', 'obdient2-faults', 'obdient2-service', 'obdient2-baseline', 'obdient2-engine-sound', 'obdient2-performance', 'obdient2-parking', 'obdient2-module-scans', 'obdient2-reports'] as const;

export async function wipeLocalData(): Promise<void> {
  trips.clear();
  const reports = new Directory(Paths.document, 'informes');
  if (reports.exists) reports.delete();
  container.baselines.clear();
  for (const id of PERSONAL_STORES) createMMKV({ id }).clearAll();
  useChatStore.setState({ conversations: [], activeId: null, runningId: null });
}
