// Composition root: the long-lived services, wired once.

import { SensorHub } from '@/data/sensors/sensor-hub';
import { ObdManager } from '@/data/obd/obd-manager';
import { VehicleToolAdapter } from '@/data/obd/vehicle-tool-adapter';
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
const vehicleTools = new VehicleToolAdapter(() => obd.currentSession(), {
  moving: () => (useOBDStore.getState().parameters.SPEED?.value ?? 0) > MOVING_KMH,
});

export const container = {
  sensors,
  obd,
  trips,
  vehicleTools,
  // Built per call so an endpoint changed in Settings applies immediately.
  routing(): RoutingPort {
    return new OsrmRouting(useSettingsStore.getState().routingUrl);
  },
  geocoder(): GeocodingPort {
    return new PhotonGeocoder(useSettingsStore.getState().geocoderUrl);
  },
};
