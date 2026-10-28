// In-memory stand-in for react-native-mmkv under Jest.
//
// The real package ships untranspiled ESM and needs the native module, neither
// of which exists in the node test environment. Persisted zustand stores only
// need somewhere to put strings, so this is enough to exercise them.

interface MMKVLike {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
  clearAll(): void;
}

export function createMMKV(_options?: { id?: string }): MMKVLike {
  const store = new Map<string, string>();
  return {
    getString: (key) => store.get(key),
    set: (key, value) => { store.set(key, value); },
    remove: (key) => { store.delete(key); },
    clearAll: () => { store.clear(); },
  };
}
