import { NoDataError } from '@/core/errors/obd.errors';
import type { CommandPort } from '@/data/adapters/protocol-manager';
import { identifyAdapter } from '@/data/obd/stn';
import { TelemetryPoller, toParameter, type TelemetryListener } from '@/data/obd/telemetry-poller';

function scripted(answers: Record<string, string | Error>): CommandPort & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    async send(command: string) {
      sent.push(command);
      const a = answers[command];
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

describe('TelemetryPoller', () => {
  it('asks speed every cycle and rotates the secondary PIDs', async () => {
    const port = scripted({ '010D1': '41 0D 32', '010C1': '41 0C 1A F8', '01111': '41 11 33' });
    const rec = recorder();
    const p = new TelemetryPoller(port, rec.listener, { can: true, secondary: ['RPM', 'TPS'] });
    await p.cycle();
    await p.cycle();
    expect(port.sent).toEqual(['010D1', '010C1', '010D1', '01111']);
    expect(rec.speeds).toEqual([50, 50]);
    expect(rec.params).toContain('RPM=1726');
  });

  it('falls back to plain commands when the adapter rejects the response count', async () => {
    const port = scripted({ '010D1': '?', '010D': '41 0D 0A', '010C': '41 0C 0F A0' });
    const rec = recorder();
    const p = new TelemetryPoller(port, rec.listener, { can: true, secondary: ['RPM'] });
    await p.cycle();
    await p.cycle();
    expect(rec.speeds).toEqual([10, 10]);
    expect(port.sent).toEqual(['010D1', '010D', '010C', '010D', '010C']);
  });

  it('uses plain commands off CAN', async () => {
    const port = scripted({ '010D': '41 0D 0A', ATRV: '12.6V' });
    const p = new TelemetryPoller(port, recorder().listener, { can: false, secondary: ['VOLTAGE'] });
    await p.cycle();
    expect(port.sent).toEqual(['010D', 'ATRV']);
  });
});

describe('toParameter', () => {
  it('flags threshold alerts', () => {
    expect(toParameter('RPM', 7000, 0).alert?.severity).toBe('warning');
    expect(toParameter('RPM', 2000, 0).alert).toBeNull();
  });
});

describe('identifyAdapter', () => {
  it('recognises an STN chip', async () => {
    const id = await identifyAdapter(scripted({ ATI: 'ELM327 v1.4b', STI: 'STN2120 r5.10.3' }));
    expect(id.stn).toBe('STN2120 r5.10.3');
  });

  it('treats "?" as not STN (plain ELM / clone)', async () => {
    const id = await identifyAdapter(scripted({ ATI: 'ELM327 v1.5', STI: '?' }));
    expect(id.stn).toBeNull();
  });
});
