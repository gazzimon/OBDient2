// The assistant's conversations (M3), persisted in MMKV. The pure transitions
// live in domain/assistant/conversation.ts; this store only holds the list and
// which one is open. Encryption is postponed (ADR-0007 §9).

import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { createMMKV } from 'react-native-mmkv';
import { newConversation, upsertConversation, type Conversation } from '@/domain/assistant/conversation';

const mmkv = createMMKV({ id: 'obdient2-chat' });
const storage: StateStorage = {
  getItem: (name) => mmkv.getString(name) ?? null,
  setItem: (name, value) => mmkv.set(name, value),
  removeItem: (name) => {
    mmkv.remove(name);
  },
};

// Bump when Conversation changes shape, and migrate below.
export const CHAT_STORE_VERSION = 1;

interface ChatState {
  conversations: Conversation[];
  // Not persisted: the app opens on the start screen (decision 2026-10-31), and
  // an earlier conversation is one tap away in the list.
  activeId: string | null;
  // Not persisted: the conversation with a turn in flight.
  runningId: string | null;

  active: () => Conversation | null;
  save: (c: Conversation) => void;
  open: (id: string) => void;
  startNew: (id: string, now: number) => Conversation;
  remove: (id: string) => void;
  setRunning: (id: string | null) => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeId: null,
      runningId: null,

      active: () => get().conversations.find((c) => c.id === get().activeId) ?? null,
      save: (c) => set((s) => ({ conversations: upsertConversation(s.conversations, c) })),
      open: (id) => set({ activeId: id }),
      startNew: (id, now) => {
        const c = newConversation(id, now);
        set((s) => ({ conversations: upsertConversation(s.conversations, c), activeId: id }));
        return c;
      },
      remove: (id) =>
        set((s) => ({
          conversations: s.conversations.filter((c) => c.id !== id),
          activeId: s.activeId === id ? null : s.activeId,
        })),
      setRunning: (id) => set({ runningId: id }),
    }),
    {
      name: 'obdient2-chat',
      version: CHAT_STORE_VERSION,
      storage: createJSONStorage(() => storage),
      partialize: (s) => ({ conversations: s.conversations }),
      // Phones saved the open one before: only the conversations are read back.
      merge: (persisted, current) => ({ ...current, conversations: (persisted as Partial<ChatState> | undefined)?.conversations ?? [] }),
      // Unknown older shapes are dropped rather than half-read.
      migrate: (persisted, version) =>
        version === CHAT_STORE_VERSION ? { conversations: (persisted as Pick<ChatState, 'conversations'>).conversations, activeId: null } : { conversations: [], activeId: null },
    },
  ),
);
