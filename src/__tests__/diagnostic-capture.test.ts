import { AdapterResetError, CommandTimeoutError, NoDataError } from '@/core/errors/obd.errors';
import { Listeners } from '@/data/adapters/transport';
import {
  CAPTURE_ROUNDS,
  formatCapture,
  isReadOnly,
  runDiagnosticCapture,
  type CapturePort,
} from '@/data/obd/diagnostic-capture';

// Answers from a table; a function value throws instead.
function fakePort(answers: Record<string, string | (() => never)>): CapturePort & { sent: string[] } {
  const raws = new Listeners<[string]>();
  const sent: string[] = [];
  return {
    sent,
    onRaw: (l) => raws.add(l),
    async send(command) {
      sent.push(command);
      const a = answers[command];
      if (typeof a === 'function') return a();
      raws.emit(a ?? 'OK');
      return a ?? 'OK';
    },
  };
}

const ctx = { adapter: 'STN1040 v1.3.6', protocol: 'ISO_15765_4_CAN_29BIT_500K', stn: true, can: true };

describe('diagnostic capture', () => {
  it('never contains a request that clears or writes', () => {
    for (const round of CAPTURE_ROUNDS) for (const c of round.commands) expect(isReadOnly(c)).toBe(true);
    expect(isReadOnly('04')).toBe(false);
    expect(isReadOnly('14FFFFFF')).toBe(false);
    expect(isReadOnly('0 4')).toBe(false);
    // Anything outside the OBD read modes, UDS included, never reaches the car.
    for (const c of ['1101', '2803', '2EF190', '2F0101', '3101FF00', '8502', '1902FF', '22F190', '04'])
      expect(isReadOnly(c)).toBe(false);
    expect(isReadOnly('STPX d:04')).toBe(false);
    expect(isReadOnly('STPX d:010D, r:1')).toBe(true);
    expect(isReadOnly('ATH1')).toBe(true);
  });

  it('skips a forbidden command even if a round lists it', async () => {
    const port = fakePort({});
    await runDiagnosticCapture(port, ctx, [{ title: 't', commands: ['03', '04', '0A'] }]);
    expect(port.sent).toEqual(['03', '0A']);
  });

  it('records failures and keeps going', async () => {
    const port = fakePort({
      '07': () => {
        throw new NoDataError('07');
      },
      '0A': () => {
        throw new CommandTimeoutError('0A', 6000);
      },
    });
    const report = await runDiagnosticCapture(port, ctx, [{ title: 't', commands: ['07', '0A', '03'] }]);
    expect(report.rounds[0]!.entries.map((e) => e.outcome)).toEqual(['no-data', 'timeout', 'ok']);
    expect(report.interrupted).toBeNull();
  });

  it('stops when the adapter reboots', async () => {
    const port = fakePort({
      '03': () => {
        throw new AdapterResetError('03');
      },
    });
    const report = await runDiagnosticCapture(port, ctx, [
      { title: 'a', commands: ['0101', '03', '07'] },
      { title: 'b', commands: ['0902'] },
    ]);
    expect(port.sent).toEqual(['0101', '03']);
    expect(report.interrupted).toBe('el adaptador se reinició');
  });

  it('runs the STN round only on STN and the clone check only on ELM327', async () => {
    const titles = async (stn: boolean) =>
      (await runDiagnosticCapture(fakePort({}), { ...ctx, stn })).rounds.map((r) => r.title);
    expect(await titles(true)).toEqual(['Sin encabezados (ATH0)', 'Con encabezados (ATH1)', 'Comandos STN']);
    expect(await titles(false)).toEqual(['Sin encabezados (ATH0)', 'Con encabezados (ATH1)', 'ELM327: genuino o clon']);
  });

  it('shows how the frame reader assembled each OBD answer, with headers once ATH1 is on', async () => {
    const port = fakePort({
      '03': '18DAF11003430171AAAAAAAA\n18DAF11801430000AAAAAA',
      '0902': '014\n0:490201314434\n1:47503030523535\n2:42313233343536',
    });
    const report = await runDiagnosticCapture(port, ctx, [
      { title: 'a', commands: ['0902'] },
      { title: 'b', commands: ['ATH1', '03'] },
    ]);
    const text = formatCapture(report);
    // The serial of the VIN (its last 6 characters) is hidden, in the assembled line and in the frames.
    expect(text).toContain('  = ECU ?: 49 02 01 31 44 34 47 50 30 30 52 35 35 42 ** ** ** ** ** **');
    expect(text).toContain('  2:42************');
    expect(text).not.toContain('313233343536');
    expect(text).toContain('  = 18DAF110: 43 01 71');
    expect(text).toContain('  = 18DAF118: 43');
    expect(report.rounds[1]!.entries[0]!.messages).toBeUndefined();
  });

  it('formats raw answers under each command', async () => {
    const port = fakePort({ '0902': '014 0: 490201314731 1: 4A433534343452 2: 37323532333637' });
    const report = await runDiagnosticCapture(port, ctx, [{ title: 'VIN', commands: ['0902'] }], () => 0);
    // Raw frames stay (they show how the car frames its answer); the serial bytes do not.
    expect(formatCapture(report)).toContain('> 0902 (0 ms)\n  014 0: 490201314731 1: 4A433534343452 2: 37************');
  });
});
