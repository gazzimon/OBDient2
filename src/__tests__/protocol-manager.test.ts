import { CommandTimeoutError, NoDataError, ConnectionLostError, ProtocolDetectionError } from '@/core/errors/obd.errors';
import { ProtocolManager, type CommandPort } from '@/data/adapters/protocol-manager';

type Reply = string | Error;

// Scripted fake adapter: replies per command, records everything sent.
function fakePort(script: Record<string, Reply | Reply[]>): CommandPort & { sent: string[] } {
  const sent: string[] = [];
  const counters: Record<string, number> = {};
  return {
    sent,
    async send(command: string): Promise<string> {
      sent.push(command);
      const entry = script[command];
      if (entry === undefined) return 'OK';
      let reply: Reply;
      if (Array.isArray(entry)) {
        const n = counters[command] ?? 0;
        counters[command] = n + 1;
        reply = entry[Math.min(n, entry.length - 1)] ?? 'OK';
      } else {
        reply = entry;
      }
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
}

const noData = (c: string) => new NoDataError(c);

describe('ProtocolManager.initialize', () => {
  it('runs the init sequence with headers off and auto-detects CAN', async () => {
    const port = fakePort({
      '0100': '41 00 BE 3F A8 13',
      ATDP: 'AUTO, ISO 15765-4 (CAN 11/500)',
    });
    const result = await new ProtocolManager(port).initialize();
    expect(result).toEqual({
      protocol: 'ISO_15765_4_CAN_11BIT_500K',
      method: 'auto',
      atdp: 'AUTO, ISO 15765-4 (CAN 11/500)',
    });
    expect(port.sent.slice(0, 6)).toEqual(['ATWS', 'ATE0', 'ATL0', 'ATFE', 'ATH0', 'ATSP0']);
  });

  it('enables headers when asked', async () => {
    const port = fakePort({ '0100': '7E8 06 41 00 BE 3F A8 13', ATDP: 'ISO 15765-4 (CAN 11/500)' });
    await new ProtocolManager(port).initialize({ headers: true });
    expect(port.sent).toContain('ATH1');
    expect(port.sent).not.toContain('ATH0');
  });

  it('tolerates clones that never answer ATWS/ATE0', async () => {
    const port = fakePort({
      ATWS: new CommandTimeoutError('ATWS', 6000),
      ATE0: new CommandTimeoutError('ATE0', 4000),
      '0100': '41 00 BE 3F A8 13',
      ATDP: 'ISO 15765-4 (CAN 29/500)',
    });
    const result = await new ProtocolManager(port).initialize();
    expect(result.protocol).toBe('ISO_15765_4_CAN_29BIT_500K');
  });

  it('forces a protocol and verifies it with 0100', async () => {
    const port = fakePort({ '0100': '41 00 80 00 00 00', ATDP: 'ISO 15765-4 (CAN 11/250)' });
    const result = await new ProtocolManager(port).initialize({ protocol: 'ISO_15765_4_CAN_11BIT_250K' });
    expect(result).toMatchObject({ protocol: 'ISO_15765_4_CAN_11BIT_250K', method: 'forced' });
    expect(port.sent).toContain('ATSP8');
    expect(port.sent).not.toContain('ATSP0');
  });

  it('throws when a forced protocol does not answer', async () => {
    const port = fakePort({ '0100': 'UNABLE TO CONNECT' });
    await expect(
      new ProtocolManager(port).initialize({ protocol: 'ISO_15765_4_CAN_11BIT_500K' }),
    ).rejects.toBeInstanceOf(ProtocolDetectionError);
  });

  it('confirms J1939 with ATDP only (no mode 01)', async () => {
    const port = fakePort({ ATDP: 'SAE J1939 (CAN 29/250)' });
    const result = await new ProtocolManager(port).initialize({ protocol: 'SAE_J1939' });
    expect(result).toMatchObject({ protocol: 'SAE_J1939', method: 'forced' });
    expect(port.sent).toContain('ATSPA');
    expect(port.sent).not.toContain('0100');
  });

  it('falls back to scanning forced CAN protocols when auto fails', async () => {
    // auto probe fails, 6 fails, 7 fails, 8 answers
    const port = fakePort({
      '0100': [noData('0100'), noData('0100'), noData('0100'), '41 00 BE 3F A8 13'],
      ATDP: 'ISO 15765-4 (CAN 11/250)',
    });
    const result = await new ProtocolManager(port).initialize();
    expect(result).toMatchObject({ protocol: 'ISO_15765_4_CAN_11BIT_250K', method: 'scan' });
    expect(port.sent.filter((c) => c.startsWith('ATSP'))).toEqual(['ATSP0', 'ATSP6', 'ATSP7', 'ATSP8']);
  });

  it('only scans legacy buses when scanLegacy is set', async () => {
    const dead = { '0100': noData('0100') };
    const plain = fakePort(dead);
    await expect(new ProtocolManager(plain).initialize()).rejects.toBeInstanceOf(ProtocolDetectionError);
    expect(plain.sent).not.toContain('ATSP5');

    const legacy = fakePort(dead);
    await expect(new ProtocolManager(legacy).initialize({ scanLegacy: true })).rejects.toBeInstanceOf(ProtocolDetectionError);
    expect(legacy.sent).toEqual(expect.arrayContaining(['ATSP5', 'ATSP4', 'ATSP3', 'ATSP1', 'ATSP2']));
  });

  it('propagates a lost connection instead of scanning on', async () => {
    const port = fakePort({ '0100': new ConnectionLostError('gone') });
    await expect(new ProtocolManager(port).initialize()).rejects.toBeInstanceOf(ConnectionLostError);
  });
});

describe('ProtocolManager addressing', () => {
  it('sets an ECU target with request header and reply filter', async () => {
    const port = fakePort({});
    await new ProtocolManager(port).setTarget('7e0', '7e8');
    expect(port.sent).toEqual(['ATSH7E0', 'ATCRA7E8']);
  });

  it('rejects malformed CAN ids', async () => {
    await expect(new ProtocolManager(fakePort({})).setTarget('7E')).rejects.toThrow(/Invalid CAN id/);
  });

  it('restores functional addressing per id width', async () => {
    const p11 = fakePort({});
    await new ProtocolManager(p11).clearTarget('ISO_15765_4_CAN_11BIT_500K');
    expect(p11.sent).toEqual(['ATSH7DF', 'ATAR']);
    const p29 = fakePort({});
    await new ProtocolManager(p29).clearTarget('SAE_J1939');
    expect(p29.sent).toEqual(['ATSHDB33F1', 'ATAR']);
  });
});
