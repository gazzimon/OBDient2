// Composition root: the long-lived services, wired once.

import Constants from 'expo-constants';
import { fetch as expoFetch } from 'expo/fetch';
import { AssistantService } from '@/data/assistant/assistant-service';
import { ChatSearchTools } from '@/data/assistant/chat-search-tools';
import { useChatStore } from '@/store/chatStore';
import { OfflineAssistant } from '@/domain/assistant/offline-assistant';
import { DRIVER, WORKSHOP } from '@/domain/assistant/prompt';
import { OnlineTools } from '@/data/tools/online-tools';
import { ToolsClient } from '@/data/tools/tools-client';
import { ServiceTools } from '@/data/service/service-tools';
import { createMmkvServiceStorage } from '@/data/service/mmkv-service-storage';
import { ServiceLog } from '@/domain/service/service-log';
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
import { createMmkvBaselineStorage } from '@/data/vehicle/mmkv-baseline-storage';
import { VehicleBaselines } from '@/domain/vehicle/baseline';
import { OsrmRouting } from '@/data/routing/osrm-routing';
import { PhotonGeocoder } from '@/data/routing/photon-geocoder';
import { TripRecorder } from '@/data/recording/trip-recorder';
import { createMmkvParkingStorage } from '@/data/parking/mmkv-parking-storage';
import { ParkingLog } from '@/domain/parking/parking';
import type { GeocodingPort, RoutingPort } from '@/domain/navigation/route';
import { useOBDStore } from '@/store/obdStore';
import { useSettingsStore } from '@/store/settingsStore';

const sensors = new SensorHub();
const trips = new TripRecorder();
sensors.setRecordSink((rec) => trips.record(rec));
// Every OBD speed sample, for screens that need them all (the 0–100 test).
type SpeedListener = (kmh: number, tMs: number) => void;
const speedListeners = new Set<SpeedListener>();
const obd = new ObdManager((kmh, t) => {
  sensors.onObdSpeed(kmh, t);
  trips.record({ k: 'obd', t, kmh });
  for (const l of speedListeners) l(kmh, t);
});

// The assistant's tools on the live session. "Moving" here is the last OBD
// speed; the chat screen (M3) refines it with GPS and hysteresis (ADR-0007 §6).
const MOVING_KMH = 5;
const faults = new FaultHistory(createMmkvFaultStorage());
// What is normal for each car (by VIN). The session in progress lives in the
// presentation's recorder, registered at start to avoid an import cycle.
const baselines = new VehicleBaselines(createMmkvBaselineStorage());
type BaselineSource = NonNullable<ConstructorParameters<typeof VehicleToolAdapter>[1]>['baseline'];
let baselineSource: BaselineSource | null = null;
const vehicleTools = new VehicleToolAdapter(() => obd.currentSession(), {
  history: faults,
  describer: new DtcBaseDescriber(loadDtcBaseAsset),
  live: (pid) => {
    const p = useOBDStore.getState().parameters[pid];
    return p ? { value: p.value, at: p.timestamp.getTime() } : null;
  },
  moving: () => (useOBDStore.getState().parameters.SPEED?.value ?? 0) > MOVING_KMH,
  // The make's addresses from the lab knowledge (onlineTools is set below).
  knownTargets: (make, model, signal) => onlineTools.scanTargets(make, model, signal),
  baseline: (vin) => baselineSource?.(vin) ?? { deviations: [], comparable: [] },
});

// Accounts (ADR-0008): email code login (Magic), model key from obdient-auth.
const extra = Constants.expoConfig?.extra as { authUrl: string; toolsUrl: string; audience?: 'workshop' };
const account = new AccountService({
  identity: magicIdentity,
  secrets: secureStore,
  authUrl: extra.authUrl,
  toolsUrl: extra.toolsUrl,
  // Lazy: the wipe touches presentation stores, which import this container.
  wipeLocal: async () => (await import('@/presentation/services/wipe-local-data')).wipeLocalData(),
});

// The assistant's tools: navigation ones go to NavigationTools (presentation,
// registered at start to avoid an import cycle), the rest to the car.
type ToolRunner = Pick<VehicleToolsPort, 'execute'>;
let navigationTools: { names: ReadonlySet<string>; runner: ToolRunner } | null = null;
// obdient-tools (M8) with the account's key: web, dollar, car prices; fuel and
// weather go through NavigationTools (they need the position).
const toolsClient = new ToolsClient({ url: extra.toolsUrl, credentials: () => account.llmCredentials() });
const onlineTools = new OnlineTools(toolsClient);
// The service log on the phone.
const serviceLog = new ServiceLog(createMmkvServiceStorage());
const serviceTools = new ServiceTools({ log: serviceLog, vin: () => vehicleTools.knownVin() });
// Where each car was left: saved when the adapter link goes.
const parking = new ParkingLog(createMmkvParkingStorage());
// What was said in earlier conversations, read from the chat store.
const chatSearchTools = new ChatSearchTools({
  conversations: () => useChatStore.getState().conversations,
  activeId: () => useChatStore.getState().activeId,
});
const assistantTools: VehicleToolsPort = {
  supportedPids: () => vehicleTools.supportedPids(),
  execute: async (call, signal, onProgress) => {
    switch (call.name) {
      case 'web_search':
      case 'research':
      case 'web_fetch':
      case 'knowledge_lookup':
      case 'docs_search':
      case 'dollar_rate':
      case 'car_price':
        return onlineTools.execute(call, signal);
      case 'scan_modules': {
        const out = await vehicleTools.execute(call, signal, onProgress);
        // A scan's findings go to the lab's shared knowledge (best effort).
        if (out.ok && out.knowledge) void onlineTools.reportKnowledge(out.knowledge, signal);
        return out;
      }
      case 'log_service':
      case 'read_service_log':
        return serviceTools.execute(call);
      case 'chat_search':
        return chatSearchTools.execute(call);
      default:
        return navigationTools?.names.has(call.name) ? navigationTools.runner.execute(call, signal) : vehicleTools.execute(call, signal);
    }
  },
};

// The assistant (M3): the account's key, the car and the navigation as tools.
const assistant = new AssistantService({
  account,
  vehicle: assistantTools,
  persona: extra.audience === 'workshop' ? WORKSHOP : DRIVER,
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
  // Returns the unsubscribe.
  onObdSpeed(listener: SpeedListener): () => void {
    speedListeners.add(listener);
    return () => void speedListeners.delete(listener);
  },
  setBaselineSource(source: NonNullable<BaselineSource>): void {
    baselineSource = source;
  },
  baselines,
  account,
  assistant,
  offlineAssistant,
  toolsClient,
  // obdient-tools' base URL (the speech WebSocket lives under it).
  toolsUrl: extra.toolsUrl,
  sensors,
  obd,
  trips,
  vehicleTools,
  faults,
  serviceLog,
  parking,
  // Built per call so an endpoint changed in Settings applies immediately.
  routing(): RoutingPort {
    return new OsrmRouting(useSettingsStore.getState().routingUrl);
  },
  geocoder(): GeocodingPort {
    return new PhotonGeocoder(useSettingsStore.getState().geocoderUrl);
  },
};
