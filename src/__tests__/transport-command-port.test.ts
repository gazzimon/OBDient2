import { AdapterResetError, CommandTimeoutError, ConnectionLostError, NoDataError } from '@/core/errors/obd.errors';
import { readMessages } from '@/core/utils/obdFrames';
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

  it('keeps one line per frame, so multi-frame answers can be assembled', async () => {
    const t = new FakeTransport((w, tr) => {
      tr.emit('7E8 10 14 49 02 01 31 44 34\r7E8 2');
      tr.emit('1 47 50 30 30 52 35 35\r7E8 22 42 31 32 33 34 35 36\r\r>');
    });
    const response = await new TransportCommandPort(t).send('0902');
    expect(response).toBe('7E8 10 14 49 02 01 31 44 34\n7E8 21 47 50 30 30 52 35 35\n7E8 22 42 31 32 33 34 35 36');
    const [vin] = readMessages(response, { headers: true, can: true });
    expect(String.fromCharCode(...vin!.bytes.slice(3))).toBe('1D4GP00R55B123456');
  });

  it('drops a response-pending frame with headers and padding, keeps the answer', async () => {
    const t = new FakeTransport((w, tr) => tr.emit('7E8037F037800000000\r7E80343017100000000\r\r>'));
    await expect(new TransportCommandPort(t).send('03')).resolves.toBe('7E80343017100000000');
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

describe('TransportCommandPort with plain ELM327 quirks', () => {
  afterEach(() => jest.useRealTimers());

  it('drops NUL bytes the ELM327 may slip into its output', async () => {
    const t = new FakeTransport((w, tr) => tr.emit('41 0C\u0000 1A F8\r\u0000\r>'));
    await expect(new TransportCommandPort(t).send('010C')).resolves.toBe('41 0C 1A F8');
  });

  it('treats ERR94 (fatal CAN error, chip back to defaults) as an adapter reset', async () => {
    const t = new FakeTransport((w, tr) => tr.emit('ERR94\r\r>'));
    const port = new TransportCommandPort(t);
    const resets = jest.fn();
    port.onAdapterReset(resets);
    await expect(port.send('03')).rejects.toBeInstanceOf(AdapterResetError);
    expect(resets).toHaveBeenCalledTimes(1);
  });

  it('treats other internal ERRxx codes as no data', async () => {
    const t = new FakeTransport((w, tr) => tr.emit('ERR12\r\r>'));
    await expect(new TransportCommandPort(t).send('03')).rejects.toBeInstanceOf(NoDataError);
  });

  it('keeps the real answer when a response-pending frame precedes it', async () => {
    const t = new FakeTransport((w, tr) => tr.emit('7F0478\r44\r\r>'));
    await expect(new TransportCommandPort(t).send('04')).resolves.toBe('44');
  });

  it('waits for the answer when only response-pending came back', async () => {
    jest.useFakeTimers();
    const t = new FakeTransport((w, tr) => tr.emit('7F 04 78\r\r>'));
    const result = new TransportCommandPort(t).send('04', 2000);
    await Promise.resolve();
    jest.advanceTimersByTime(3000); // past the command timeout: still waiting (J1979 allows 5 s)
    t.emit('44\r\r>');
    await expect(result).resolves.toBe('44');
    expect(t.writes).toEqual(['04\r']);
  });

  it('asks again after 5 s of silence, also with headers on', async () => {
    jest.useFakeTimers();
    let n = 0;
    const t = new FakeTransport((w, tr) => tr.emit(n++ === 0 ? '7E8037F0478\r\r>' : '7E80144\r\r>'));
    const result = new TransportCommandPort(t).send('04', 2000);
    await Promise.resolve();
    jest.advanceTimersByTime(5000);
    await expect(result).resolves.toBe('7E80144');
    expect(t.writes).toEqual(['04\r', '04\r']);
  });

  it('gives up after two resends that only get response-pending', async () => {
    jest.useFakeTimers();
    const t = new FakeTransport((w, tr) => tr.emit('7F0278\r\r>'));
    const result = new TransportCommandPort(t).send('0202', 2000);
    const check = expect(result).rejects.toBeInstanceOf(CommandTimeoutError);
    for (let i = 0; i < 3; i++) {
      await Promise.resolve();
      jest.advanceTimersByTime(5000);
    }
    await check;
    expect(t.writes).toHaveLength(3);
  });

  it('does not mistake a negative answer for response-pending', async () => {
    const t = new FakeTransport((w, tr) => tr.emit('7F0422\r\r>'));
    await expect(new TransportCommandPort(t).send('04')).resolves.toBe('7F0422');
  });
});
