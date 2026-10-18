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
  // Local trip log while navigating (domain/recording). On while the MVP is
  // being field-tested: it is how AR problems get diagnosed afterwards.
  recordTrips: boolean;
  // Camera frames in the trip log (bursts, ~1.7 GB/h) for the teacher models.
  recordFrames: boolean;
  disclaimerAccepted: boolean;
  // "Not now" on the first-run sign-in: the app works without an account.
  accountPromptDismissed: boolean;
  // Shows pose/heading/rates over the AR view — a field-testing aid.
  debugOverlay: boolean;
  // On-device detector (E4): alerts for vehicles, pedestrians, cyclists.
  detectorEnabled: boolean;
  // Accelerator for the detector; the bench says which one is fastest.
  detectorDelegate: 'android-gpu' | 'nnapi' | 'cpu';
  detectorModelId: string;

  setLastDevice: (id: string, name: string | null) => void;
  setCalibration: (patch: Partial<ArCalibration>) => void;
  resetCalibration: () => void;
  setEndpoints: (patch: Partial<typeof DEFAULT_ENDPOINTS>) => void;
  setVoiceEnabled: (on: boolean) => void;
  setRecordTrips: (on: boolean) => void;
  setRecordFrames: (on: boolean) => void;
  setDisclaimerAccepted: (on: boolean) => void;
  setAccountPromptDismissed: (on: boolean) => void;
  setDebugOverlay: (on: boolean) => void;
  setDetector: (patch: Partial<Pick<SettingsState, 'detectorEnabled' | 'detectorDelegate' | 'detectorModelId'>>) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      lastDeviceId: null,
      lastDeviceName: null,
      calibration: DEFAULT_CALIBRATION,
      ...DEFAULT_ENDPOINTS,
      voiceEnabled: true,
      recordTrips: true,
      recordFrames: true,
      disclaimerAccepted: false,
      accountPromptDismissed: false,
      debugOverlay: false,
      detectorEnabled: true,
      detectorDelegate: 'android-gpu',
      detectorModelId: 'yolo11n-fp16',

      setLastDevice: (id, name) => set({ lastDeviceId: id, lastDeviceName: name }),
      setCalibration: (patch) => set((s) => ({ calibration: { ...s.calibration, ...patch } })),
      resetCalibration: () => set({ calibration: DEFAULT_CALIBRATION }),
      setEndpoints: (patch) => set(patch),
      setVoiceEnabled: (on) => set({ voiceEnabled: on }),
      setRecordTrips: (on) => set({ recordTrips: on }),
      setRecordFrames: (on) => set({ recordFrames: on }),
      setDisclaimerAccepted: (on) => set({ disclaimerAccepted: on }),
      setAccountPromptDismissed: (on) => set({ accountPromptDismissed: on }),
      setDebugOverlay: (on) => set({ debugOverlay: on }),
      setDetector: (patch) => set(patch),
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
        recordTrips: s.recordTrips,
        recordFrames: s.recordFrames,
        disclaimerAccepted: s.disclaimerAccepted,
        accountPromptDismissed: s.accountPromptDismissed,
        debugOverlay: s.debugOverlay,
        detectorEnabled: s.detectorEnabled,
        detectorDelegate: s.detectorDelegate,
        detectorModelId: s.detectorModelId,
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
