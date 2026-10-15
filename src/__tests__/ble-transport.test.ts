import { ConnectionFailedError } from '@/core/errors/obd.errors';
import { asciiToBase64, base64ToAscii } from '@/data/adapters/base64';
import { BleTransport, type BlePlatform, type BleSession } from '@/data/adapters/ble-transport';
import type { GattService } from '@/data/adapters/gatt-discovery';

const FFF0: GattService[] = [
  {
    uuid: 'fff0',
    characteristics: [
      { uuid: 'fff1', isNotifiable: true, isWritableWithResponse: false, isWritableWithoutResponse: false },
      { uuid: 'fff2', isNotifiable: false, isWritableWithResponse: true, isWritableWithoutResponse: true },
    ],
  },
];

function fakeSession(services: GattService[], mtu = 23) {
  const writes: { svc: string; chr: string; text: string; withResponse: boolean }[] = [];
  let notify: ((b64: string) => void) | null = null;
  let dropped: (() => void) | null = null;
  const session: BleSession = {
    mtu,
    services: async () => services,
    monitor: (_s, _c, cb) => { notify = cb; return () => { notify = null; }; },
    write: async (svc, chr, b64, withResponse) => { writes.push({ svc, chr, text: base64ToAscii(b64), withResponse }); },
    onDisconnected: (l) => { dropped = l; return () => { dropped = null; }; },
    disconnect: jest.fn().mockResolvedValue(undefined),
  };
  return { session, writes, push: (t: string) => notify?.(asciiToBase64(t)), drop: () => dropped?.() };
}

const platformOf = (session: BleSession): BlePlatform => ({
  connect: async () => session,
  scan: async () => () => undefined,
});

describe('BleTransport', () => {
  it('selects the characteristic pair and delivers decoded notifications', async () => {
    const f = fakeSession(FFF0);
    const t = new BleTransport(platformOf(f.session));
    const chunks: string[] = [];
    t.onData((c) => chunks.push(c));
    await t.connect('AA:BB');
    expect(t.isConnected()).toBe(true);
    expect(t.selectedPair()).toMatchObject({ serviceUuid: 'fff0', notifyUuid: 'fff1', writeUuid: 'fff2' });
    f.push('41 00 BE');
    f.push(' 3F\r>');
    expect(chunks).toEqual(['41 00 BE', ' 3F\r>']);
  });

  it('splits writes to the MTU payload and uses write-without-response when offered', async () => {
    const f = fakeSession(FFF0, 23); // 20-byte payload
    const t = new BleTransport(platformOf(f.session));
    await t.connect('AA:BB');
    await t.write('0123456789012345678901234\r'); // 26 chars
    expect(f.writes.map((w) => w.text)).toEqual(['01234567890123456789', '01234\r']);
    expect(f.writes.every((w) => w.chr === 'fff2' && w.withResponse === false)).toBe(true);
  });

  it('uses larger payloads on a negotiated MTU', async () => {
    const f = fakeSession(FFF0, 185);
    const t = new BleTransport(platformOf(f.session));
    await t.connect('AA:BB');
    await t.write('x'.repeat(100));
    expect(f.writes).toHaveLength(1);
  });

  it('fails the connection when no serial characteristic exists', async () => {
    const f = fakeSession([{ uuid: '1800', characteristics: [] }]);
    const t = new BleTransport(platformOf(f.session));
    await expect(t.connect('AA:BB')).rejects.toBeInstanceOf(ConnectionFailedError);
    expect(f.session.disconnect).toHaveBeenCalled();
    expect(t.isConnected()).toBe(false);
  });

  it('wraps platform connect errors', async () => {
    const t = new BleTransport({ connect: async () => { throw new Error('133'); }, scan: async () => () => undefined });
    await expect(t.connect('AA:BB')).rejects.toBeInstanceOf(ConnectionFailedError);
  });

  it('reports an unexpected drop once, and a deliberate disconnect silently', async () => {
    const f = fakeSession(FFF0);
    const t = new BleTransport(platformOf(f.session));
    const onDrop = jest.fn();
    t.onDisconnect(onDrop);
    await t.connect('AA:BB');
    f.drop();
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(t.isConnected()).toBe(false);

    const g = fakeSession(FFF0);
    const t2 = new BleTransport(platformOf(g.session));
    const onDrop2 = jest.fn();
    t2.onDisconnect(onDrop2);
    await t2.connect('AA:BB');
    await t2.disconnect();
    g.drop();
    expect(onDrop2).not.toHaveBeenCalled();
  });
});
