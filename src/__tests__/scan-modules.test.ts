import { NoDataError } from '@/core/errors/obd.errors';
import type { CommandPort } from '@/data/adapters/protocol-manager';
import type { ObdSession, SessionInfo } from '@/data/obd/obd-session';
import { VehicleToolAdapter } from '@/data/obd/vehicle-tool-adapter';
import { parseToolCall, type ToolOutcome } from '@/domain/assistant/tools';
import { mergeTargets, needsFlowPair, noAnswer, refusalIn, requestHeader, type ScanTarget } from '@/domain/obd/module-scan';
import { makeFromVin } from '@/domain/obd/vin-make';

// A VW on 11-bit CAN: the engine answers on 7E8 and the brakes (713) on 77D.
// Like the real adapter, a module's answer is only seen when the receive
// filter lets it through — the default filter takes 7E8–7EF only.
function vwCar(identity: SessionInfo['identity']) {
  const sent: string[] = [];
  let header = '';
  let filter: string | null = null;
  const modules: Record<string, string> = { '7E0': '7E8', '713': '77D' };
  const send = async (command: string): Promise<string> => {
    sent.push(command);
    if (command === 'AT UDS1' || command.startsWith('STP')) return '?';
    if (command.startsWith('ATSH ')) header = command.slice(5);
    else if (command === 'ATCRA') filter = null;
    else if (command.startsWith('ATCRA ')) filter = command.slice(6);
    if (command.startsWith('AT') || command.startsWith('ST')) return 'OK';
    const rx = modules[header];
    const seen = rx && (filter === rx || (filter === null && /^7E[89A-F]$/.test(rx)));
    if (command === '3E00' && seen) return `${rx} 02 7E 00`;
    // Brakes: their part number (F187). Engine: no F187 (7F 22 31), but the VIN.
    if (command === '22F187' && seen) return header === '713' ? `${rx} 10 0E 62 F1 87 35 51 30` : `${rx} 03 7F 22 31`;
    if (command === '22F190' && seen && header === '7E0') return `${rx} 10 14 62 F1 90 39 42 57`;
    throw new NoDataError(command);
  };
  const port: CommandPort = { send };
  const sessionInfo: SessionInfo = {
    protocol: 'ISO_15765_4_CAN_11BIT_500K',
    identity,
    supportedPids: [],
    supportedPidNumbers: [],
  };
  const session = {
    sessionInfo,
    send,
    exclusive: async <T>(work: (p: CommandPort, i: SessionInfo) => Promise<T>) => work(port, sessionInfo),
    settled: async () => undefined,
  } as unknown as ObdSession;
  return { session, sent };
}

const VW_TARGETS: ScanTarget[] = [
  { id: '11:713', reqHeader: '713', rxHeader: '77D', label: 'Brake1' },
  { id: '29:28', reqHeader: '18DA28F1', rxHeader: '18DAF128', label: 'ABS 29' },
];
const signal = new AbortController().signal;
const data = (o: ToolOutcome) => {
  if (!o.ok) throw new Error(`${o.error}: ${o.message}`);
  return o.data as { modules: { id: string; partNumber: string | null }[]; make: string; skippedOtherIdWidth?: number };
};

describe('scan_modules with the make’s addresses', () => {
  it('finds the brakes on 77D (STN): filter on the module’s answer, its own flow-control pair', async () => {
    const { session, sent } = vwCar({ elm: 'ELM327 v1.5', stn: 'STN1040 v1.3.6' });
    const asked: string[] = [];
    const tools = new VehicleToolAdapter(() => session, {
      knownTargets: async (make) => {
        asked.push(make);
        return VW_TARGETS;
      },
    });
    const out = await tools.execute({ name: 'scan_modules', make: 'Volkswagen', model: 'Gol Trend' }, signal);
    const d = data(out);
    expect(asked).toEqual(['volkswagen']);
    expect(d.modules.map((m) => m.id).sort()).toEqual(['11:713', '11:7E0']);
    expect(d.skippedOtherIdWidth).toBe(1); // the 29-bit ABS on an 11-bit car
    // Identified by F187 (part number); the engine refuses F187 and gives F190.
    const part = Object.fromEntries(d.modules.map((m) => [m.id, m.partNumber]));
    expect(part['11:713']).toContain('62 F1 87');
    expect(part['11:7E0']).toContain('62 F1 90');
    expect(sent).toContain('ATCRA 77D');
    expect(sent).toContain('STCFCPA 713, 77D');
    // A custom pair turns the default flow control off: cleared before each
    // module and at the end.
    expect(sent.lastIndexOf('STCFCPC')).toBeGreaterThan(sent.lastIndexOf('STCFCPA 713, 77D'));
    expect(out.ok && out.knowledge).toMatchObject({ make: 'volkswagen', model: 'Gol Trend' });
    // What goes to the lab (read by every user) says what the car is, not which one:
    // no VIN field. (The F190 answer of the engine is the VIN: a full reply has its
    // serial hidden by redactText, see redact.test.ts; this car's fixture only
    // has the first frame.)
    const shared = (out.ok && out.knowledge) as { vin?: unknown; modules: { id: string; partNumber: string | null }[] };
    expect(shared.vin).toBeUndefined();
    expect(shared.modules.find((m) => m.id === '11:7E0')!.partNumber).toContain('62 F1 90');
    expect(shared.modules.find((m) => m.id === '11:713')!.partNumber).toContain('62 F1 87');
  });

  it('plain ELM: flow control by ATFCSH, back to automatic at the end', async () => {
    const { session, sent } = vwCar({ elm: 'ELM327 v2.1', stn: null } as unknown as SessionInfo['identity']);
    const tools = new VehicleToolAdapter(() => session, { knownTargets: async () => VW_TARGETS });
    data(await tools.execute({ name: 'scan_modules', make: 'volkswagen', model: null }, signal));
    expect(sent).toContain('ATFCSH 713');
    expect(sent).toContain('ATFCSM 1');
    expect(sent.lastIndexOf('ATFCSM 0')).toBeGreaterThan(sent.lastIndexOf('ATFCSM 1'));
  });

  it('no make (unknown VIN, none given): generic scan only, nothing reported to the lab', async () => {
    const { session } = vwCar({ elm: 'ELM327 v1.5', stn: 'STN1040 v1.3.6' });
    const knownTargets = jest.fn(async () => VW_TARGETS);
    const tools = new VehicleToolAdapter(() => session, { knownTargets });
    const out = await tools.execute({ name: 'scan_modules', make: null, model: null }, signal);
    expect(knownTargets).not.toHaveBeenCalled();
    expect(data(out).modules.map((m) => m.id)).toEqual(['11:7E0']);
    expect(out.ok && out.knowledge).toBeUndefined();
  });
});

describe('scan helpers', () => {
  it('make from the VIN (WMI)', () => {
    expect(makeFromVin('9BWZZZ377VT004251')).toBe('volkswagen');
    expect(makeFromVin('8A1HSRBB4FL123456')).toBe('renault');
    expect(makeFromVin('9BGKS48U0FG123456')).toBe('chevrolet');
    expect(makeFromVin('JTDBR32E720123456')).toBe('toyota');
    expect(makeFromVin('XXX')).toBeNull();
    expect(makeFromVin(null)).toBeNull();
  });

  it('flow-control pair only when the default misses the module', () => {
    expect(needsFlowPair({ id: '11:7E0', reqHeader: '7E0', rxHeader: '7E8', label: '' })).toBe(false);
    expect(needsFlowPair({ id: '11:713', reqHeader: '713', rxHeader: '77D', label: '' })).toBe(true);
    expect(needsFlowPair({ id: '11:752', reqHeader: '752', rxHeader: '652', label: '' })).toBe(true);
    expect(needsFlowPair({ id: '29:10', reqHeader: '18DA10F1', rxHeader: '18DAF110', label: '' })).toBe(false);
    expect(needsFlowPair({ id: '29:2D', reqHeader: '18DA2DF1', rxHeader: '18DAF12D', label: '' })).toBe(false);
  });

  it('merge: no repeats, same ID width, capped at 32', () => {
    const base: ScanTarget[] = [{ id: '11:7E0', reqHeader: '7E0', rxHeader: '7E8', label: '' }];
    const many: ScanTarget[] = Array.from({ length: 40 }, (_, i) => {
      const req = (0x700 + i).toString(16).toUpperCase();
      return { id: `11:${req}`, reqHeader: req, rxHeader: (0x700 + i + 0x6a).toString(16).toUpperCase(), label: '' };
    });
    const { targets, skipped } = mergeTargets(base, [base[0]!, ...many], false);
    expect(targets).toHaveLength(33);
    expect(skipped).toBe(8);
  });

  it('scan_modules takes an optional make and model', () => {
    expect(parseToolCall('scan_modules', '{}', [])).toMatchObject({ ok: true, call: { make: null, model: null } });
    expect(parseToolCall('scan_modules', '{"make":"Renault","model":"Sandero"}', [])).toMatchObject({ ok: true, call: { make: 'Renault' } });
    expect(parseToolCall('scan_modules', '{"bus":"MS"}', [])).toMatchObject({ ok: false });
  });
});

// A GM on 29-bit CAN, like the 2026-10-21 Tracker: the body module 11 answers on
// 18DAF111, and only when the request goes to 18DA11F1 and the filter lets it through.
function gmCar() {
  const sent: string[] = [];
  let header = '';
  let filter: string | null = null;
  const send = async (command: string): Promise<string> => {
    sent.push(command);
    if (command.startsWith('ATSH ')) header = command.slice(5);
    else if (command === 'ATCRA') filter = null;
    else if (command.startsWith('ATCRA ')) filter = command.slice(6);
    if (command.startsWith('AT') || command.startsWith('ST')) return 'OK';
    const seen = header === '18DA11F1' && (filter === '18DAF111' || filter === null);
    if (command === '22 F1 90' && seen) return '18DAF111 10 14 62 F1 90 38 41 47';
    if (command === '22 F1 87' && seen) return '18DAF111 03 7F 22 31';
    throw new NoDataError(command);
  };
  const sessionInfo: SessionInfo = { protocol: 'ISO_15765_4_CAN_29BIT_500K', identity: { elm: 'ELM327 v2.2', stn: null } as unknown as SessionInfo['identity'], supportedPids: [], supportedPidNumbers: [] };
  const port: CommandPort = { send };
  const session = { sessionInfo, send, exclusive: async <T>(work: (p: CommandPort, i: SessionInfo) => Promise<T>) => work(port, sessionInfo), settled: async () => undefined } as unknown as ObdSession;
  return { tools: new VehicleToolAdapter(() => session), sent };
}

describe('obd_command (lab)', () => {
  it('refuses the ID a module answers with, and says which one to ask', async () => {
    const { tools, sent } = gmCar();
    const out = await tools.execute({ name: 'obd_command', command: '22 F1 90', header: '18DAF111' }, signal);
    expect(out).toMatchObject({ ok: false, error: 'invalid_arguments', message: expect.stringContaining('18DA11F1') });
    expect(sent).toEqual([]);
  });

  it('asks the module with its own reply filter, and leaves the adapter as telemetry needs it', async () => {
    const { tools, sent } = gmCar();
    const out = await tools.execute({ name: 'obd_command', command: '22 F1 90', header: '18DA11F1' }, signal);
    expect(out).toMatchObject({ ok: true, data: { header: '18DA11F1', raw: expect.stringContaining('62 F1 90') } });
    expect(sent).toContain('ATSH 18DA11F1');
    expect(sent).toContain('ATCRA 18DAF111');
    // Restored: no filter, functional header, headers off.
    expect(sent.slice(-3)).toEqual(['ATCRA', 'ATSH 18DB33F1', 'ATH0']);
  });

  it('a refusal (7F) is an answer, in words; silence is not an answer, and the header is restored anyway', async () => {
    const { tools, sent } = gmCar();
    const refused = await tools.execute({ name: 'obd_command', command: '22 F1 87', header: '18DA11F1' }, signal);
    expect(refused).toMatchObject({ ok: true, data: { refused: { service: '22', code: '31' } }, summary: expect.stringContaining('no existe en este módulo') });
    const silent = await tools.execute({ name: 'obd_command', command: '22 F1 99', header: '18DA11F1' }, signal);
    expect(silent).toMatchObject({ ok: false, error: 'timeout', message: expect.stringContaining('No prueba que el dato no exista') });
    expect(sent.at(-2)).toBe('ATSH 18DB33F1');
  });

  it('the header width must be the protocol’s', async () => {
    const { tools } = gmCar();
    expect(await tools.execute({ name: 'obd_command', command: '22 F1 90', header: '7E0' }, signal)).toMatchObject({ ok: false, error: 'invalid_arguments', message: expect.stringContaining('29 bits') });
  });
});

describe('requestHeader / refusalIn / noAnswer', () => {
  it('11 bits: a response ID is refused with its request ID; a request gets its reply ID', () => {
    expect(requestHeader('7E8', false)).toMatchObject({ ok: false, message: expect.stringContaining('7E0') });
    expect(requestHeader('7e0', false)).toEqual({ ok: true, reqHeader: '7E0', rxHeader: '7E8' });
    expect(requestHeader('713', false)).toEqual({ ok: true, reqHeader: '713', rxHeader: null }); // maker-specific: no known reply ID
    expect(requestHeader('18DB33F1', true)).toEqual({ ok: true, reqHeader: '18DB33F1', rxHeader: null });
  });

  it('reads a refusal and its reason; "response pending" is not one', () => {
    expect(refusalIn('18DAF111 03 7F 22 33')).toEqual({ service: '22', code: '33', reason: 'necesita acceso de seguridad' });
    expect(refusalIn('7E8 03 7F 22 78')).toBeNull();
    expect(refusalIn('7E8 06 62 F1 87 01 02 03')).toBeNull();
  });

  it('knows silence from an answer', () => {
    expect(noAnswer('ERROR No data from adapter for command "22 F1 87"')).toBe(true);
    expect(noAnswer('NO DATA')).toBe(true);
    expect(noAnswer('18DAF111 03 7F 22 31')).toBe(false);
  });
});

describe('scan_modules after the fix', () => {
  it('restores the functional header at the end, and says what "none answered" does not prove', async () => {
    const { session, sent } = vwCar({ elm: 'ELM327 v1.5', stn: null } as unknown as SessionInfo['identity']);
    const tools = new VehicleToolAdapter(() => session, { knownTargets: async () => VW_TARGETS });
    await tools.execute({ name: 'scan_modules', make: 'volkswagen', model: null }, signal);
    expect(sent.slice(-2)).toEqual(['ATSH 7DF', 'ATH0']);
  });

  it('mergeTargets tells apart the other ID width from the cap', () => {
    const base = [{ id: '11:7E0', reqHeader: '7E0', rxHeader: '7E8', label: 'motor' }];
    const wide = { id: '29:28', reqHeader: '18DA28F1', rxHeader: '18DAF128', label: 'ABS' };
    const r = mergeTargets(base, [wide, { id: '11:713', reqHeader: '713', rxHeader: '77D', label: 'frenos' }], false);
    expect(r).toMatchObject({ otherWidth: 1, overLimit: 0, skipped: 1 });
  });
});
