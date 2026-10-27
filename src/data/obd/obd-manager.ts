// App-level OBD lifecycle: BLE scan, connect, telemetry → stores + fusion.
//
// OBD is an enhancement, never a requirement: navigation and AR run on GPS +
// IMU alone. When the adapter is present its speed replaces GPS speed and
// powers the acceleration correction of the camera pose.

import { PermissionsAndroid, Platform } from 'react-native';
import { BleTransport, type ScannedDevice } from '@/data/adapters/ble-transport';
import { createBlePlxPlatform } from '@/data/adapters/ble-plx-platform';
import { useOBDStore } from '@/store/obdStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { BenchReport } from './adapter-bench';
import type { CaptureReport } from './diagnostic-capture';
import type { M7Report } from './m7-bench';
import { ObdSession } from './obd-session';

// Names that look like an OBD adapter, to sort them to the top of the list.
const OBD_NAME = /obd|elm|b3\d|starcharm|vlink|v-link|vgate|obdlink|stn/i;

export function looksLikeObd(name: string | null): boolean {
  return name != null && OBD_NAME.test(name);
}

type SpeedSink = (kmh: number, tMs: number) => void;

export class ObdManager {
  private readonly platform = createBlePlxPlatform();
  private session: ObdSession | null = null;
  private rateTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly speedSink: SpeedSink) {}

  async requestPermissions(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    if (Platform.Version >= 31) {
      const res = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ]);
      return Object.values(res).every((r) => r === PermissionsAndroid.RESULTS.GRANTED);
    }
    // Android ≤ 11 needs location to scan for BLE devices.
    const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
    return res === PermissionsAndroid.RESULTS.GRANTED;
  }

  // Calls `onDevice` for each device found; returns a stop function.
  async scan(onDevice: (d: ScannedDevice) => void): Promise<() => void> {
    if (!(await this.requestPermissions())) throw new Error('Permiso de Bluetooth denegado');
    return this.platform.scan(onDevice);
  }

  async connect(deviceId: string, deviceName: string | null): Promise<void> {
    await this.disconnect();
    const store = useOBDStore.getState();
    store.setConnecting(deviceName);

    const session = new ObdSession(new BleTransport(this.platform));
    try {
      const info = await session.open(deviceId);
      this.session = session;
      useSettingsStore.getState().setLastDevice(deviceId, deviceName);
      store.setConnected(info);
      session.startTelemetry({
        onSpeed: (kmh, t) => this.speedSink(kmh, t),
        onParameter: (p) => useOBDStore.getState().updateParameter(p),
        onStopped: (reason) => {
          if (reason === 'connection-lost') void this.disconnect('Se perdió la conexión con el adaptador');
        },
      });
      this.rateTimer = setInterval(
        () =>
          useOBDStore.getState().setLinkStats({
            hz: session.speedRateHz(),
            style: session.requestStyle(),
            resets: session.adapterResets,
          }),
        1000,
      );
    } catch (err) {
      await session.close();
      store.setDisconnected(err instanceof Error ? err.message : 'No se pudo conectar');
      throw err;
    }
  }

  // Reconnects to the last adapter without asking. Silent on failure: the
  // app works without OBD, so a missing dongle is not an error to show.
  async reconnectLast(): Promise<void> {
    const { lastDeviceId, lastDeviceName } = useSettingsStore.getState();
    if (!lastDeviceId || useOBDStore.getState().connectionState !== 'disconnected') return;
    if (!(await this.requestPermissions())) return;
    await this.connect(lastDeviceId, lastDeviceName).catch(() => useOBDStore.getState().setDisconnected(null));
  }

  // The live session, for the assistant's tools (null when disconnected).
  currentSession(): ObdSession | null {
    return this.session;
  }

  async runBench(): Promise<BenchReport> {
    if (!this.session) throw new Error('No hay adaptador conectado');
    return this.session.runBench();
  }

  async runCapture(): Promise<CaptureReport> {
    if (!this.session) throw new Error('No hay adaptador conectado');
    return this.session.runCapture();
  }

  async runM7Bench(): Promise<M7Report> {
    if (!this.session) throw new Error('No hay adaptador conectado');
    return this.session.runM7Bench();
  }

  async disconnect(error: string | null = null): Promise<void> {
    if (this.rateTimer) clearInterval(this.rateTimer);
    this.rateTimer = null;
    const s = this.session;
    this.session = null;
    if (s) await s.close();
    useOBDStore.getState().setDisconnected(error);
  }
}
