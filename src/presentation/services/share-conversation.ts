// Shares a conversation as a JSON file (Android's share sheet: WhatsApp,
// mail, Drive…), to report a wrong answer. Photos are left out.

import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { Conversation } from '@/domain/assistant/conversation';
import { exportConversation, exportFileName } from '@/domain/assistant/conversation-export';

export async function shareConversation(c: Conversation): Promise<void> {
  const file = new File(Paths.cache, exportFileName(c));
  if (file.exists) file.delete();
  file.create();
  file.write(exportConversation(c, Date.now(), Constants.expoConfig?.version ?? '?'));
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: c.title });
}
