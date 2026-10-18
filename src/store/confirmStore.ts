// The on-screen confirmation for destructive tool calls (ConfirmationPort):
// the agent loop waits on `confirm`, the modal answers it (M3.2).

import { create } from 'zustand';
import type { ToolCall } from '@/domain/assistant/tools';
import type { ConfirmationPort } from '@/domain/ports/vehicle-tools.port';

interface ConfirmState {
  request: { readonly call: ToolCall; readonly resolve: (ok: boolean) => void } | null;
  answer: (ok: boolean) => void;
}

export const useConfirmStore = create<ConfirmState>()((set, get) => ({
  request: null,
  answer: (ok) => {
    get().request?.resolve(ok);
    set({ request: null });
  },
}));

export const screenConfirmation: ConfirmationPort = {
  confirm: (call) =>
    new Promise<boolean>((resolve) => {
      // A pending one (should not happen: one tool at a time) is declined.
      useConfirmStore.getState().request?.resolve(false);
      useConfirmStore.setState({ request: { call, resolve } });
    }),
};
