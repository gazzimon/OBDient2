// Keeps the remembered adapter connected (2026-10-29): tries when the app
// opens, when it comes back to the front and when Bluetooth turns on, and
// after a lost link waits 5 s, 15 s, 30 s and then a minute between tries
// (domain/obd/reconnect-policy). "Desconectar" is respected until the user
// connects again or the app restarts.
//
// Once connected it reads the VIN, so the top bar shows the car and the
// assistant gets its file before the first question.

import { AppState } from 'react-native';
import { container } from '@/data/container';
import { ReconnectPolicy } from '@/domain/obd/reconnect-policy';
import { useOBDStore, type ConnectionState } from '@/store/obdStore';
import { useSettingsStore } from '@/store/settingsStore';

const VIN_AFTER_MS = 4_000;

class ConnectionKeeper {
  private readonly policy = new ReconnectPolicy();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private trying = false;
  private active = AppState.currentState === 'active';
  // A scan for another adapter is on: no tries meanwhile.
  private held = false;
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    let last: ConnectionState = useOBDStore.getState().connectionState;
    useOBDStore.subscribe((s) => {
      if (s.connectionState === last) return;
      const was = last;
      last = s.connectionState;
      if (s.connectionState === 'connected') this.onConnected();
      else if (s.connectionState === 'disconnected' && was === 'connected') this.later();
    });
    AppState.addEventListener('change', (state) => {
      this.active = state === 'active';
      if (this.active) this.fresh();
      else this.cancel();
    });
    container.obd.onBluetoothOn(() => this.fresh());
    this.fresh();
  }

  // "Desconectar": no tries until the user connects again.
  async userDisconnect(): Promise<void> {
    this.policy.userStopped();
    useOBDStore.getState().setStoppedByUser(true);
    this.cancel();
    await container.obd.disconnect();
  }

  // The user picked an adapter from the list.
  async userConnect(deviceId: string, name: string | null): Promise<void> {
    this.cancel();
    this.held = false;
    await container.obd.connect(deviceId, name);
  }

  // "Buscar de nuevo": the user asks, even after "Desconectar".
  retryNow(): void {
    this.policy.connected();
    useOBDStore.getState().setStoppedByUser(false);
    this.fresh();
  }

  // While the user looks for an adapter, the remembered one waits.
  hold(on: boolean): void {
    this.held = on;
    if (on) this.cancel();
    else if (useOBDStore.getState().connectionState === 'disconnected') this.fresh();
  }

  // A fresh reason to look: try now.
  private fresh(): void {
    if (!this.policy.shouldTry()) return;
    this.cancel();
    void this.attempt();
  }

  private later(): void {
    if (!this.active || this.held) return;
    const delay = this.policy.nextDelay();
    if (delay == null) return;
    this.cancel();
    useOBDStore.getState().setRetrying(true);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.attempt();
    }, delay);
  }

  private async attempt(): Promise<void> {
    if (this.trying || !this.active || this.held || this.policy.isStopped()) return;
    if (useOBDStore.getState().connectionState !== 'disconnected') return;
    // Nothing remembered, or no Bluetooth permission yet: nothing to retry.
    // Coming back to the app (e.g. from Settings) tries again.
    if (!useSettingsStore.getState().lastDeviceId || !(await container.obd.hasPermissions())) return;
    this.trying = true;
    try {
      const ok = await container.obd.reconnectLast();
      if (!ok && useOBDStore.getState().connectionState === 'disconnected') this.later();
    } finally {
      this.trying = false;
    }
  }

  private cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    useOBDStore.getState().setRetrying(false);
  }

  private onConnected(): void {
    this.policy.connected();
    useOBDStore.getState().setStoppedByUser(false);
    this.cancel();
    setTimeout(() => {
      void container.vehicleTools.ensureVin().then((vin) => {
        if (useOBDStore.getState().connectionState === 'connected') useOBDStore.getState().setVin(vin);
      });
    }, VIN_AFTER_MS);
  }
}

export const connectionKeeper = new ConnectionKeeper();
