import { Listeners, type ByteTransport } from '@/data/adapters/transport';
import { ObdSession } from '@/data/obd/obd-session';

// A simulated STN adapter on a CAN car. Replies asynchronously, like a radio.
class SimAdapter implements ByteTransport {
  connected = false;
  // stn: false → a plain ELM327 (STI → '?'). asleep: the first command only
  // wakes the chip and gets no answer, like an ELM327 after ATLP.
  constructor(private readonly opts: { stn?: boolean; asleep?: boolean } = {}) {}
  sent: string[] = [];
  private inFlight = new Set<ReturnType<typeof setTimeout>>();
  private data = new Listeners<[string]>();
  private drops = new Listeners<[]>();

  async connect() {
    this.connected = true;
  }
  async disconnect() {
    this.connected = false;
  }
  isConnected() {
    return this.connected;
  }
  async write(d: string) {
    const cmd = d.trim();
    this.sent.push(cmd);
    if (this.opts.asleep) {
      this.opts.asleep = false;
      return;
    }
    const answer = cmd === 'STI' && this.opts.stn === false ? '?' : reply(cmd);
    const timer = setTimeout(() => {
      this.inFlight.delete(timer);
      this.data.emit(`${answer}\r\r>`);
    }, 1);
    this.inFlight.add(timer);
  }
  onData(l: (c: string) => void) {
    return this.data.add(l);
  }
  onDisconnect(l: () => void) {
    return this.drops.add(l);
  }
  // The chip reboots: whatever it was answering is lost, then it prints this.
  brownOut() {
    for (const t of this.inFlight) clearTimeout(t);
    this.inFlight.clear();
    this.data.emit('LV RESET\r\rELM327 v1.4b\r\r>');
  }
  count(cmd: string) {
    return this.sent.filter((c) => c === cmd).length;
  }
}

function reply(cmd: string): string {
  if (cmd === 'ATWS' || cmd === 'ATI') return 'ELM327 v1.4b';
  if (cmd === 'STI') return 'ARM2120 v5.10.3';
  if (cmd === '0100') return '41 00 18 18 00 13';
  if (cmd === 'ATDP') return 'ISO 15765-4 (CAN 11/500)';
  if (cmd.startsWith('STPX d:010D')) return '410D32';
  if (cmd.startsWith('01')) return 'NO DATA';
  if (cmd === 'ATRV') return '12.6V';
  return 'OK';
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('ObdSession', () => {
  it('detects the STN chip, applies fast settings and reads speed with STPX', async () => {
    const sim = new SimAdapter();
    const session = new ObdSession(sim);
    const info = await session.open('dev');
    expect(info.identity.stn).toBe('ARM2120 v5.10.3');
    expect(info.protocol).toBe('ISO_15765_4_CAN_11BIT_500K');
    expect(sim.sent).toEqual(expect.arrayContaining(['ATS0', 'ATAT2']));

    const speeds: number[] = [];
    try {
      session.startTelemetry({ onSpeed: (k) => speeds.push(k), onParameter: () => undefined, onStopped: () => undefined });
      await tick(150);
      expect(speeds.length).toBeGreaterThan(5);
      expect(speeds[0]).toBe(50);
      expect(session.requestStyle()).toBe('stpx');
    } finally {
      await session.close();
    }
  });

  it('re-initialises after LV RESET and keeps delivering speed', async () => {
    const sim = new SimAdapter();
    const session = new ObdSession(sim);
    await session.open('dev');
    const speeds: number[] = [];
    try {
      session.startTelemetry({ onSpeed: (k) => speeds.push(k), onParameter: () => undefined, onStopped: () => undefined });
      await tick(50);

      sim.brownOut();
      await tick(300);
      const before = speeds.length;
      await tick(100);

      expect(session.adapterResets).toBe(1);
      expect(sim.count('ATWS')).toBe(2);
      expect(sim.count('ATS0')).toBe(2);
      expect(speeds.length).toBeGreaterThan(before);
    } finally {
      await session.close();
    }
  });

  it('puts a plain ELM327 to sleep on close, never an STN', async () => {
    for (const stn of [false, true]) {
      const sim = new SimAdapter({ stn });
      const session = new ObdSession(sim);
      const info = await session.open('dev');
      expect(info.identity.stn == null).toBe(!stn);
      await session.close();
      expect(sim.count('ATLP')).toBe(stn ? 0 : 1);
      expect(sim.connected).toBe(false);
    }
  });

  it('wakes a sleeping ELM327: the first reset is lost, the second one answers', async () => {
    const sim = new SimAdapter({ stn: false, asleep: true });
    const session = new ObdSession(sim);
    const info = await session.open('dev');
    expect(sim.sent.slice(0, 2)).toEqual(['ATWS', 'ATZ']);
    expect(info.protocol).toBeDefined();
    await session.close();
  });
});

