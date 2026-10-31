import { NoDataError } from '@/core/errors/obd.errors';
import type { CommandPort } from '@/data/adapters/protocol-manager';
import type { ObdSession, SessionInfo } from '@/data/obd/obd-session';
import { frameMessages, VehicleToolAdapter } from '@/data/obd/vehicle-tool-adapter';
import { redactText } from '@/domain/privacy/redact';
import { parseToolCall, type ToolOutcome } from '@/domain/assistant/tools';
import { mergeTargets, needsFlowPair, noAnswer, refusalIn, requestHeader, type ScanTarget } from '@/domain/obd/module-scan';
import { makeFromVin } from '@/domain/obd/vin-make';
import { ModuleScanLog, type ModuleScanReport } from '@/domain/obd/module-scan-report';

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
    // Brakes: their part number (F187), three frames. Engine: no F187 (7F 22 31), but the VIN.
    if (command === '22F187' && seen) return header === '713' ? `${rx} 10 0E 62 F1 87 35 51 30\n${rx} 21 36 31 34 35 31 37 41\n${rx} 22 42 AA AA AA AA AA AA` : `${rx} 03 7F 22 31`;
    if (command === '22 F1 87' && seen && header === '713') return `${rx} 10 0E 62 F1 87 35 51 30\n${rx} 21 36 31 34 35 31 37 41\n${rx} 22 42 AA AA AA AA AA AA`;
    if (command === '22F190' && seen && header === '7E0') return `${rx} 10 14 62 F1 90 39 42 57`;
    throw new NoDataError(command);
  };
  const port: CommandPort = { send };
  const sessionInfo: SessionInfo = {
    protocol: 'ISO_15765_4_CAN_11BIT_500K',
    identity,
    supportedPids: [],
    supportedPidNumbers: [],
    supportedPidNumbersByEcu: [],
    pidDiscoveryStatus: 'unknown',
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
  return o.data as {
    buses: { bus: string; status: string; modules: number }[];
    modules: { id: string; partNumber: string | null; labelStatus?: string; identityStatus?: string; identitySource?: string | null }[];
    make: string;
    skippedOtherIdWidth?: number;
  };
}

describe('scan_modules with the make’s addresses', () => {
  it('finds the brakes on 77D (STN): filter on the module’s answer, its own flow-control pair', async () => {
    const { session, sent } = vwCar({ elm: 'ELM327 v1.5', stn: 'STN1040 v1.3.6' });
    const asked: string[] = [];
    const progress: unknown[] = [];
    const tools = new VehicleToolAdapter(() => session, {
      knownTargets: async (make) => {
        asked.push(make);
        return VW_TARGETS;
      },
    });
    const out = await tools.execute(
      { name: 'scan_modules', make: 'Volkswagen', model: 'Gol Trend' },
      signal,
      (event) => progress.push(event),
    );
    const d = data(out);
    expect(asked).toEqual(['volkswagen']);
    expect(d.modules.map((m) => m.id).sort()).toEqual(['11:713', '11:7E0']);
    expect(d.modules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: '11:713', identityStatus: 'identified', identitySource: 'F187' }),
        expect.objectContaining({ id: '11:7E0', identityStatus: 'identified', identitySource: 'F190' }),
      ]),
    );
    expect(d.buses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ bus: 'HS', status: 'scanned' }),
        expect.objectContaining({ bus: 'MS', status: 'unavailable', modules: 0 }),
        expect.objectContaining({ bus: 'SW', status: 'unavailable', modules: 0 }),
      ]),
    );
    expect(d.modules.find((m) => m.id === '11:713')).toMatchObject({ labelStatus: 'hint' });
    expect(progress).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'scan-started' }),
        expect.objectContaining({ type: 'bus-started', bus: 'HS' }),
        expect.objectContaining({ type: 'module-found', module: expect.objectContaining({ id: '11:713' }) }),
        expect.objectContaining({ type: 'module-identified', moduleId: '11:713', source: 'F187' }),
        expect.objectContaining({ type: 'module-identified', moduleId: '11:7E0', source: 'F190' }),
        expect.objectContaining({ type: 'scan-finished', modulesFound: 2 }),
      ]),
    );
    expect(JSON.stringify(progress)).not.toContain('5Q0614517AB');
    expect(d.skippedOtherIdWidth).toBe(1); // the 29-bit ABS on an 11-bit car
    // Identified by F187 (part number); the engine refuses F187 and gives F190.
    // The part number as text, not the frames; a cut answer says so.
    const part = Object.fromEntries(d.modules.map((m) => [m.id, m.partNumber]));
    expect(part['11:713']).toBe('5Q0614517AB');
    expect(part['11:7E0']).toBe('62 F1 90 39 42 57 (incompleta)');
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
    expect(shared.modules.find((m) => m.id === '11:713')!.partNumber).toBe('5Q0614517AB');
  });

  it('after the scan, obd_command and did_probe know the brakes answer on 77D', async () => {
    const { session, sent } = vwCar({ elm: 'ELM327 v1.5', stn: 'STN1040 v1.3.6' });
    const tools = new VehicleToolAdapter(() => session, { knownTargets: async () => VW_TARGETS });

    // Before: no filter, so the answer is lost, and the model is told why.
    const before = await tools.execute({ name: 'obd_command', command: '22 F1 87', header: '713' }, signal);
    expect(before).toMatchObject({ ok: false, error: 'timeout', message: expect.stringContaining('scan_modules') });
    const probeBefore = await tools.execute({ name: 'did_probe', header: '713', mode: 'control', dids: [], from: null, to: null, find: null }, signal);
    expect(probeBefore).toMatchObject({ ok: false, error: 'invalid_arguments', message: expect.stringContaining('scan_modules') });

    data(await tools.execute({ name: 'scan_modules', make: 'volkswagen', model: null }, signal));
    sent.length = 0;
    const after = await tools.execute({ name: 'obd_command', command: '22 F1 87', header: '713' }, signal);
    expect(after).toMatchObject({ ok: true, data: { messages: [{ ecu: '77D', complete: true, text: '5Q0614517AB' }] } });
    expect(after.ok && (after.data as { note?: string }).note).toBeUndefined();
    expect(sent).toContain('ATCRA 77D');
    expect(sent).toContain('STCFCPA 713, 77D');
    const probeAfter = await tools.execute({ name: 'did_probe', header: '713', mode: 'control', dids: [], from: null, to: null, find: null }, signal);
    expect(probeAfter).toMatchObject({ ok: true, data: { module: { reqHeader: '713', rxHeader: '77D' } } });
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

  it('reports a known-address lookup failure while continuing the generic scan', async () => {
    const { session } = vwCar({ elm: 'ELM327 v1.5', stn: 'STN1040 v1.3.6' });
    const progress: unknown[] = [];
    const tools = new VehicleToolAdapter(() => session, {
      knownTargets: async () => {
        throw new Error('server unavailable');
      },
    });
    const out = await tools.execute(
      { name: 'scan_modules', make: 'Volkswagen', model: null },
      signal,
      (event) => progress.push(event),
    );
    expect(data(out).modules.map((m) => m.id)).toEqual(['11:7E0']);
    expect(data(out)).toMatchObject({ warning: expect.stringContaining('direcciones conocidas') });
    expect(out.ok && out.summary).toContain('No se pudieron cargar direcciones conocidas');
    expect(progress).toContainEqual(expect.objectContaining({ type: 'lookup-warning' }));
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
  const sessionInfo: SessionInfo = {
    protocol: 'ISO_15765_4_CAN_29BIT_500K',
    identity: { elm: 'ELM327 v2.2', stn: null } as unknown as SessionInfo['identity'],
    supportedPids: [],
    supportedPidNumbers: [],
    supportedPidNumbersByEcu: [],
    pidDiscoveryStatus: 'unknown',
  };
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
    expect(out).toMatchObject({ ok: true, data: { header: '18DA11F1', messages: [{ ecu: '18DAF111', bytes: expect.stringContaining('62 F1 90') }] } });
    expect(out.ok && (out.data as { raw?: string }).raw).toBeUndefined(); // assembled: no raw frames beside it
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

describe('obd_command: the reply as the app reads it', () => {
  const frames = '18DAF111 10 14 62 F1 90 38 41 47\n18DAF111 21 45 41 37 36 43 30 52\n18DAF111 22 52 30 30 30 30 39 39';

  it('assembles a multi-frame answer (no 10 14 / 21 / 22 inside) and decodes the text', () => {
    const [m] = frameMessages(frames, true);
    expect(m).toMatchObject({ ecu: '18DAF111', complete: true, text: '8AGEA76C0RR000099' });
    expect(m!.bytes).toBe('62 F1 90 38 41 47 45 41 37 36 43 30 52 52 30 30 30 30 39 39');
  });

  it('what the model gets has the serial hidden in the bytes and in the text (it saw it split across frames before)', () => {
    const [m] = frameMessages(frames, true);
    const seen = redactText(JSON.stringify(m));
    expect(seen).not.toMatch(/000099|303030303939|30 30 30 30 39 39/);
    expect(seen).toContain('8AGEA76C0RR••••••');
  });

  it('a short or non-text answer has no text', () => {
    expect(frameMessages('18DAF111 06 62 F1 87 01 02 03', true)[0]).not.toHaveProperty('text');
    expect(frameMessages('NO DATA', true)).toEqual([]);
  });
});

describe('requestHeader / refusalIn / noAnswer', () => {
  it('11 bits: a response ID is refused with its request ID; a request gets its reply ID', () => {
    expect(requestHeader('7E8', false)).toMatchObject({ ok: false, message: expect.stringContaining('7E0') });
    expect(requestHeader('7e0', false)).toEqual({ ok: true, reqHeader: '7E0', rxHeader: '7E8' });
    expect(requestHeader('713', false)).toEqual({ ok: true, reqHeader: '713', rxHeader: null }); // maker-specific: no known reply ID
    expect(requestHeader('18DB33F1', true)).toEqual({ ok: true, reqHeader: '18DB33F1', rxHeader: null });
    // The pair a scan found on this car (the 2026-10-28 Audi dashboard: 714 → 77E).
    expect(requestHeader('714', false, new Map([['714', '77E']]))).toEqual({ ok: true, reqHeader: '714', rxHeader: '77E' });
  });

  it('reads a refusal and its reason; "response pending" is not one', () => {
    expect(refusalIn('18DAF111 03 7F 22 33')).toEqual({ service: '22', code: '33', reason: 'necesita acceso de seguridad' });
    expect(refusalIn('7E8 03 7F 22 78')).toBeNull();
    expect(refusalIn('7E8 06 62 F1 87 01 02 03')).toBeNull();
    expect(refusalIn('7E8037F1911', '19')).toMatchObject({ service: '19', code: '11' });
    expect(refusalIn('7F 22 31')).toMatchObject({ service: '22', code: '31' });
  });

  it('a 7F inside a positive answer is data, not a refusal (2026-10-28 Audi, 19 02 FF)', () => {
    // 59 02 <status mask 7F> then DTC records.
    expect(refusalIn('7E8 07 59 02 7F 00 00 00', '19')).toBeNull();
    expect(refusalIn('7E8 10 1B 59 02 7F 01 23 45\n7E8 21 08 02 34 56 08 AA AA', '19')).toBeNull();
    // A refusal of another service is not the answer to this one.
    expect(refusalIn('7E8 03 7F 22 31', '19')).toBeNull();
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

describe('the module scan as a report (the app’s screen and scan_modules share it)', () => {
  const memoryLog = () => {
    let saved: ModuleScanReport[] = [];
    return new ModuleScanLog({ load: () => saved, save: (r) => void (saved = [...r]) });
  };

  it('saves what was found and how far it looked, part numbers included', async () => {
    const { session } = vwCar({ elm: 'ELM327 v1.5', stn: 'STN1040 v1.3.6' });
    const scanLog = memoryLog();
    const tools = new VehicleToolAdapter(() => session, { knownTargets: async () => VW_TARGETS, scanLog, now: () => 42 });
    const report = await tools.moduleScans.scan({ make: 'Volkswagen', model: 'Gol Trend' }, signal);
    expect(report).toMatchObject({ at: 42, make: 'volkswagen', model: 'Gol Trend', path: 'stn', makeAddresses: { status: 'loaded', count: 2 }, skipped: { otherWidth: 1 } });
    expect(report.buses.map((b) => [b.bus, b.status])).toEqual([
      ['HS', 'scanned'],
      ['MS', 'unavailable'],
      ['SW', 'unavailable'],
    ]);
    const hs = report.buses[0]!;
    expect(hs.probed).toBe(hs.silent.length + 2);
    expect(hs.silent).not.toContain('11:713');
    expect(report.modules.find((m) => m.id === '11:713')).toMatchObject({ partNumber: '5Q0614517AB', identitySource: 'F187', identified: true });
    expect(scanLog.latest()).toEqual(report);
  });

  it('says when the make’s addresses were missing, and why', async () => {
    const { session } = vwCar({ elm: 'ELM327 v1.5', stn: 'STN1040 v1.3.6' });
    const failing = new VehicleToolAdapter(() => session, {
      knownTargets: async () => {
        throw new Error('offline');
      },
    });
    expect((await failing.moduleScans.scan({ make: 'vw' }, signal)).makeAddresses).toEqual({ status: 'failed', count: 0 });
    const none = new VehicleToolAdapter(() => session, { knownTargets: async () => [] });
    expect((await none.moduleScans.scan({ make: 'vw' }, signal)).makeAddresses.status).toBe('none');
    expect((await none.moduleScans.scan({}, signal)).makeAddresses.status).toBe('no-make');
  });

  it('cancelled: nothing saved, the adapter left as the telemetry needs it, "cancelled" for the chat', async () => {
    const { session, sent } = vwCar({ elm: 'ELM327 v1.5', stn: 'STN1040 v1.3.6' });
    const scanLog = memoryLog();
    const tools = new VehicleToolAdapter(() => session, { knownTargets: async () => VW_TARGETS, scanLog });
    const stop = new AbortController();
    const out = await tools.execute({ name: 'scan_modules', make: 'Volkswagen', model: null }, stop.signal, (e) => {
      if (e.type === 'module-identified') stop.abort();
    });
    expect(out).toMatchObject({ ok: false, error: 'cancelled' });
    expect(scanLog.latest()).toBeNull();
    expect(sent.slice(-2)).toEqual(['ATSH 7DF', 'ATH0']);
  });
});

describe('a saved report in a new session', () => {
  it('adopt() gives obd_command and did_probe the module’s reply ID without scanning again', async () => {
    const first = vwCar({ elm: 'ELM327 v1.5', stn: 'STN1040 v1.3.6' });
    const report = await new VehicleToolAdapter(() => first.session, { knownTargets: async () => VW_TARGETS }).moduleScans.scan({ make: 'vw' }, signal);
    const second = vwCar({ elm: 'ELM327 v1.5', stn: 'STN1040 v1.3.6' });
    const tools = new VehicleToolAdapter(() => second.session);
    expect(tools.moduleScans.pairs(second.session)).toBeUndefined();
    tools.moduleScans.adopt(report);
    expect(tools.moduleScans.pairs(second.session)?.get('713')).toBe('77D');
  });
});
