// Binds BlePlatform to react-native-ble-plx. Kept thin and untested on purpose:
// everything with logic lives in BleTransport.

import { BleManager, State, type Device } from 'react-native-ble-plx';
import { Platform } from 'react-native';
import type { GattService } from './gatt-discovery';
import type { BlePlatform, BleSession, ScannedDevice } from './ble-transport';

const REQUESTED_MTU = 247;
const DEFAULT_MTU = 23;

export function createBlePlxPlatform(manager: BleManager = new BleManager()): BlePlatform {
  return {
    async connect(deviceId: string): Promise<BleSession> {
      let device: Device = await manager.connectToDevice(deviceId, { timeout: 10_000 });
      device = await device.discoverAllServicesAndCharacteristics();

      // Android defaults to MTU 23; iOS negotiates by itself and ignores the request.
      if (Platform.OS === 'android') {
        device = await device.requestMTU(REQUESTED_MTU).catch(() => device);
      }
      const mtu = device.mtu || DEFAULT_MTU;

      return {
        mtu,
        async services(): Promise<GattService[]> {
          const services = await device.services();
          return Promise.all(
            services.map(async (svc) => ({
              uuid: svc.uuid,
              characteristics: (await svc.characteristics()).map((c) => ({
                uuid: c.uuid,
                isNotifiable: c.isNotifiable || c.isIndicatable,
                isWritableWithResponse: c.isWritableWithResponse,
                isWritableWithoutResponse: c.isWritableWithoutResponse,
              })),
            })),
          );
        },
        monitor(serviceUuid, characteristicUuid, onValue) {
          const sub = device.monitorCharacteristicForService(serviceUuid, characteristicUuid, (err, c) => {
            if (!err && c?.value) onValue(c.value);
          });
          return () => sub.remove();
        },
        async write(serviceUuid, characteristicUuid, base64, withResponse) {
          if (withResponse) {
            await device.writeCharacteristicWithResponseForService(serviceUuid, characteristicUuid, base64);
          } else {
            await device.writeCharacteristicWithoutResponseForService(serviceUuid, characteristicUuid, base64);
          }
        },
        onDisconnected(listener) {
          const sub = manager.onDeviceDisconnected(deviceId, () => listener());
          return () => sub.remove();
        },
        async disconnect() {
          await manager.cancelDeviceConnection(deviceId);
        },
      };
    },

    async scan(onDevice: (d: ScannedDevice) => void): Promise<() => void> {
      await manager.startDeviceScan(null, { allowDuplicates: false }, (err, device) => {
        if (err || !device) return;
        onDevice({ id: device.id, name: device.name ?? device.localName, rssi: device.rssi });
      });
      return () => {
        void manager.stopDeviceScan();
      };
    },

    onPoweredOn(listener) {
      const sub = manager.onStateChange((state) => {
        if (state === State.PoweredOn) listener();
      }, false);
      return () => sub.remove();
    },
  };
}
