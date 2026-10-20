// Permissions, one way for the whole app (domain/permissions): ensure(kind)
// explains, asks, and if Android no longer asks, guides to Settings and
// continues by itself when the user comes back with it on.
//
// Android only (MVP). PermissionsAndroid covers the four; the libraries' own
// requests (expo-location, expo-camera, expo-audio) then find them granted.
// Android tells "blocked" only as the answer to a request (never_ask_again),
// so the last answer is kept in MMKV.

import { AppState, Linking, PermissionsAndroid, Platform, type Permission } from 'react-native';
import { create } from 'zustand';
import { createMMKV } from 'react-native-mmkv';
import {
  ALL_PERMISSIONS,
  statusFrom,
  type LastAnswer,
  type PermissionKind,
  type PermissionStatus,
} from '@/domain/permissions/permissions';

const mmkv = createMMKV({ id: 'obdient2-permissions' });
const P = PermissionsAndroid.PERMISSIONS;

function androidPermissions(kind: PermissionKind): Permission[] {
  switch (kind) {
    case 'location':
      return [P.ACCESS_FINE_LOCATION, P.ACCESS_COARSE_LOCATION];
    case 'bluetooth':
      // Android ≤ 11 scans BLE with the location permission.
      return Number(Platform.Version) >= 31 ? [P.BLUETOOTH_SCAN, P.BLUETOOTH_CONNECT] : [P.ACCESS_FINE_LOCATION];
    case 'camera':
      return [P.CAMERA];
    case 'microphone':
      return [P.RECORD_AUDIO];
  }
}

// Guidance needs the precise location (Android 12+ lets the user give only the approximate one).
const required = (kind: PermissionKind): Permission[] =>
  kind === 'location' ? [P.ACCESS_FINE_LOCATION] : androidPermissions(kind);

const lastAnswer = (kind: PermissionKind): LastAnswer => (mmkv.getString(`last.${kind}`) as LastAnswer | undefined) ?? null;

async function check(kind: PermissionKind): Promise<PermissionStatus> {
  if (Platform.OS !== 'android') return 'granted';
  const granted = (await Promise.all(required(kind).map((p) => PermissionsAndroid.check(p)))).every(Boolean);
  if (granted) mmkv.remove(`last.${kind}`);
  return statusFrom(granted, lastAnswer(kind));
}

async function ask(kind: PermissionKind): Promise<PermissionStatus> {
  if (Platform.OS !== 'android') return 'granted';
  const res = await PermissionsAndroid.requestMultiple(androidPermissions(kind));
  const answers = required(kind).map((p) => res[p]);
  if (answers.every((a) => a === PermissionsAndroid.RESULTS.GRANTED)) {
    mmkv.remove(`last.${kind}`);
    return 'granted';
  }
  const last: LastAnswer = answers.some((a) => a === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) ? 'never_ask_again' : 'denied';
  mmkv.set(`last.${kind}`, last);
  return statusFrom(false, last);
}

interface Sheet {
  readonly kind: PermissionKind;
  readonly status: PermissionStatus;
  // Waiting for the user to come back from Settings.
  readonly inSettings: boolean;
  // Came back from Settings and it is still off.
  readonly stillOff?: boolean;
}

interface PermissionState {
  statuses: Partial<Record<PermissionKind, PermissionStatus>>;
  sheet: Sheet | null;
  introSeen: boolean;
}

export const usePermissionStore = create<PermissionState>(() => ({
  statuses: {},
  sheet: null,
  introSeen: mmkv.getBoolean('introSeen') ?? false,
}));

const setStatus = (kind: PermissionKind, status: PermissionStatus) =>
  usePermissionStore.setState((s) => ({ statuses: { ...s.statuses, [kind]: status } }));

let pending: { kind: PermissionKind; resolve: (granted: boolean) => void } | null = null;

function close(granted: boolean): void {
  const p = pending;
  pending = null;
  usePermissionStore.setState({ sheet: null });
  p?.resolve(granted);
}

export async function refreshPermissions(): Promise<void> {
  for (const kind of ALL_PERMISSIONS) setStatus(kind, await check(kind));
}

// The feature asks for its permission: true when it can go on.
export async function ensurePermission(kind: PermissionKind): Promise<boolean> {
  const status = await check(kind);
  setStatus(kind, status);
  if (status === 'granted') return true;
  if (pending) close(false); // one sheet at a time
  return new Promise((resolve) => {
    pending = { kind, resolve };
    usePermissionStore.setState({ sheet: { kind, status, inSettings: false } });
  });
}

// The sheet's main button: Android's dialog, or Settings when it no longer asks.
export async function allowFromSheet(): Promise<void> {
  const sheet = usePermissionStore.getState().sheet;
  if (!sheet) return;
  if (sheet.status === 'blocked') {
    usePermissionStore.setState({ sheet: { ...sheet, inSettings: true } });
    await Linking.openSettings();
    return;
  }
  const status = await ask(sheet.kind);
  setStatus(sheet.kind, status);
  if (status === 'granted') close(true);
  else usePermissionStore.setState({ sheet: { ...sheet, status } });
}

export function dismissSheet(): void {
  close(false);
}

// From the Settings panel: no feature waiting, just the permission.
export async function requestFromPanel(kind: PermissionKind): Promise<void> {
  const status = await check(kind);
  if (status === 'blocked') {
    await Linking.openSettings();
    return;
  }
  setStatus(kind, status === 'granted' ? status : await ask(kind));
}

// First start: the three essentials, one after another.
export async function askEssentials(kinds: readonly PermissionKind[]): Promise<void> {
  for (const kind of kinds) {
    const status = await check(kind);
    setStatus(kind, status === 'granted' || status === 'blocked' ? status : await ask(kind));
  }
  finishIntro();
}

export function finishIntro(): void {
  mmkv.set('introSeen', true);
  usePermissionStore.setState({ introSeen: true });
}

// Back from Settings (or any return to the app): read the permissions again;
// the waiting feature continues if it was turned on.
AppState.addEventListener('change', (state) => {
  if (state !== 'active') return;
  void (async () => {
    await refreshPermissions();
    const sheet = usePermissionStore.getState().sheet;
    if (!sheet) return;
    const status = usePermissionStore.getState().statuses[sheet.kind];
    if (status === 'granted') close(true);
    else if (sheet.inSettings) usePermissionStore.setState({ sheet: { ...sheet, status: status ?? sheet.status, inSettings: false, stillOff: true } });
  })();
});
