import { AdapterResetError, CommandTimeoutError, ConnectionLostError, NoDataError } from '@/core/errors/obd.errors';
import { TransportCommandPort } from '@/data/adapters/transport-command-port';
import { Listeners, type ByteTransport } from '@/data/adapters/transport';

// Fake transport: `reply` decides what the "adapter" emits for each write.
class FakeTransport implements ByteTransport {
  connected = true;
  writes: string[] = [];
  private data = new Listeners<[string]>();
  private drops = new Listeners<[]>();
  constructor(private reply: (written: string, t: FakeTransport) => void = () => undefined) {}
  async connect() {}
  async disconnect() {}
  isConnected() { return this.connected; }
  async write(d: string) { this.writes.push(d); this.reply(d, this); }
  onData(l: (c: string) => void) { return this.data.add(l); }
  onDisconnect(l: () => void) { return this.drops.add(l); }
  emit(chunk: string) { this.data.emit(chunk); }
  drop() { this.drops.emit(); }
}

describe('TransportCommandPort', () => {
  it('sends the command with CR and resolves the framed response', async () => {
    const t = new FakeTransport((w, tr) => tr.emit('41 0C 1A F8\r\r>'));
    const port = new TransportCommandPort(t);
    await expect(port.send('010C')).resolves.toBe('41 0C 1A F8');
    expect(t.writes).toEqual(['010C\r']);
  });

  it('reassembles a response split across chunks', async () => {
    const t = new FakeTransport((w, tr) => {
      tr.emit('49 02 01 57 ');
      tr.emit('30 4C\r');
      tr.emit('\r>');
    });
    await expect(new TransportCommandPort(t).send('0902')).resolves.toBe('49 02 01 57 30 4C');
  });

  it('strips the command echo and the SEARCHING banner', async () => {
    const t = new FakeTransport((w, tr) => tr.emit('0100\rSEARCHING...\r41 00 BE 3F A8 13\r\r>'));
    await expect(new TransportCommandPort(t).send('0100')).resolves.toBe('41 00 BE 3F A8 13');
  });

  it('classifies adapter failures as NoDataError, including after SEARCHING', async () => {
    const t = new FakeTransport((w, tr) => tr.emit('SEARCHING...\rUNABLE TO CONNECT\r\r>'));
    await expect(new TransportCommandPort(t).send('0100')).rejects.toBeInstanceOf(NoDataError);
    const t2 = new FakeTransport((w, tr) => tr.emit('NO DATA\r\r>'));
    await expect(new TransportCommandPort(t2).send('010C')).rejects.toBeInstanceOf(NoDataError);
  });

  it('does not treat a K-line "BUS INIT: OK" as an error', async () => {
    const t = new FakeTransport((w, tr) => tr.emit('BUS INIT: OK\r41 00 BE 3F A8 13\r\r>'));
    await expect(new TransportCommandPort(t).send('0100')).resolves.toContain('41 00');
  });

  it('runs commands strictly one at a time, in order', async () => {
    const order: string[] = [];
    const t = new FakeTransport((w, tr) => {
      order.push(w.trim());
      setTimeout(() => tr.emit(`OK ${w.trim()}\r\r>`), 1);
    });
    const port = new TransportCommandPort(t);
    const [a, b, c] = await Promise.all([port.send('ATZ'), port.send('ATE0'), port.send('ATL0')]);
    expect([a, b, c]).toEqual(['OK ATZ', 'OK ATE0', 'OK ATL0']);
    expect(order).toEqual(['ATZ', 'ATE0', 'ATL0']);
  });

  it('times out, then keeps working (a failure does not starve the queue)', async () => {
    let n = 0;
    const t = new FakeTransport((w, tr) => {
      if (n++ === 0) return; // first command: silence
      tr.emit('OK\r\r>');
    });
    const port = new TransportCommandPort(t, 20);
    await expect(port.send('0100')).rejects.toBeInstanceOf(CommandTimeoutError);
    await expect(port.send('ATI')).resolves.toBe('OK');
  });

  it('rejects the in-flight command when the link drops', async () => {
    const t = new FakeTransport();
    const port = new TransportCommandPort(t, 5000);
    const p = port.send('0100');
    setTimeout(() => t.drop(), 5);
    await expect(p).rejects.toBeInstanceOf(ConnectionLostError);
  });

  it('rejects immediately when disconnected', async () => {
    const t = new FakeTransport();
    t.connected = false;
    await expect(new TransportCommandPort(t).send('ATZ')).rejects.toBeInstanceOf(ConnectionLostError);
  });

  it('surfaces a failed write as a lost connection', async () => {
    const t = new FakeTransport();
    t.write = async () => { throw new Error('GATT 133'); };
    await expect(new TransportCommandPort(t, 5000).send('ATZ')).rejects.toBeInstanceOf(ConnectionLostError);
  });

  describe('STN replies (OBD Family Reference Manual §9)', () => {
    it.each(['BUFFER FULL', 'BUS BUSY', 'BUS ERROR', 'DATA ERROR', 'FB ERROR', 'OUT OF MEMORY', 'STOPPED'])(
      'treats "%s" as no usable data',
      async (reply) => {
        const t = new FakeTransport((w, tr) => tr.emit(`${reply}\r\r>`));
        await expect(new TransportCommandPort(t).send('010D')).rejects.toBeInstanceOf(NoDataError);
      },
    );

    it('rejects a frame that failed its checksum, even with bytes before the marker', async () => {
      const t = new FakeTransport((w, tr) => tr.emit('41 0D 32 <DATA ERROR\r\r>'));
      await expect(new TransportCommandPort(t).send('010D')).rejects.toBeInstanceOf(NoDataError);
    });

    it('drops PowerSave alerts mixed into an answer', async () => {
      const t = new FakeTransport((w, tr) => tr.emit('ACT ALERT\r41 0D 32\r\r>'));
      await expect(new TransportCommandPort(t).send('010D')).resolves.toBe('41 0D 32');
    });

    it('reports LV RESET during a command and to reset listeners', async () => {
      const t = new FakeTransport((w, tr) => tr.emit('LV RESET\r\rELM327 v1.4b\r\r>'));
      const port = new TransportCommandPort(t);
      const onReset = jest.fn();
      port.onAdapterReset(onReset);
      await expect(port.send('010D')).rejects.toBeInstanceOf(AdapterResetError);
      expect(onReset).toHaveBeenCalledTimes(1);
    });

    it('reports an unsolicited LV RESET between commands', () => {
      const t = new FakeTransport();
      const port = new TransportCommandPort(t);
      const onReset = jest.fn();
      port.onAdapterReset(onReset);
      t.emit('LV RESET\r\rELM327 v1.4b\r\r>');
      expect(onReset).toHaveBeenCalledTimes(1);
    });
  });
});
