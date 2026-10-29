import { ConnectionLostError, NoDataError } from '@/core/errors/obd.errors';
import type { CommandPort } from '@/data/adapters/protocol-manager';
import type { ObdSession, SessionInfo } from '@/data/obd/obd-session';
import { VehicleToolAdapter } from '@/data/obd/vehicle-tool-adapter';
import { evaluatePolicy } from '@/domain/assistant/policy';
import { parseToolCall, type ToolOutcome } from '@/domain/assistant/tools';
import { isProbeCommand } from '@/domain/obd/did-probe';

// A GM on 29-bit CAN with the ABS at 18DA28F1 (it answers on 18DAF128), seen
// through an STN. The engine answers the codes by function (03) on 18DAF110.
interface CarOptions {
  volts?: string;
  // The code list after the probe (a module that logs a communication error).
  codesAfter?: string;
  dropOn?: string;
  stn?: boolean;
}

function absCar(opts: CarOptions = {}) {
  const sent: string[] = [];
  let header = '';
  let filter: string | null = null;
  let codeReads = 0;
  let dropOn: string | null = opts.dropOn ?? null;
  const vinFrames = '18DAF128 10 14 62 F1 90 38 41 47\n18DAF128 21 45 41 37 36 43 30 52\n18DAF128 22 52 30 30 30 30 39 39';
  const send = async (command: string): Promise<string> => {
    sent.push(command);
    if (dropOn && command === dropOn) {
      dropOn = null;
      throw new ConnectionLostError('lost');
    }
    if (command === 'STVR' || command === 'ATRV') return opts.volts ?? '13.8V';
    if (command.startsWith('ATSH ')) header = command.slice(5);
    else if (command === 'ATCRA') filter = null;
    else if (command.startsWith('ATCRA ')) filter = command.slice(6);
    if (command.startsWith('AT') || command.startsWith('ST')) return 'OK';
    if (command === '03') {
      codeReads++;
      return codeReads === 1 || !opts.codesAfter ? '18DAF110 02 43 00' : opts.codesAfter;
    }
    const seen = header === '18DA28F1' && (filter === '18DAF128' || filter === null);
    if (!seen) throw new NoDataError(command);
    switch (command) {
      case '3E00':
        return '18DAF128 02 7E 00';
      case '22F190':
        return vinFrames;
      case '22F187':
        return '18DAF128 06 62 F1 87 01 02 03';
      case '22F189':
        return '18DAF128 03 7F 22 31';
      case '22F18C':
        return '18DAF128 03 7F 22 33';
      case '22F186':
        return '18DAF128 03 7F 22 22';
      case '220123':
        return '18DAF128 07 62 01 23 00 01 E2 40';
      default:
        throw new NoDataError(command);
    }
  };
  const port: CommandPort = { send };
  const sessionInfo = {
    protocol: 'ISO_15765_4_CAN_29BIT_500K',
    identity: { elm: 'ELM327 v1.4b', stn: opts.stn === false ? null : 'STN1040 v1.3.6' },
    supportedPids: [],
    supportedPidNumbers: [],
  } as unknown as SessionInfo;
  const session = { sessionInfo, send, exclusive: async <T>(work: (p: CommandPort, i: SessionInfo) => Promise<T>) => work(port, sessionInfo), settled: async () => undefined } as unknown as ObdSession;
  return { tools: new VehicleToolAdapter(() => session), sent };
}

const signal = new AbortController().signal;
const probe = (header: string, mode: 'control' | 'list' | 'scan' = 'control', dids: string[] = [], range: { from?: string; to?: string } = {}, find: number | null = null) => ({
  name: 'did_probe' as const,
  header,
  mode,
  dids,
  from: range.from ?? null,
  to: range.to ?? null,
  find,
});
type Data = {
  find?: { value: number; matches: { did: string; encoding: string }[]; note: string }; range?: { from: string; to: string }; read?: number; counts?: Record<string, number>; verdict: string; explanation: string; testerPresent: boolean; results: { did: string; outcome: string; nrc?: string; length?: number; sample?: string }[]; stopped?: string; cursor?: string | null; newCodes?: string[]; batteryVolts: number | null };
const data = (o: ToolOutcome): Data => {
  if (!o.ok) throw new Error(`${o.error}: ${o.message}`);
  return o.data as Data;
};
const result = (d: Data, did: string) => d.results.find((r) => r.did === did)!;

describe('did_probe: control', () => {
  it('a module that answers proves the link, and each DID says what it is', async () => {
    const { tools } = absCar();
    const d = data(await tools.execute(probe('18DA28F1'), signal));
    expect(d.verdict).toBe('link_ok');
    expect(d.testerPresent).toBe(true);
    expect(result(d, 'F190')).toEqual({ did: 'F190', outcome: 'supported', length: 17 });
    expect(result(d, 'F187')).toEqual({ did: 'F187', outcome: 'supported', length: 3 });
    expect(result(d, 'F189')).toEqual({ did: 'F189', outcome: 'unsupported', nrc: '31' });
    expect(result(d, 'F18C').outcome).toBe('locked');
    expect(result(d, 'F186').outcome).toBe('needs_conditions');
    expect(d.batteryVolts).toBe(13.8);
  });

  it('never hands the model the VIN, nor the value of an identification DID', async () => {
    const { tools } = absCar();
    const out = await tools.execute(probe('18DA28F1'), signal);
    const text = JSON.stringify(out);
    expect(text).not.toContain('8AGEA76C0RR');
    expect(text).not.toContain('000099');
    expect(text).not.toContain('38 41 47');
  });

  it('sends nothing but reads and adapter settings, and leaves the adapter as telemetry needs it', async () => {
    const { tools, sent } = absCar();
    await tools.execute(probe('18DA28F1'), signal);
    expect(sent.filter((c) => !isProbeCommand(c) && c !== 'STVR' && c !== 'ATRV')).toEqual([]);
    expect(sent).toContain('ATSH 18DA28F1');
    expect(sent).toContain('ATCRA 18DAF128');
    const lastRead = sent.lastIndexOf('22F186');
    expect(sent.lastIndexOf('ATSH 18DB33F1')).toBeGreaterThan(lastRead);
    expect(sent.lastIndexOf('ATCRA')).toBeGreaterThan(lastRead);
    expect(sent.at(-1)).toBe('ATH0');
  });

  it('on an ELM327 the battery is read with ATRV', async () => {
    const { tools, sent } = absCar({ stn: false });
    expect(data(await tools.execute(probe('18DA28F1'), signal)).verdict).toBe('link_ok');
    expect(sent).toContain('ATRV');
    expect(sent).not.toContain('STVR');
  });
});

describe('did_probe: when nobody answers', () => {
  it('a header with no module behind it is a link problem, and the text says what to check', async () => {
    const { tools } = absCar();
    const d = data(await tools.execute(probe('18DA77F1'), signal));
    expect(d.verdict).toBe('link_silent');
    expect(d.testerPresent).toBe(false);
    expect(d.results.every((r) => r.outcome === 'silent')).toBe(true);
    expect(d.explanation).toContain('18DA<módulo>F1');
    expect(d.explanation).toContain('CAN FD');
  });

  it('ten silences in a row stop the probe, with the DID to continue from', async () => {
    const { tools } = absCar();
    const dids = Array.from({ length: 12 }, (_, i) => (0x0200 + i).toString(16).toUpperCase().padStart(4, '0'));
    const d = data(await tools.execute(probe('18DA28F1', 'list', dids), signal));
    expect(d.results).toHaveLength(10);
    expect(d.stopped).toContain('sin respuesta');
    expect(d.cursor).toBe('020A');
  });
});

describe('did_probe: list', () => {
  it('reads the DIDs given, keeping a sample of the ones that are not identification', async () => {
    const { tools } = absCar();
    const out = await tools.execute(probe('18DA28F1', 'list', ['0123', 'f189']), signal);
    const d = data(out);
    expect(result(d, '0123')).toEqual({ did: '0123', outcome: 'supported', length: 4, sample: '00 01 E2 40' });
    expect(result(d, 'F189').outcome).toBe('unsupported');
    expect(out.ok && out.summary).toContain('1 supported');
  });

  it('find: says which DID holds the number the dashboard shows, as a candidate', async () => {
    const { tools } = absCar();
    // 0123 answers 00 01 E2 40 = 123456.
    const out = await tools.execute(probe('18DA28F1', 'list', ['0123', 'F189'], {}, 123456), signal);
    const d = data(out);
    expect(d.find!.matches).toContainEqual(expect.objectContaining({ did: '0123', encoding: 'entero de 3 bytes, big-endian, en km' }));
    expect(d.find!.note).toContain('no confirmados');
    expect(out.ok && out.summary).toContain('123456 aparece en 0123');
  });

  it('find: nothing found is said with what it does not prove; identification DIDs are not searched', async () => {
    const { tools } = absCar();
    const none = data(await tools.execute(probe('18DA28F1', 'list', ['0123'], {}, 999), signal));
    expect(none.find).toMatchObject({ matches: [], note: expect.stringContaining('No prueba') });
    // F187 answers 01 02 03 = 66051: a part number, not searched.
    expect(data(await tools.execute(probe('18DA28F1', 'list', ['F187'], {}, 66051), signal)).find!.matches).toEqual([]);
  });

  it('refuses what is not a DID before touching the car', async () => {
    const { tools, sent } = absCar();
    expect(await tools.execute(probe('18DA28F1', 'list', ['F190', 'nope']), signal)).toMatchObject({ ok: false, error: 'invalid_arguments' });
    expect(sent).toEqual([]);
  });
});

describe('did_probe: guards', () => {
  it('does not start on a weak battery, and touches no header', async () => {
    const { tools, sent } = absCar({ volts: '11.2V' });
    const out = await tools.execute(probe('18DA28F1'), signal);
    expect(out).toMatchObject({ ok: false, message: expect.stringContaining('11.2') });
    expect(sent.some((c) => c.startsWith('ATSH'))).toBe(false);
  });

  it('refuses the ID a module answers with, a header of the wrong width and the functional address', async () => {
    const { tools, sent } = absCar();
    expect(await tools.execute(probe('18DAF128'), signal)).toMatchObject({ ok: false, error: 'invalid_arguments', message: expect.stringContaining('18DA28F1') });
    expect(await tools.execute(probe('7E0'), signal)).toMatchObject({ ok: false, error: 'invalid_arguments', message: expect.stringContaining('29 bits') });
    expect(await tools.execute(probe('18DB33F1'), signal)).toMatchObject({ ok: false, error: 'invalid_arguments' });
    expect(sent).toEqual([]);
  });

  it('reports a code that showed up while probing', async () => {
    const { tools } = absCar({ codesAfter: '18DAF110 04 43 01 01 71' });
    const out = await tools.execute(probe('18DA28F1'), signal);
    expect(data(out).newCodes).toEqual(['P0171']);
    expect(out.ok && out.summary).toContain('códigos nuevos: P0171');
  });

  it('a dropped link is reported, and the header is put back anyway', async () => {
    const { tools, sent } = absCar({ dropOn: '22F187' });
    expect(await tools.execute(probe('18DA28F1'), signal)).toMatchObject({ ok: false, error: 'not_connected' });
    expect(sent.lastIndexOf('ATSH 18DB33F1')).toBeGreaterThan(sent.indexOf('22F187'));
  });
});

describe('did_probe: scan', () => {
  it('is refused until a control probe proved that module, and touches nothing meanwhile', async () => {
    const { tools, sent } = absCar();
    const out = await tools.execute(probe('18DA28F1', 'scan', [], { from: 'F186', to: 'F18C' }), signal);
    expect(out).toMatchObject({ ok: false, message: expect.stringContaining('modo "control"') });
    expect(sent).toEqual([]);
  });

  it('after a control with link_ok it reads the range and hands the model only what answered', async () => {
    const { tools, sent } = absCar();
    expect(data(await tools.execute(probe('18DA28F1'), signal)).verdict).toBe('link_ok');
    sent.length = 0;
    const out = await tools.execute(probe('18DA28F1', 'scan', [], { from: 'F186', to: 'F18C' }), signal);
    const d = data(out);
    expect(d.range).toEqual({ from: 'F186', to: 'F18C' });
    expect(d.read).toBe(7);
    expect(d.counts).toMatchObject({ supported: 1, unsupported: 1, locked: 1, needs_conditions: 1, silent: 3 });
    // The 4 that said nothing useful are only counted; the 3 that answered are listed.
    expect(d.results.map((r) => r.did)).toEqual(['F186', 'F187', 'F18C']);
    expect(sent.filter((c) => !isProbeCommand(c) && c !== 'STVR')).toEqual([]);
    expect(sent.filter((c) => c.startsWith('22'))).toHaveLength(7);
  });

  it('a control that found the module silent does not open the door, nor does another module', async () => {
    const { tools } = absCar();
    expect(data(await tools.execute(probe('18DA77F1'), signal)).verdict).toBe('link_silent');
    expect(await tools.execute(probe('18DA77F1', 'scan', [], { from: 'F186', to: 'F18C' }), signal)).toMatchObject({ ok: false });
    expect(data(await tools.execute(probe('18DA28F1'), signal)).verdict).toBe('link_ok');
    expect(await tools.execute(probe('18DA60F1', 'scan', [], { from: 'F186', to: 'F18C' }), signal)).toMatchObject({ ok: false, message: expect.stringContaining('18DA60F1') });
  });

  it('refuses a range that is backwards or past 512 DIDs', async () => {
    const { tools } = absCar();
    await tools.execute(probe('18DA28F1'), signal);
    expect(await tools.execute(probe('18DA28F1', 'scan', [], { from: '0000', to: 'FFFF' }), signal)).toMatchObject({ ok: false, error: 'invalid_arguments' });
    expect(await tools.execute(probe('18DA28F1', 'scan', [], { from: 'F1FF', to: 'F100' }), signal)).toMatchObject({ ok: false, error: 'invalid_arguments' });
  });

  it('with no range it reads F100–F1FF, and keeps going from the cursor when it stops', async () => {
    const { tools } = absCar();
    await tools.execute(probe('18DA28F1'), signal);
    // Nobody answers F100–F109: ten silences in a row stop it, with the next DID.
    const d = data(await tools.execute(probe('18DA28F1', 'scan'), signal));
    expect(d.range).toEqual({ from: 'F100', to: 'F1FF' });
    expect(d.read).toBe(10);
    expect(d.stopped).toContain('sin respuesta');
    expect(d.cursor).toBe('F10A');
  });
});

describe('did_probe: the tool call and its policy', () => {
  it('parses the header, defaults to control and refuses what does not fit', () => {
    expect(parseToolCall('did_probe', '{"header":"18da28f1"}', [])).toMatchObject({ ok: true, call: { name: 'did_probe', header: '18DA28F1', mode: 'control', dids: [], from: null, to: null, find: null } });
    expect(parseToolCall('did_probe', '{"header":"714","mode":"scan","find":87654}', [])).toMatchObject({ ok: true, call: { mode: 'scan', find: 87654 } });
    expect(parseToolCall('did_probe', '{"header":"714","find":87654}', [])).toMatchObject({ ok: false }); // control reads identification DIDs only
    expect(parseToolCall('did_probe', '{"header":"714","mode":"scan","find":"87654"}', [])).toMatchObject({ ok: false });
    expect(parseToolCall('did_probe', '{"header":"714","mode":"scan","find":876.5}', [])).toMatchObject({ ok: false });
    expect(parseToolCall('did_probe', '{"header":"7E0","mode":"list","dids":["F190"]}', [])).toMatchObject({ ok: true, call: { mode: 'list', dids: ['F190'] } });
    expect(parseToolCall('did_probe', '{"header":"7E0","mode":"list"}', [])).toMatchObject({ ok: false });
    expect(parseToolCall('did_probe', '{"header":"7E0","mode":"scan"}', [])).toMatchObject({ ok: true, call: { mode: 'scan', from: null, to: null } });
    expect(parseToolCall('did_probe', '{"header":"7E0","mode":"scan","from":"f100","to":"F1FF"}', [])).toMatchObject({ ok: true, call: { from: 'F100', to: 'F1FF' } });
    expect(parseToolCall('did_probe', '{"header":"7E0","mode":"scan","from":"F1"}', [])).toMatchObject({ ok: false });
    expect(parseToolCall('did_probe', '{"header":"7E0","mode":"control","from":"F100"}', [])).toMatchObject({ ok: false });
    expect(parseToolCall('did_probe', '{"header":"7E0","mode":"sweep"}', [])).toMatchObject({ ok: false });
    expect(parseToolCall('did_probe', '{}', [])).toMatchObject({ ok: false });
    expect(parseToolCall('did_probe', '{"header":"7E0","range":"F100"}', [])).toMatchObject({ ok: false });
    expect(parseToolCall('did_probe', `{"header":"7E0","mode":"list","dids":${JSON.stringify(Array(33).fill('F190'))}}`, [])).toMatchObject({ ok: false });
  });

  it('a sweep is confirmed by the user every time; control and list are not', () => {
    const ctx = { moving: false, navigating: false, labMode: true, clearsThisConversation: 0 };
    expect(evaluatePolicy(probe('18DA28F1', 'scan'), ctx)).toEqual({ kind: 'confirm' });
    expect(evaluatePolicy(probe('18DA28F1', 'list', ['F190']), ctx)).toEqual({ kind: 'allow' });
    expect(evaluatePolicy(probe('18DA28F1', 'scan'), { ...ctx, moving: true })).toMatchObject({ kind: 'deny' });
    expect(evaluatePolicy(probe('18DA28F1', 'scan'), { ...ctx, labMode: false })).toMatchObject({ kind: 'deny' });
  });

  it('only in laboratory mode, with the car stopped and no navigation', () => {
    const call = probe('18DA28F1');
    const ctx = { moving: false, navigating: false, labMode: true, clearsThisConversation: 0 };
    expect(evaluatePolicy(call, ctx)).toEqual({ kind: 'allow' });
    expect(evaluatePolicy(call, { ...ctx, labMode: false })).toMatchObject({ kind: 'deny', error: 'not_supported' });
    expect(evaluatePolicy(call, { ...ctx, moving: true })).toMatchObject({ kind: 'deny', error: 'not_allowed_while_moving' });
    expect(evaluatePolicy(call, { ...ctx, navigating: true })).toMatchObject({ kind: 'deny', error: 'not_allowed_while_moving' });
  });
});
