// The state block the model gets with each message (ADR-0007): adapter,
// movement and navigation, read from the stores at send time.
//
// Moving: OBD speed when the adapter is connected, else GPS (ADR-0007 §6:
// OBD > 5 km/h or GPS > 7 km/h). Hysteresis comes with driving mode (M5).

import { container } from '@/data/container';
import { navigationTools } from '@/presentation/services/navigation-tools';
import type { AssistantContext } from '@/domain/assistant/prompt';
import { useEgoStore } from '@/store/egoStore';
import { useNavStore } from '@/store/navStore';
import { useOBDStore } from '@/store/obdStore';

const OBD_MOVING_KMH = 5;
const GPS_MOVING_KMH = 7;

export function assistantContext(): AssistantContext {
  const obd = useOBDStore.getState();
  const connected = obd.connectionState === 'connected';
  const obdKmh = connected ? (obd.parameters.SPEED?.value ?? null) : null;
  const gpsKmh = (useEgoStore.getState().ego?.speedMps ?? 0) * 3.6;
  const speedKmh = obdKmh ?? (gpsKmh > 0 ? gpsKmh : null);
  const moving = obdKmh != null ? obdKmh > OBD_MOVING_KMH : gpsKmh > GPS_MOVING_KMH;
  return {
    connected,
    protocol: connected ? (obd.session?.protocol ?? null) : null,
    supportedPids: connected ? container.vehicleTools.supportedPids().length : 0,
    moving,
    speedKmh,
    navigating: useNavStore.getState().status === 'navigating',
    place: navigationTools.lastLocality(),
  };
}
