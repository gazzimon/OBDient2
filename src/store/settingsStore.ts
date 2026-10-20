// User preferences and AR calibration — persisted across launches via MMKV.

import { create } from 'zustand';
import type { AlertVoiceLevel } from '@/domain/voice/voice-arbiter';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { createMMKV } from 'react-native-mmkv';

const mmkv = createMMKV({ id: 'obdient2-settings' });

const mmkvStorage: StateStorage = {
  getItem: (name) => mmkv.getString(name) ?? null,
  setItem: (name, value) => mmkv.set(name, value),
  removeItem: (name) => {
    mmkv.remove(name);
  },
};

// Everything the AR projection needs that the phone cannot measure by itself.
// Set once per mount position from the calibration screen.
export interface ArCalibration {
  cameraHeightM: number;
  hfovDeg: number;
  pitchOffsetDeg: number;
  rollOffsetDeg: number;
  // Phone not pointing exactly along the car's axis.
  yawOffsetDeg: number;
  // See PoseConfig.gravitySign — flips if the horizon moves the wrong way.
  gravitySign: 1 | -1;
}

export const DEFAULT_CALIBRATION: ArCalibration = {
  cameraHeightM: 1.2,
  // Typical main camera in a 16:9 crop. Calibrate: a few degrees off shows.
  hfovDeg: 66,
  pitchOffsetDeg: 0,
  rollOffsetDeg: 0,
  yawOffsetDeg: 0,
  gravitySign: 1,
};

// Own servers: OSRM + Photon (Argentina) on the Z440, reached through Caddy
// on the K16 (ADR-0006). The public demo servers forbid production traffic.
export const DEFAULT_ENDPOINTS = {
  routingUrl: 'https://obdient.duckdns.org/osrm',
  geocoderUrl: 'https://obdient.duckdns.org/photon',
  mapStyleUrl: 'https://tiles.openfreemap.org/styles/liberty',
};

// Old defaults saved by earlier installs: moved to the new defaults on load.
// A URL the person typed is not touched.
const SUPERSEDED: Readonly<Record<string, string>> = {
  'https://router.project-osrm.org': DEFAULT_ENDPOINTS.routingUrl,
  'https://photon.komoot.io': DEFAULT_ENDPOINTS.geocoderUrl,
};

interface SettingsState {
  lastDeviceId: string | null;
  lastDeviceName: string | null;
  calibration: ArCalibration;
  routingUrl: string;
  geocoderUrl: string;
  mapStyleUrl: string;
  voiceEnabled: boolean;
  // Which detector alerts are spoken (M5); the flash on screen always shows.
  alertVoice: AlertVoiceLevel;
  // Local trip log while navigating (domain/recording). On while the MVP is
  // being field-tested: it is how AR problems get diagnosed afterwards.
  recordTrips: boolean;
  // "Mis viajes": a summary of each trip, recorded with the app open and the adapter connected.
  recordMyTrips: boolean;
  disclaimerAccepted: boolean;
  // "Not now" on the first-run sign-in: the app works without an account.
  accountPromptDismissed: boolean;
  // Shows pose/heading/rates over the AR view — a field-testing aid.
  debugOverlay: boolean;
  // Modo manejo: the 3D map is the main view; true puts the AR camera first.
  driveAr: boolean;
  // Driving map: tilted 3D following the course, or flat 2D north up.
  driveMap3d: boolean;

  setLastDevice: (id: string, name: string | null) => void;
  setCalibration: (patch: Partial<ArCalibration>) => void;
  resetCalibration: () => void;
  setEndpoints: (patch: Partial<typeof DEFAULT_ENDPOINTS>) => void;
  setVoiceEnabled: (on: boolean) => void;
  setAlertVoice: (level: AlertVoiceLevel) => void;
  setRecordTrips: (on: boolean) => void;
  setRecordMyTrips: (on: boolean) => void;
  setDisclaimerAccepted: (on: boolean) => void;
  setAccountPromptDismissed: (on: boolean) => void;
  setDebugOverlay: (on: boolean) => void;
  setDriveAr: (on: boolean) => void;
  setDriveMap3d: (on: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      lastDeviceId: null,
      lastDeviceName: null,
      calibration: DEFAULT_CALIBRATION,
      ...DEFAULT_ENDPOINTS,
      voiceEnabled: true,
      alertVoice: 'all',
      recordTrips: true,
      recordMyTrips: true,
      disclaimerAccepted: false,
      accountPromptDismissed: false,
      debugOverlay: false,
      driveAr: false,
      driveMap3d: true,

      setLastDevice: (id, name) => set({ lastDeviceId: id, lastDeviceName: name }),
      setCalibration: (patch) => set((s) => ({ calibration: { ...s.calibration, ...patch } })),
      resetCalibration: () => set({ calibration: DEFAULT_CALIBRATION }),
      setEndpoints: (patch) => set(patch),
      setVoiceEnabled: (on) => set({ voiceEnabled: on }),
      setAlertVoice: (level) => set({ alertVoice: level }),
      setRecordTrips: (on) => set({ recordTrips: on }),
      setRecordMyTrips: (on) => set({ recordMyTrips: on }),
      setDisclaimerAccepted: (on) => set({ disclaimerAccepted: on }),
      setAccountPromptDismissed: (on) => set({ accountPromptDismissed: on }),
      setDebugOverlay: (on) => set({ debugOverlay: on }),
      setDriveAr: (on) => set({ driveAr: on }),
      setDriveMap3d: (on) => set({ driveMap3d: on }),
    }),
    {
      name: 'obdient2-settings',
      storage: createJSONStorage(() => mmkvStorage),
      partialize: (s) => ({
        lastDeviceId: s.lastDeviceId,
        lastDeviceName: s.lastDeviceName,
        calibration: s.calibration,
        routingUrl: s.routingUrl,
        geocoderUrl: s.geocoderUrl,
        mapStyleUrl: s.mapStyleUrl,
        voiceEnabled: s.voiceEnabled,
        alertVoice: s.alertVoice,
        recordTrips: s.recordTrips,
        recordMyTrips: s.recordMyTrips,
        disclaimerAccepted: s.disclaimerAccepted,
        accountPromptDismissed: s.accountPromptDismissed,
        debugOverlay: s.debugOverlay,
        driveAr: s.driveAr,
        driveMap3d: s.driveMap3d,
      }),
      // New calibration fields get their defaults instead of `undefined`.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>;
        const upgrade = (url: string | undefined) => (url && SUPERSEDED[url]) ?? url;
        return {
          ...current,
          ...p,
          calibration: { ...DEFAULT_CALIBRATION, ...p.calibration },
          routingUrl: upgrade(p.routingUrl) ?? current.routingUrl,
          geocoderUrl: upgrade(p.geocoderUrl) ?? current.geocoderUrl,
        };
      },
    },
  ),
);
