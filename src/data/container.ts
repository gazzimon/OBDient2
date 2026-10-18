// Composition root: the long-lived services, wired once.

import Constants from 'expo-constants';
import { fetch as expoFetch } from 'expo/fetch';
import { AssistantService } from '@/data/assistant/assistant-service';
import { OpenAiChatClient } from '@/data/llm/openai-chat-client';
import { AccountService } from '@/data/auth/account-service';
import { FirebaseRest } from '@/data/auth/firebase-rest';
import { googleSignIn } from '@/data/auth/google-sign-in';
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
  moving: () => (useOBDStore.getState().parameters.SPEED?.value ?? 0) > MOVING_KMH,
});

// Accounts (ADR-0008): values from app.config.ts, read from google-services.json.
const extra = Constants.expoConfig?.extra as { firebase: { apiKey: string }; authUrl: string };
const account = new AccountService({
  google: googleSignIn,
  firebase: new FirebaseRest(extra.firebase.apiKey),
  secrets: secureStore,
  authUrl: extra.authUrl,
});

// The assistant (M3): the account's key, the car through vehicleTools.
const assistant = new AssistantService({
  account,
  vehicle: vehicleTools,
  makeLlm: (c) =>
    new OpenAiChatClient({
      baseUrl: c.baseUrl,
      apiKey: c.apiKey,
      model: c.model,
      fetch: expoFetch as unknown as ConstructorParameters<typeof OpenAiChatClient>[0]['fetch'],
    }),
});

export const container = {
  account,
  assistant,
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
