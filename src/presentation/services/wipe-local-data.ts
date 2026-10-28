// Account deleted: everything the phone keeps about the person goes too (chats,
// trips, fault history, service log). Settings and permission flags stay: they
// say nothing about the person. The Keystore entry is removed by AccountService.

import { createMMKV } from 'react-native-mmkv';
import { useChatStore } from '@/store/chatStore';
import { trips } from '@/presentation/services/my-trips';

const PERSONAL_STORES = ['obdient2-chat', 'obdient2-faults', 'obdient2-service'] as const;

export async function wipeLocalData(): Promise<void> {
  trips.clear();
  for (const id of PERSONAL_STORES) createMMKV({ id }).clearAll();
  useChatStore.setState({ conversations: [], activeId: null, runningId: null });
}
