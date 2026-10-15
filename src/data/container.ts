// Composition root: the long-lived services, wired once.

import { SensorHub } from '@/data/sensors/sensor-hub';
import { ObdManager } from '@/data/obd/obd-manager';
import { OsrmRouting } from '@/data/routing/osrm-routing';
import { PhotonGeocoder } from '@/data/routing/photon-geocoder';
import type { GeocodingPort, RoutingPort } from '@/domain/navigation/route';
import { useSettingsStore } from '@/store/settingsStore';

const sensors = new SensorHub();
const obd = new ObdManager((kmh, t) => sensors.onObdSpeed(kmh, t));

export const container = {
  sensors,
  obd,
  // Built per call so an endpoint changed in Settings applies immediately.
  routing(): RoutingPort {
    return new OsrmRouting(useSettingsStore.getState().routingUrl);
  },
  geocoder(): GeocodingPort {
    return new PhotonGeocoder(useSettingsStore.getState().geocoderUrl);
  },
};
