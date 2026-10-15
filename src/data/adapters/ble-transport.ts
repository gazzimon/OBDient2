// BLE (GATT UART) transport, Android + iOS.
//
// Talks to a small BlePlatform interface instead of react-native-ble-plx so the
// logic (characteristic selection, MTU-sized writes, base64) is unit-testable;
// `ble-plx-platform.ts` binds it to the real library.

import { ConnectionFailedError } from '@/core/errors/obd.errors';
import { asciiToBase64, base64ToAscii } from './base64';
import { pickCharacteristics, type GattPair, type GattService } from './gatt-discovery';
import { Listeners, type ByteTransport, type Unsubscribe } from './transport';

export interface BleSession {
  // Negotiated ATT MTU (23 when nothing was negotiated).
  readonly mtu: number;
  services(): Promise<GattService[]>;
  // Subscribes to notifications; values arrive base64-encoded.
  monitor(serviceUuid: string, characteristicUuid: string, onValue: (base64: string) => void): Unsubscribe;
  write(serviceUuid: string, characteristicUuid: string, base64: string, withResponse: boolean): Promise<void>;
  onDisconnected(listener: () => void): Unsubscribe;
  disconnect(): Promise<void>;
}

export interface ScannedDevice {
  id: string;
  name: string | null;
  rssi: number | null;
}

export interface BlePlatform {
  connect(deviceId: string): Promise<BleSession>;
  // Starts scanning; returns a function that stops it.
  scan(onDevice: (device: ScannedDevice) => void): Promise<() => void>;
}

// ATT overhead per write: 3 bytes (opcode + handle).
const ATT_OVERHEAD = 3;
const MIN_PAYLOAD = 20;

export class BleTransport implements ByteTransport {
  private session: BleSession | null = null;
  private pair: GattPair | null = null;
  private teardown: Unsubscribe[] = [];
  private readonly data = new Listeners<[string]>();
  private readonly drops = new Listeners<[]>();

  constructor(private readonly platform: BlePlatform) {}

  async connect(address: string): Promise<void> {
    let session: BleSession;
    try {
      session = await this.platform.connect(address);
    } catch (err) {
      throw new ConnectionFailedError(address, err);
    }

    const pair = pickCharacteristics(await session.services());
    if (!pair) {
      await session.disconnect().catch(() => undefined);
      throw new ConnectionFailedError(address, new Error('No serial (notify + write) characteristic found'));
    }

    this.session = session;
    this.pair = pair;
    this.teardown = [
      session.monitor(pair.serviceUuid, pair.notifyUuid, (b64) => this.data.emit(base64ToAscii(b64))),
      session.onDisconnected(() => {
        this.release();
        this.drops.emit();
      }),
    ];
  }

  async disconnect(): Promise<void> {
    const session = this.session;
    this.release();
    if (session) await session.disconnect();
  }

  isConnected(): boolean {
    return this.session !== null;
  }

  // The channel pair that was selected, for diagnostics and adapter profiles.
  selectedPair(): GattPair | null {
    return this.pair;
  }

  async write(data: string): Promise<void> {
    const session = this.session;
    const pair = this.pair;
    if (!session || !pair) throw new Error('BLE transport not connected');

    const size = Math.max(MIN_PAYLOAD, session.mtu - ATT_OVERHEAD);
    for (let i = 0; i < data.length; i += size) {
      await session.write(
        pair.serviceUuid,
        pair.writeUuid,
        asciiToBase64(data.slice(i, i + size)),
        pair.writeWithResponse,
      );
    }
  }

  onData(listener: (chunk: string) => void): Unsubscribe {
    return this.data.add(listener);
  }

  onDisconnect(listener: () => void): Unsubscribe {
    return this.drops.add(listener);
  }

  private release(): void {
    for (const off of this.teardown) off();
    this.teardown = [];
    this.session = null;
    this.pair = null;
  }
}
