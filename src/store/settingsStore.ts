// User preferences and AR calibration — persisted across launches via MMKV.

import { create } from 'zustand';
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

// Development defaults. Public demo servers forbid production traffic: a
// distributed build must override these (self-hosted or a provider). ADR-0003.
export const DEFAULT_ENDPOINTS = {
  routingUrl: 'https://router.project-osrm.org',
  geocoderUrl: 'https://photon.komoot.io',
  mapStyleUrl: 'https://tiles.openfreemap.org/styles/liberty',
};

interface SettingsState {
  lastDeviceId: string | null;
  lastDeviceName: string | null;
  calibration: ArCalibration;
  routingUrl: string;
  geocoderUrl: string;
  mapStyleUrl: string;
  voiceEnabled: boolean;
  disclaimerAccepted: boolean;
  // Shows pose/heading/rates over the AR view — a field-testing aid.
  debugOverlay: boolean;

  setLastDevice: (id: string, name: string | null) => void;
  setCalibration: (patch: Partial<ArCalibration>) => void;
  resetCalibration: () => void;
  setEndpoints: (patch: Partial<typeof DEFAULT_ENDPOINTS>) => void;
  setVoiceEnabled: (on: boolean) => void;
  setDisclaimerAccepted: (on: boolean) => void;
  setDebugOverlay: (on: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      lastDeviceId: null,
      lastDeviceName: null,
      calibration: DEFAULT_CALIBRATION,
      ...DEFAULT_ENDPOINTS,
      voiceEnabled: true,
      disclaimerAccepted: false,
      debugOverlay: false,

      setLastDevice: (id, name) => set({ lastDeviceId: id, lastDeviceName: name }),
      setCalibration: (patch) => set((s) => ({ calibration: { ...s.calibration, ...patch } })),
      resetCalibration: () => set({ calibration: DEFAULT_CALIBRATION }),
      setEndpoints: (patch) => set(patch),
      setVoiceEnabled: (on) => set({ voiceEnabled: on }),
      setDisclaimerAccepted: (on) => set({ disclaimerAccepted: on }),
      setDebugOverlay: (on) => set({ debugOverlay: on }),
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
        disclaimerAccepted: s.disclaimerAccepted,
        debugOverlay: s.debugOverlay,
      }),
      // New calibration fields get their defaults instead of `undefined`.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>;
        return { ...current, ...p, calibration: { ...DEFAULT_CALIBRATION, ...p.calibration } };
      },
    },
  ),
);
