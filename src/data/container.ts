// Composition root: the long-lived services, wired once.

import Constants from 'expo-constants';
import { fetch as expoFetch } from 'expo/fetch';
import { AssistantService } from '@/data/assistant/assistant-service';
import { OfflineAssistant } from '@/domain/assistant/offline-assistant';
import type { VehicleToolsPort } from '@/domain/ports/vehicle-tools.port';
import { OpenAiChatClient } from '@/data/llm/openai-chat-client';
import { AccountService } from '@/data/auth/account-service';
import { magicIdentity } from '@/data/auth/magic-identity';
import { secureStore } from '@/data/auth/secure-store';
import { SensorHub } from '@/data/sensors/sensor-hub';
import { ObdManager } from '@/data/obd/obd-manager';
import { VehicleToolAdapter } from '@/data/obd/vehicle-tool-adapter';
import { DtcBaseDescriber } from '@/data/knowledge/dtc-base';
import { loadDtcBaseAsset } from '@/data/knowledge/dtc-base-asset';
import { createMmkvFaultStorage } from '@/data/faults/mmkv-fault-storage';
import { FaultHistory } from '@/domain/faults/fault-history';
import { OsrmRouting } from '@/data/routing/osrm-routing';
import { PhotonGeocoder } from '@/data/routing/photon-geocoder';
import { TripRecorder } from '@/data/recording/trip-recorder';
import type { GeocodingPort, RoutingPort } from '@/domain/navigation/route';
import { useOBDStore } from '@/store/obdStore';
import { useSettingsStore } from '@/store/settingsStore';

const sensors = new SensorHub();
const trips = new TripRecorder();
sensors.setRecordSink((rec) => trips.record(rec));
const obd = new ObdManager((kmh, t) => {
  sensors.onObdSpeed(kmh, t);
  trips.record({ k: 'obd', t, kmh });
});

// The assistant's tools on the live session. "Moving" here is the last OBD
// speed; the chat screen (M3) refines it with GPS and hysteresis (ADR-0007 §6).
const MOVING_KMH = 5;
const faults = new FaultHistory(createMmkvFaultStorage());
const vehicleTools = new VehicleToolAdapter(() => obd.currentSession(), {
  history: faults,
  describer: new DtcBaseDescriber(loadDtcBaseAsset),
  live: (pid) => {
    const p = useOBDStore.getState().parameters[pid];
    return p ? { value: p.value, at: p.timestamp.getTime() } : null;
  },
  moving: () => (useOBDStore.getState().parameters.SPEED?.value ?? 0) > MOVING_KMH,
});

// Accounts (ADR-0008): email code login (Magic), model key from obdient-auth.
const extra = Constants.expoConfig?.extra as { authUrl: string };
const account = new AccountService({ identity: magicIdentity, secrets: secureStore, authUrl: extra.authUrl });

// The assistant's tools: navigation ones go to NavigationTools (presentation,
// registered at start to avoid an import cycle), the rest to the car.
type ToolRunner = Pick<VehicleToolsPort, 'execute'>;
let navigationTools: { names: ReadonlySet<string>; runner: ToolRunner } | null = null;
const assistantTools: VehicleToolsPort = {
  supportedPids: () => vehicleTools.supportedPids(),
  execute: (call, signal) =>
    navigationTools?.names.has(call.name) ? navigationTools.runner.execute(call, signal) : vehicleTools.execute(call, signal),
};

// The assistant (M3): the account's key, the car and the navigation as tools.
const assistant = new AssistantService({
  account,
  vehicle: assistantTools,
  makeLlm: (c) =>
    new OpenAiChatClient({
      baseUrl: c.baseUrl,
      apiKey: c.apiKey,
      model: c.model,
      fetch: expoFetch as unknown as ConstructorParameters<typeof OpenAiChatClient>[0]['fetch'],
    }),
});

// Without the assistant (M4): known phrases and notes, on the same tools.
const offlineAssistant = new OfflineAssistant(assistantTools);

export const container = {
  setNavigationTools(names: ReadonlySet<string>, runner: ToolRunner): void {
    navigationTools = { names, runner };
  },
  account,
  assistant,
  offlineAssistant,
  sensors,
  obd,
  trips,
  vehicleTools,
  faults,
  // Built per call so an endpoint changed in Settings applies immediately.
  routing(): RoutingPort {
    return new OsrmRouting(useSettingsStore.getState().routingUrl);
  },
  geocoder(): GeocodingPort {
    return new PhotonGeocoder(useSettingsStore.getState().geocoderUrl);
  },
};
