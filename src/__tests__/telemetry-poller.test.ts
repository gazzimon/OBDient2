import { AdapterResetError, NoDataError } from '@/core/errors/obd.errors';
import type { CommandPort } from '@/data/adapters/protocol-manager';
import { formatBench, runAdapterBench } from '@/data/obd/adapter-bench';
import { identifyAdapter, isStnId } from '@/data/obd/stn';
import { TelemetryPoller, requestFor, stylesFor, toParameter, type TelemetryListener } from '@/data/obd/telemetry-poller';

type Answer = string | Error | ((n: number) => string | Error);

function scripted(answers: Record<string, Answer>): CommandPort & { sent: string[] } {
  const sent: string[] = [];
  const counts: Record<string, number> = {};
  return {
    sent,
    async send(command: string) {
      sent.push(command);
      counts[command] = (counts[command] ?? 0) + 1;
      let a = answers[command];
      if (typeof a === 'function') a = a(counts[command]!);
      if (a === undefined) throw new NoDataError(command);
      if (a instanceof Error) throw a;
      return a;
    },
  };
}

function recorder() {
  const speeds: number[] = [];
  const params: string[] = [];
  const listener: TelemetryListener = {
    onSpeed: (kmh) => speeds.push(kmh),
    onParameter: (p) => params.push(`${p.pid}=${p.value}`),
    onStopped: () => undefined,
  };
  return { speeds, params, listener };
}

const STPX_SPEED = requestFor('stpx', '010D');

describe('request styles', () => {
  it('offers the documented STN command first, then the CAN suffix, then plain', () => {
    expect(stylesFor(true, true)).toEqual(['stpx', 'count', 'plain']);
    expect(stylesFor(false, true)).toEqual(['count', 'plain']);
    expect(stylesFor(true, false)).toEqual(['stpx', 'plain']);
    expect(STPX_SPEED).toBe('STPX d:010D, r:1, t:100');
  });
});

describe('TelemetryPoller', () => {
  it('asks speed every cycle and rotates the secondary PIDs', async () => {
    const port = scripted({ '010D1': '41 0D 32', '010C1': '41 0C 1A F8', '01111': '41 11 33' });
    const rec = recorder();
    const p = new TelemetryPoller(port, rec.listener, { styles: ['count', 'plain'], secondary: ['RPM', 'TPS'] });
    await p.cycle();
    await p.cycle();
    expect(port.sent).toEqual(['010D1', '010C1', '010D1', '01111']);
    expect(rec.speeds).toEqual([50, 50]);
    expect(rec.params).toContain('RPM=1726');
  });

  it('reads replies without spaces (ATS0)', async () => {
    const port = scripted({ [STPX_SPEED]: '410D32' });
    const rec = recorder();
    await new TelemetryPoller(port, rec.listener, { styles: ['stpx', 'plain'], secondary: [] }).cycle();
    expect(rec.speeds).toEqual([50]);
  });

  it('drops a style only after a slower one works where it failed, twice', async () => {
    const port = scripted({ [STPX_SPEED]: '?', '010D1': '41 0D 0A', '010D': '41 0D 0A' });
    const p = new TelemetryPoller(port, recorder().listener, { styles: ['stpx', 'count', 'plain'], secondary: [] });
    await p.cycle();
    expect(p.style).toBe('stpx');
    await p.cycle();
    expect(p.style).toBe('count');
    port.sent.length = 0;
    await p.cycle();
    expect(port.sent).toEqual(['010D1']);
  });

  it('does not demote anything on a genuine NO DATA', async () => {
    const port = scripted({});
    const p = new TelemetryPoller(port, recorder().listener, { styles: ['stpx', 'count', 'plain'], secondary: [] });
    await expect(p.cycle()).rejects.toBeInstanceOf(NoDataError);
    await expect(p.cycle()).rejects.toBeInstanceOf(NoDataError);
    expect(p.style).toBe('stpx');
  });

  it('forgives a single glitch of the fast style', async () => {
    const port = scripted({
      [STPX_SPEED]: (n) => (n === 1 ? new NoDataError('x') : '41 0D 0A'),
      '010D1': '41 0D 0A',
    });
    const p = new TelemetryPoller(port, recorder().listener, { styles: ['stpx', 'count', 'plain'], secondary: [] });
    for (let i = 0; i < 4; i++) await p.cycle();
    expect(p.style).toBe('stpx');
  });

  it('does not fall back on an adapter reset — the session recovers instead', async () => {
    const port = scripted({ [STPX_SPEED]: new AdapterResetError('x'), '010D': '41 0D 0A' });
    const p = new TelemetryPoller(port, recorder().listener, { styles: ['stpx', 'plain'], secondary: [] });
    await expect(p.cycle()).rejects.toBeInstanceOf(AdapterResetError);
    expect(port.sent).toEqual([STPX_SPEED]);
  });

  it('keeps speed flowing when a secondary PID fails, and drops it after 3 failures', async () => {
    const port = scripted({ '010D': '41 0D 0A' });
    const rec = recorder();
    const p = new TelemetryPoller(port, rec.listener, { styles: ['plain'], secondary: ['RPM'] });
    for (let i = 0; i < 5; i++) await p.cycle();
    expect(rec.speeds).toHaveLength(5);
    expect(port.sent.filter((c) => c === '010C')).toHaveLength(3);
  });

  it('sends adapter commands (ATRV) as they are', async () => {
    const port = scripted({ '010D': '41 0D 0A', ATRV: '12.6V' });
    const rec = recorder();
    await new TelemetryPoller(port, rec.listener, { styles: ['plain'], secondary: ['VOLTAGE'] }).cycle();
    expect(port.sent).toEqual(['010D', 'ATRV']);
    expect(rec.params).toContain('VOLTAGE=12.6');
  });
});

describe('toParameter', () => {
  it('flags threshold alerts', () => {
    expect(toParameter('RPM', 7000, 0).alert?.severity).toBe('warning');
    expect(toParameter('RPM', 2000, 0).alert).toBeNull();
  });
});

describe('STN detection', () => {
  it('recognises STN and the rebranded ARM ids from the vendor manual', () => {
    expect(isStnId('STN2120 v5.10.3')).toBe(true);
    expect(isStnId('ARM2120 v5.10.3')).toBe(true);
    expect(isStnId('ELM327 v1.5')).toBe(false);
    expect(isStnId(null)).toBe(false);
  });

  it('identifies an ARM-branded chip as STN', async () => {
    const id = await identifyAdapter(scripted({ ATI: 'ELM327 v1.4b', STI: 'ARM2100 v5.6.1' }));
    expect(id.stn).toBe('ARM2100 v5.6.1');
  });

  it('treats "?" as not STN (plain ELM / clone)', async () => {
    const id = await identifyAdapter(scripted({ ATI: 'ELM327 v1.5', STI: '?' }));
    expect(id.stn).toBeNull();
  });
});

describe('adapter bench', () => {
  it('reports identity and the measured rate of each style', async () => {
    let t = 0;
    const port = scripted({ STI: 'ARM2120 v5.10.3', STSN: '212012345678', [STPX_SPEED]: '410D32', '010D': (n) => (n % 2 ? '41 0D 32' : 'NO DATA') });
    const sendAndTick = port.send.bind(port);
    port.send = async (c: string) => {
      t += c.startsWith('STPX') ? 40 : 100;
      return sendAndTick(c);
    };
    const report = await runAdapterBench(port, ['stpx', 'plain'], 10, () => t);
    expect(report.identity.find((i) => i.command === 'STI')?.value).toBe('ARM2120 v5.10.3');
    expect(report.identity.find((i) => i.command === 'STDI')?.value).toBeNull();
    const [stpx, plain] = report.styles;
    expect(stpx).toMatchObject({ style: 'stpx', ok: 10, total: 10 });
    expect(stpx!.hz).toBeCloseTo(25, 0);
    expect(plain).toMatchObject({ style: 'plain', ok: 5 });
    expect(formatBench(report)).toContain('Firmware (STI): ARM2120 v5.10.3');
  });
});
