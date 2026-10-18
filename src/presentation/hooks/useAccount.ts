// Account actions for the screens: they call AccountService and mirror the
// result in accountStore, with errors worded for the user.

import { container } from '@/data/container';
import { useAccountStore } from '@/store/accountStore';

const SIGN_IN_ERROR: Record<string, string> = {
  disabled: 'Tu cuenta está deshabilitada para el asistente. Escribinos para revisarla.',
  exhausted: 'Tu cuenta agotó su cupo del asistente.',
  network: 'Sin conexión. Probá de nuevo cuando tengas señal.',
  failed: 'No se pudo iniciar sesión. Probá de nuevo.',
};

// At start: who was signed in, without network.
export async function restoreAccount(): Promise<void> {
  useAccountStore.getState().setProfile(await container.account.restore());
}

export function useAccount() {
  const state = useAccountStore();

  const run = async (work: () => Promise<string | null>) => {
    state.setBusy(true);
    state.setError(null);
    try {
      state.setError(await work());
    } finally {
      state.setBusy(false);
    }
  };

  return {
    ...state,
    signIn: () =>
      run(async () => {
        const r = await container.account.signIn();
        if (r.ok) {
          useAccountStore.getState().setProfile(r.profile);
          return null;
        }
        return r.reason === 'cancelled' ? null : (SIGN_IN_ERROR[r.reason] ?? SIGN_IN_ERROR.failed!);
      }),
    signOut: () =>
      run(async () => {
        await container.account.signOut();
        useAccountStore.getState().setProfile(null);
        return null;
      }),
    deleteAccount: () =>
      run(async () => {
        const r = await container.account.deleteAccount();
        if (r.ok) {
          useAccountStore.getState().setProfile(null);
          return null;
        }
        return r.reason === 'cancelled' ? null : 'No se pudo borrar la cuenta. Probá de nuevo.';
      }),
  };
}
