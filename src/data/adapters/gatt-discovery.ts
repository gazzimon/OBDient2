// Picks the notify/write characteristic pair of a BLE OBD adapter.
//
// ELM327-style BLE dongles do not share one GATT layout (a UART-over-GATT
// service whose UUIDs vary by vendor), so we try known layouts first and fall
// back to a structural search. Pure — the BLE library maps its objects to
// these shapes.

export interface GattCharacteristic {
  uuid: string;
  isNotifiable: boolean;
  isWritableWithResponse: boolean;
  isWritableWithoutResponse: boolean;
}

export interface GattService {
  uuid: string;
  characteristics: GattCharacteristic[];
}

export interface GattPair {
  serviceUuid: string;
  notifyUuid: string;
  writeUuid: string;
  writeWithResponse: boolean;
  source: 'known' | 'heuristic';
}

// Layouts commonly seen on ELM327 BLE adapters. Hints, not guarantees —
// adapter profiles may pin the exact pair once verified on real hardware.
const KNOWN_LAYOUTS: ReadonlyArray<{ service: string; notify: string; write: string }> = [
  { service: 'fff0', notify: 'fff1', write: 'fff2' },
  { service: 'ffe0', notify: 'ffe1', write: 'ffe1' },
  { service: '18f0', notify: '2af0', write: '2af1' },
  {
    service: 'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
    notify: 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f',
    write: 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f',
  },
];

// Generic GATT services that never carry the serial channel.
const IGNORED_SERVICES = new Set(['1800', '1801', '180a', '180f']);

const BASE_UUID_SUFFIX = '-0000-1000-8000-00805f9b34fb';

// Lowercases and shortens Bluetooth-base UUIDs to their 16-bit form.
export function normalizeUuid(uuid: string): string {
  const lower = uuid.toLowerCase();
  if (lower.length === 36 && lower.startsWith('0000') && lower.endsWith(BASE_UUID_SUFFIX)) {
    return lower.slice(4, 8);
  }
  return lower;
}

export function pickCharacteristics(services: readonly GattService[]): GattPair | null {
  const byService = new Map<string, Map<string, GattCharacteristic>>();
  for (const svc of services) {
    byService.set(
      normalizeUuid(svc.uuid),
      new Map(svc.characteristics.map((c) => [normalizeUuid(c.uuid), c])),
    );
  }

  for (const layout of KNOWN_LAYOUTS) {
    const chars = byService.get(layout.service);
    const notify = chars?.get(layout.notify);
    const write = chars?.get(layout.write);
    if (notify?.isNotifiable && write && canWrite(write)) {
      return pair(layout.service, notify, write, 'known');
    }
  }

  for (const svc of services) {
    const serviceUuid = normalizeUuid(svc.uuid);
    if (IGNORED_SERVICES.has(serviceUuid)) continue;
    const notify = svc.characteristics.find((c) => c.isNotifiable);
    const write = svc.characteristics.find(canWrite);
    if (notify && write) return pair(serviceUuid, notify, write, 'heuristic');
  }
  return null;
}

function canWrite(c: GattCharacteristic): boolean {
  return c.isWritableWithResponse || c.isWritableWithoutResponse;
}

function pair(
  serviceUuid: string,
  notify: GattCharacteristic,
  write: GattCharacteristic,
  source: GattPair['source'],
): GattPair {
  return {
    serviceUuid,
    notifyUuid: normalizeUuid(notify.uuid),
    writeUuid: normalizeUuid(write.uuid),
    // Prefer write-without-response (lower latency) when the characteristic offers both.
    writeWithResponse: !write.isWritableWithoutResponse,
    source,
  };
}
