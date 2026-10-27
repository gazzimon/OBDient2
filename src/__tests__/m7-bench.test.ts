import { ConnectionLostError, NoDataError } from '@/core/errors/obd.errors';
import type { CommandPort } from '@/data/adapters/protocol-manager';
import { formatM7Bench, parseMultiPid, pidLengths, runM7Bench, type M7Context } from '@/data/obd/m7-bench';

const LENGTHS = pidLengths();

// An ECU that answers mode 01 from the request text, whatever the style: the
// STPX wrapper and the count suffix are stripped as the adapter would.
function fakeEcu(opts: { onlyFirst?: boolean; failOn?: (command: string, n: number) => Error | null } = {}): CommandPort & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    async send(command) {
      sent.push(command);
      const err = opts.failOn?.(command, sent.length);
      if (err) throw err;
      if (!/^(01|STPX d:01)/.test(command)) return 'OK';
      const stpx = /^STPX d:([0-9A-F]+)/.exec(command)?.[1];
      let hex = stpx ?? command;
      if (!stpx && hex.length % 2 === 1) hex = hex.slice(0, -1); // response-count suffix
      const pids = hex.slice(2).match(/../g) ?? [];
      const answered = opts.onlyFirst ? pids.slice(0, 1) : pids;
      const body = answered.map((p) => `${p} ${'00 '.repeat(LENGTHS.get(parseInt(p, 16)) ?? 1).trim()}`).join(' ');
      return `41 ${body}`;
    },
  };
}

const ctx: M7Context = {
  adapter: 'STN1040 v1.3.6',
  protocol: 'ISO_15765_4_CAN_29BIT_500K',
  stn: true,
  can: true,
  styles: ['stpx', 'count', 'plain'],
  supported: ['RPM', 'COOLANT_TEMP', 'ENGINE_LOAD', 'TPS'],
};

let tick = 0;
const clock = () => (tick += 20);

describe('parseMultiPid', () => {
  it('splits a multi-PID answer by the length of each PID', () => {
    expect(parseMultiPid([0x41, 0x0d, 0x2a, 0x0c, 0x1a, 0xf8, 0x05, 0x5b], LENGTHS)).toEqual([0x0d, 0x0c, 0x05]);
  });

  it('stops at a PID it cannot measure, or at a truncated one, and never throws', () => {
    expect(parseMultiPid([0x41, 0x0d, 0x2a, 0xff, 0x01], LENGTHS)).toEqual([0x0d]);
    expect(parseMultiPid([0x41, 0x0d, 0x2a, 0x0c, 0x1a], LENGTHS)).toEqual([0x0d]);
    expect(parseMultiPid([0x7f, 0x01, 0x12], LENGTHS)).toEqual([]);
    expect(parseMultiPid([], LENGTHS)).toEqual([]);
  });
});

describe('runM7Bench', () => {
  beforeEach(() => {
    tick = 0;
  });

  it('measures 1, 2, 3 and 4 PIDs per request in every style, the loop of today and the diagnostics', async () => {
    const port = fakeEcu();
    const report = await runM7Bench(port, ctx, clock);
    expect(report.interrupted).toBeNull();
    const pids = report.arms.filter((a) => a.group === 'pids');
    expect(pids).toHaveLength(3 * 4); // 3 styles × sizes 1,2,3,4 (5 PIDs known, 6 not reachable)
    for (const a of pids) {
      expect(a.ok).toBe(a.total);
      expect(a.returned).toBe(a.ok * a.asked);
      expect(a.partial).toBe(0);
    }
    expect(pids.find((a) => a.label === 'stpx · 3 PID')?.command).toBe('STPX d:010D0C05, r:1, t:100');
    expect(pids.find((a) => a.label === 'count · 2 PID')?.command).toBe('010D0C1');
    const today = report.arms.find((a) => a.group === 'rotation');
    expect(today?.returned).toBe(2 * (today?.ok ?? 0));
    expect(report.arms.filter((a) => a.group === 'diagnostic').map((a) => a.label)).toEqual([
      '0101 plano',
      '0101 STPX r:1 t:300',
      '0902 plano',
      '0902 STPX r:1 t:300',
      '0902 con STCSEGR 1',
    ]);
  });

  it('counts an ECU that answers only the first PID as incomplete', async () => {
    const report = await runM7Bench(fakeEcu({ onlyFirst: true }), ctx, clock);
    const three = report.arms.find((a) => a.label === 'plain · 3 PID')!;
    expect(three.ok).toBe(three.total);
    expect(three.partial).toBe(three.ok);
    expect(three.returned).toBe(three.ok); // one PID per answer
  });

  it('never sends anything that is not a read, and switches STCSEGR back off', async () => {
    const port = fakeEcu();
    await runM7Bench(port, ctx, clock);
    expect(port.sent.every((c) => /^(01|02|03|07|09|0A|STPX d:0[1-9A]|STCSEGR [01])/.test(c))).toBe(true);
    expect(port.sent.filter((c) => c.startsWith('STCSEGR'))).toEqual(['STCSEGR 1', 'STCSEGR 0']);
  });

  it('skips the STN-only arms on an ELM327 and keeps the raw answers for the M7.1 fixtures', async () => {
    const report = await runM7Bench(fakeEcu(), { ...ctx, stn: false, styles: ['count', 'plain'] }, clock);
    expect(report.arms.some((a) => a.label.includes('STPX') || a.label.includes('STCSEGR'))).toBe(false);
    expect(report.arms.find((a) => a.label === 'plain · 2 PID')?.raw).toEqual(['41 0D 00 0C 00 00', '41 0D 00 0C 00 00']);
  });

  it('a request with no answer counts against the arm and the run goes on', async () => {
    const port = fakeEcu({ failOn: (c) => (c === '010D0C05' ? new NoDataError('NO DATA') : null) });
    const report = await runM7Bench(port, ctx, clock);
    const three = report.arms.find((a) => a.label === 'plain · 3 PID')!;
    expect(three.ok).toBe(0);
    expect(report.arms.find((a) => a.label === 'plain · 4 PID')!.ok).toBeGreaterThan(0);
  });

  it('a dropped link ends the measurement and keeps what was measured', async () => {
    const port = fakeEcu({ failOn: (_c, n) => (n > 40 ? new ConnectionLostError('lost') : null) });
    const report = await runM7Bench(port, ctx, clock);
    expect(report.interrupted).toBe('se perdió la conexión');
    expect(report.arms.length).toBeGreaterThan(0);
    expect(formatM7Bench(report)).toContain('INTERRUMPIDA: se perdió la conexión');
  });

  it('the text has the rates and the raw answers', async () => {
    const text = formatM7Bench(await runM7Bench(fakeEcu(), ctx, clock));
    expect(text).toContain('== Varios PIDs por pedido ==');
    expect(text).toContain('stpx · 3 PID → STPX d:010D0C05, r:1, t:100');
    expect(text).toMatch(/PID\/s/);
    expect(text).toContain('== Respuestas crudas (para los tests de M7.1) ==');
  });
});
