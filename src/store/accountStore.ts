// The signed-in account as the screens see it. The secrets stay in
// AccountService / SecureStore; this only holds who is signed in.

import { create } from 'zustand';
import type { AccountProfile } from '@/data/auth/account-service';

export type AccountStatus = 'loading' | 'signed-out' | 'signed-in';

interface AccountState {
  status: AccountStatus;
  profile: AccountProfile | null;
  busy: boolean;
  error: string | null;
  setProfile: (profile: AccountProfile | null) => void;
  setBusy: (busy: boolean) => void;
  setError: (error: string | null) => void;
}

export const useAccountStore = create<AccountState>()((set) => ({
  status: 'loading',
  profile: null,
  busy: false,
  error: null,
  setProfile: (profile) => set({ profile, status: profile ? 'signed-in' : 'signed-out' }),
  setBusy: (busy) => set({ busy }),
  setError: (error) => set({ error }),
}));
