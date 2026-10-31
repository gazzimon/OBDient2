// User preferences and AR calibration — persisted across launches via MMKV.

import { create } from 'zustand';
import type { AlertVoiceLevel } from '@/domain/voice/voice-arbiter';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { createMMKV } from 'react-native-mmkv';
import Constants from 'expo-constants';
import type { Audience } from '@/domain/assistant/next-questions';

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

// The workshop build (socios) starts as the mechanic, with Dev on.
const WORKSHOP_BUILD = (Constants.expoConfig?.extra as { audience?: 'workshop' } | undefined)?.audience === 'workshop';

// Everything Dev turns off when it is switched off: nobody keeps a development
// tool on without knowing it.
const DEV_OFF = { labMode: false, debugOverlay: false, recordTrips: false, ...DEFAULT_ENDPOINTS };

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
  // Live position to the lab's Traccar (off by default: where the car is, is personal).
  liveTracking: boolean;
  // Traccar device id of this phone ("obd_" + 16 hex characters of a salted hash
  // of the adapter's address, never the address itself).
  trackingDevice: string;
  // The driver said yes to sharing the route with the lab (Ajustes). Without it
  // nothing is sent: the lab used to receive it always (decision 2026-10-20) and
  // that is what ADR-0011 replaces with an explicit yes.
  trackingConsent: boolean;
  // Random per install: the key of the pseudonyms the lab receives instead of the
  // adapter address and the VIN (domain/privacy/hash.ts). Never leaves the phone.
  privacySalt: string;
  disclaimerAccepted: boolean;
  // "Not now" on the first-run sign-in: the app works without an account.
  accountPromptDismissed: boolean;
  // The first-run steps (welcome, account, adapter, ready) were gone through.
  onboardingDone: boolean;
  // Shows pose/heading/rates over the AR view — a field-testing aid.
  debugOverlay: boolean;
  // Driving map: tilted 3D following the course, or flat 2D north up.
  driveMap3d: boolean;
  // Tablero: the gauges, or the camera with the numbers on top.
  dashboardCamera: boolean;
  // Modo laboratorio: free read commands to the bus (obd_command), for M9.
  labMode: boolean;
  // What module scans and DID probes found goes to the lab's shared base (no VIN,
  // ADR-0011). On by default, as it always was; the user can turn it off.
  shareScans: boolean;
  // Ajustes › Dev (2026-10-31): shows the development tools; off turns them off.
  devMode: boolean;
  // Conductor or Mecánico: the assistant's instructions and the start screen's order.
  audience: Audience;

  setLastDevice: (id: string, name: string | null) => void;
  setCalibration: (patch: Partial<ArCalibration>) => void;
  resetCalibration: () => void;
  setEndpoints: (patch: Partial<typeof DEFAULT_ENDPOINTS>) => void;
  setVoiceEnabled: (on: boolean) => void;
  setAlertVoice: (level: AlertVoiceLevel) => void;
  setRecordTrips: (on: boolean) => void;
  setRecordMyTrips: (on: boolean) => void;
  setLiveTracking: (on: boolean, device?: string) => void;
  setTrackingConsent: (on: boolean) => void;
  setPrivacySalt: (salt: string) => void;
  setDisclaimerAccepted: (on: boolean) => void;
  setAccountPromptDismissed: (on: boolean) => void;
  setOnboardingDone: (on: boolean) => void;
  setDebugOverlay: (on: boolean) => void;
  setDriveMap3d: (on: boolean) => void;
  setDashboardCamera: (on: boolean) => void;
  setLabMode: (on: boolean) => void;
  setDevMode: (on: boolean) => void;
  setShareScans: (on: boolean) => void;
  setAudience: (audience: Audience) => void;
}

const customEndpoints = (p: Partial<SettingsState>) =>
  (['routingUrl', 'geocoderUrl', 'mapStyleUrl'] as const).some((k) => p[k] != null && (SUPERSEDED[p[k]] ?? p[k]) !== DEFAULT_ENDPOINTS[k]);

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      lastDeviceId: null,
      lastDeviceName: null,
      calibration: DEFAULT_CALIBRATION,
      ...DEFAULT_ENDPOINTS,
      voiceEnabled: true,
      alertVoice: 'all',
      recordTrips: WORKSHOP_BUILD,
      recordMyTrips: true,
      liveTracking: false,
      trackingDevice: '',
      trackingConsent: false,
      privacySalt: '',
      disclaimerAccepted: false,
      accountPromptDismissed: false,
      onboardingDone: false,
      debugOverlay: false,
      driveMap3d: true,
      dashboardCamera: false,
      labMode: false,
      devMode: WORKSHOP_BUILD,
      shareScans: true,
      audience: WORKSHOP_BUILD ? 'workshop' : 'driver',

      setLastDevice: (id, name) => set({ lastDeviceId: id, lastDeviceName: name }),
      setCalibration: (patch) => set((s) => ({ calibration: { ...s.calibration, ...patch } })),
      resetCalibration: () => set({ calibration: DEFAULT_CALIBRATION }),
      setEndpoints: (patch) => set(patch),
      setVoiceEnabled: (on) => set({ voiceEnabled: on }),
      setAlertVoice: (level) => set({ alertVoice: level }),
      setRecordTrips: (on) => set({ recordTrips: on }),
      setRecordMyTrips: (on) => set({ recordMyTrips: on }),
      setLiveTracking: (on, device) => set((s) => ({ liveTracking: on, trackingDevice: device ?? s.trackingDevice })),
      setTrackingConsent: (on) => set({ trackingConsent: on }),
      setPrivacySalt: (salt) => set({ privacySalt: salt }),
      setDisclaimerAccepted: (on) => set({ disclaimerAccepted: on }),
      setAccountPromptDismissed: (on) => set({ accountPromptDismissed: on }),
      setOnboardingDone: (on) => set({ onboardingDone: on }),
      setDebugOverlay: (on) => set({ debugOverlay: on }),
      setDriveMap3d: (on) => set({ driveMap3d: on }),
      setDashboardCamera: (on) => set({ dashboardCamera: on }),
      setLabMode: (on) => set({ labMode: on }),
      setDevMode: (on) => set(on ? { devMode: true } : { devMode: false, ...DEV_OFF }),
      setAudience: (audience) => set({ audience }),
      setShareScans: (on) => set({ shareScans: on }),
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
        liveTracking: s.liveTracking,
        trackingDevice: s.trackingDevice,
        trackingConsent: s.trackingConsent,
        privacySalt: s.privacySalt,
        disclaimerAccepted: s.disclaimerAccepted,
        accountPromptDismissed: s.accountPromptDismissed,
        onboardingDone: s.onboardingDone,
        debugOverlay: s.debugOverlay,
        driveMap3d: s.driveMap3d,
        dashboardCamera: s.dashboardCamera,
        labMode: s.labMode,
        devMode: s.devMode,
        shareScans: s.shareScans,
        audience: s.audience,
      }),
      // New calibration fields get their defaults instead of `undefined`.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>;
        const upgrade = (url: string | undefined) => (url && SUPERSEDED[url]) ?? url;
        return {
          ...current,
          ...p,
          calibration: { ...DEFAULT_CALIBRATION, ...p.calibration },
          // Installs from before the onboarding already saw the safety notice.
          onboardingDone: p.onboardingDone ?? p.disclaimerAccepted === true,
          routingUrl: upgrade(p.routingUrl) ?? current.routingUrl,
          geocoderUrl: upgrade(p.geocoderUrl) ?? current.geocoderUrl,
          // Installs from before Dev keep their development tools: Dev is on if any was.
          devMode: p.devMode ?? (current.devMode || p.labMode === true || p.debugOverlay === true || p.recordTrips === true || customEndpoints(p)),
        };
      },
    },
  ),
);
