// Byte-level link to an OBD adapter, independent of the radio.
//
// Implementations: ClassicTransport (Bluetooth SPP, Android) and BleTransport
// (GATT UART, Android + iOS). They deliver a raw text stream; response framing
// and command sequencing live above, in TransportCommandPort.

export type Unsubscribe = () => void;

export interface ByteTransport {
  // `address` is the MAC (Classic/Android) or the platform device id (BLE).
  connect(address: string): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  // Writes the text as-is, splitting it internally when the link requires it.
  write(data: string): Promise<void>;
  // Raw chunks as they arrive; a response may span several chunks.
  onData(listener: (chunk: string) => void): Unsubscribe;
  // Fires once when an established link drops (not on a deliberate disconnect()).
  onDisconnect(listener: () => void): Unsubscribe;
}

// Small helper for implementations: a typed listener set.
export class Listeners<T extends unknown[]> {
  private readonly set = new Set<(...args: T) => void>();

  add(listener: (...args: T) => void): Unsubscribe {
    this.set.add(listener);
    return () => {
      this.set.delete(listener);
    };
  }

  emit(...args: T): void {
    for (const l of [...this.set]) l(...args);
  }

  clear(): void {
    this.set.clear();
  }
}
