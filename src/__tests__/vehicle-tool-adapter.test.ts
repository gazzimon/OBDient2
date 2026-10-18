import { AdapterResetError, ConnectionLostError, NoDataError } from '@/core/errors/obd.errors';
import type { CommandPort } from '@/data/adapters/protocol-manager';
import type { ObdSession, SessionInfo } from '@/data/obd/obd-session';
import { VehicleToolAdapter } from '@/data/obd/vehicle-tool-adapter';
import type { ToolCall, ToolOutcome } from '@/domain/assistant/tools';
import { FaultHistory } from '@/domain/faults/fault-history';

// A session on the B35 car (CAN 29 bit, engine ECU 18DAF111). Answers depend
// on whether headers are on, like the real adapter.
type Answer = string | { h0: string; h1: string } | Error;

function fakeSession(answers: Record<string, Answer>, info: Partial<SessionInfo> = {}) {
  let headers = false;
  const sent: string[] = [];
  let exclusiveRuns = 0;
  const send = async (command: string): Promise<string> => {
    sent.push(command);
    if (command === 'ATH1') headers = true;
    if (command === 'ATH0') headers = false;
    if (command.startsWith('AT')) return 'OK';
    const a = answers[command];
    if (a === undefined) throw new NoDataError(command);
    if (a instanceof Error) throw a;
    return typeof a === 'string' ? a : headers ? a.h1 : a.h0;
  };
  const port: CommandPort = { send };
  const sessionInfo: SessionInfo = {
    protocol: 'ISO_15765_4_CAN_29BIT_500K',
    identity: { elm: 'ELM327 v1.5', stn: 'STN1040 v1.3.6' },
    supportedPids: ['RPM', 'COOLANT_TEMP'],
    supportedPidNumbers: [0x05, 0x0c, 0x0d, 0x31],
    ...info,
  };
  const session = {
    sessionInfo,
    send,
    exclusive: async <T>(work: (p: CommandPort, i: SessionInfo) => Promise<T>) => {
      exclusiveRuns++;
      return work(port, sessionInfo);
    },
    settled: async () => undefined,
    speedRateHz: () => 20.7,
    requestStyle: () => 'stpx',
    adapterResets: 0,
    runBench: async () => ({ identity: [], styles: [{ style: 'stpx', ok: 20, total: 20, hz: 20.7, meanMs: 48 }] }),
  } as unknown as ObdSession;
  return { session, sent, exclusiveRuns: () => exclusiveRuns };
}

const signal = new AbortController().signal;
const ok = (o: ToolOutcome) => {
  if (!o.ok) throw new Error(`${o.error}: ${o.message}`);
  return o.data as Record<string, unknown>;
};

const B35 = {
  '0101': { h0: '41010007E100', h1: '18DAF1110641010007E100' },
  '0131': { h0: '41310895', h1: '18DAF1110441310895' },
  '03': { h0: '4300', h1: '18DAF111024300' },
  '020200': { h0: '4202000000', h1: '18DAF111054202000000' },
  '0902': {
    h0: '014\n0:490201384147\n1:45413736433052\n2:52313137353235',
    h1: '18DAF1111014490201384147\n18DAF1112145413736433052\n18DAF1112252313137353235',
  },
};

describe('VehicleToolAdapter', () => {
  it('reads codes with headers when parked, and puts headers back off', async () => {
    const { session, sent, exclusiveRuns } = fakeSession({ '03': { h0: '43020171', h1: '18DAF11106430201710301' } });
    const tools = new VehicleToolAdapter(() => session);
    const data = ok(await tools.execute({ name: 'read_dtcs', kind: 'stored' }, signal));
    expect(data.codes).toEqual([
      { code: 'P0171', ecu: '18DAF111', system: 'powertrain', owner: 'standard', description: null },
      { code: 'P0301', ecu: '18DAF111', system: 'powertrain', owner: 'standard', description: null },
    ]);
    expect(sent).toEqual(['ATH1', '03', 'ATH0']);
    expect(exclusiveRuns()).toBe(1);
  });

  it('while moving: no headers, no pause of the telemetry', async () => {
    const { session, sent, exclusiveRuns } = fakeSession(B35);
    const tools = new VehicleToolAdapter(() => session, { moving: () => true });
    const out = await tools.execute({ name: 'read_dtcs', kind: 'stored' }, signal);
    expect(out).toMatchObject({ ok: true, summary: 'Sin códigos guardados' });
    expect(sent).toEqual(['03']);
    expect(exclusiveRuns()).toBe(0);
  });

  it('adds a description when a source has one', async () => {
    const { session } = fakeSession({ '07': { h0: '', h1: '18DAF1110447010301' } });
    const info = {
      title: 'Cylinder 1 Misfire Detected',
      summary: 'The engine module detects misfire on cylinder 1.',
      causes: [{ likelihood: 'high' as const, cause: 'Ignition coil of cylinder 1 faulty' }],
      symptoms: ['Rough idle'],
      repair: { difficulty: 'easy', costEur: [20, 150] as const },
      reliability: 'checked' as const,
    };
    const tools = new VehicleToolAdapter(() => session, { describer: { describe: async (c) => (c === 'P0301' ? info : null) } });
    const data = ok(await tools.execute({ name: 'read_dtcs', kind: 'pending' }, signal));
    expect(data.codes).toEqual([
      expect.objectContaining({
        code: 'P0301',
        description: 'Cylinder 1 Misfire Detected. The engine module detects misfire on cylinder 1.',
        causes: info.causes,
        reliability: 'checked',
      }),
    ]);
  });

  it('a refusal from the car becomes rejected_by_car with the reason', async () => {
    const { session } = fakeSession({ '0A': { h0: '7F0A11', h1: '18DAF111037F0A11' } });
    const out = await new VehicleToolAdapter(() => session).execute({ name: 'read_dtcs', kind: 'permanent' }, signal);
    expect(out).toEqual({ ok: false, error: 'rejected_by_car', message: 'El auto rechazó el pedido: el auto no soporta ese pedido.' });
  });

  it('readiness on the B35 car: all monitors complete, 2197 km since cleared', async () => {
    const { session } = fakeSession(B35);
    const out = await new VehicleToolAdapter(() => session).execute({ name: 'read_readiness' }, signal);
    expect(ok(out)).toEqual({
      milOn: false,
      dtcCount: 0,
      ignition: 'spark',
      complete: ['misfire', 'fuel_system', 'components', 'catalyst', 'oxygen_sensor', 'oxygen_sensor_heater', 'egr_vvt'],
      incomplete: [],
      distSinceClear: { value: 2197, unit: 'km' },
    });
    expect(out).toMatchObject({ summary: 'Testigo apagado, 0 códigos, monitores completos' });
  });

  it('freeze frame: none stored on the B35 car', async () => {
    const { session } = fakeSession(B35);
    const out = await new VehicleToolAdapter(() => session).execute({ name: 'read_freeze_frame' }, signal);
    expect(out).toEqual({ ok: true, data: { stored: false }, summary: 'Sin freeze frame guardado' });
  });

  it('freeze frame: the code and the stored values', async () => {
    const { session, sent } = fakeSession({
      '020200': { h0: '', h1: '18DAF111054202000171' },
      // Supported: 02, 05, 0C
      '020000': { h0: '', h1: '18DAF1110742000048100000' },
      '020500': { h0: '', h1: '18DAF1110442050083' },
      '020C00': { h0: '', h1: '18DAF11105420C000C58' },
    });
    const data = ok(await new VehicleToolAdapter(() => session).execute({ name: 'read_freeze_frame' }, signal));
    expect(data).toEqual({
      stored: true,
      dtc: { code: 'P0171', ecu: '18DAF111', system: 'powertrain', owner: 'standard', description: null },
      values: { RPM: { value: 790, unit: 'rpm' }, COOLANT_TEMP: { value: 91, unit: '°C' } },
    });
    expect(sent).toEqual(['ATH1', '020200', '020000', '020C00', '020500', 'ATH0']);
  });

  it('vehicle info: the VIN and the PIDs the app can read on this car', async () => {
    const { session } = fakeSession(B35);
    const data = ok(await new VehicleToolAdapter(() => session).execute({ name: 'read_vehicle_info' }, signal));
    expect(data).toEqual({
      vin: '8AGEA76C0RR117525',
      vinWellFormed: true,
      supportedPids: ['RPM', 'SPEED', 'COOLANT_TEMP', 'DIST_SINCE_CLEAR'],
    });
  });

  it('live values share the link; one silent PID does not sink the others', async () => {
    const { session, exclusiveRuns } = fakeSession({ '010C': '410C0C58' });
    const out = await new VehicleToolAdapter(() => session).execute({ name: 'read_pids', pids: ['RPM', 'COOLANT_TEMP'] }, signal);
    expect(ok(out)).toEqual({ RPM: { value: 790, unit: 'rpm' }, COOLANT_TEMP: { value: null, unit: '°C' } });
    expect(exclusiveRuns()).toBe(0);
  });

  it('samples for the requested seconds and summarises', async () => {
    let t = 0;
    let rpm = 3000;
    const { session } = fakeSession({});
    (session as unknown as { send: (c: string) => Promise<string> }).send = async () => {
      rpm += 40;
      return `410C${(rpm & 0xffff).toString(16).toUpperCase().padStart(4, '0')}`;
    };
    const tools = new VehicleToolAdapter(() => session, { now: () => t, sleep: async (ms) => void (t += ms) });
    const data = ok(await tools.execute({ name: 'sample_pids', pids: ['RPM'], seconds: 2 }, signal));
    expect(data.RPM).toMatchObject({ n: 8, min: 760, max: 830, unit: 'rpm' });
  });

  it('clears codes and reports the distance before; a refusal says why', async () => {
    const good = fakeSession({ ...B35, '04': { h0: '44', h1: '18DAF1110144' } });
    const data = ok(await new VehicleToolAdapter(() => good.session).execute({ name: 'clear_dtcs' }, signal));
    expect(data).toEqual({ cleared: true, ecus: ['18DAF111'], refused: [], distSinceClearBeforeKm: 2197 });

    const refused = fakeSession({ ...B35, '04': { h0: '7F0422', h1: '18DAF111037F0422' } });
    expect(await new VehicleToolAdapter(() => refused.session).execute({ name: 'clear_dtcs' }, signal)).toEqual({
      ok: false,
      error: 'rejected_by_car',
      message: 'El auto rechazó el pedido: condiciones no correctas (por ejemplo, el motor en marcha).',
    });
  });

  it('adapter info, with the voltage the STN measures', async () => {
    const { session } = fakeSession({});
    (session as unknown as { send: (c: string) => Promise<string> }).send = async (c) => (c === 'STVR' ? '14.32' : 'OK');
    const data = ok(await new VehicleToolAdapter(() => session).execute({ name: 'read_adapter_info', includePower: true, fullCheck: false }, signal));
    expect(data).toEqual({
      chip: 'STN1040 v1.3.6',
      stn: true,
      protocol: 'ISO_15765_4_CAN_29BIT_500K',
      speedHz: 20.7,
      requestStyle: 'stpx',
      adapterResets: 0,
      volts: 14.32,
    });
  });

  it('writes reads and clears to the fault history, with the VIN read once', async () => {
    let json: string | null = null;
    const history = new FaultHistory({ load: () => json, save: (j) => void (json = j) });
    const { session, sent } = fakeSession({ ...B35, '03': { h0: '43020171', h1: '18DAF1110443010171' }, '04': { h0: '44', h1: '18DAF1110144' } });
    const tools = new VehicleToolAdapter(() => session, { history });
    await tools.execute({ name: 'read_dtcs', kind: 'stored' }, signal);
    await tools.execute({ name: 'read_dtcs', kind: 'stored' }, signal);
    await tools.execute({ name: 'clear_dtcs' }, signal);
    expect(sent.filter((c) => c === '0902')).toHaveLength(1);
    expect(history.list().map((e) => e.type)).toEqual(['cleared', 'codes']);
    expect(history.lastClear('8AGEA76C0RR117525')).toMatchObject({
      distSinceClearBeforeKm: 2197,
      codesBefore: [{ code: 'P0171', ecu: '18DAF111', owner: 'standard' }],
    });
  });

  it('read_pids answers from the Dashboard when its value is fresh; sampling always reads the bus', async () => {
    let now = 10_000;
    const { session, sent } = fakeSession({ '010C': '410C0C80' });
    const tools = new VehicleToolAdapter(() => session, {
      now: () => now,
      sleep: async (ms) => void (now += ms),
      live: (pid) => (pid === 'RPM' ? { value: 812, at: 9_000 } : null),
    });
    expect(ok(await tools.execute({ name: 'read_pids', pids: ['RPM'] }, signal))).toEqual({ RPM: { value: 812, unit: 'rpm' } });
    expect(sent).toEqual([]);
    now = 12_000; // 3 s old: read the car
    expect(ok(await tools.execute({ name: 'read_pids', pids: ['RPM'] }, signal))).toEqual({ RPM: { value: 800, unit: 'rpm' } });
    sent.length = 0;
    await tools.execute({ name: 'sample_pids', pids: ['RPM'], seconds: 2 }, signal);
    expect(sent.length).toBeGreaterThan(1);
  });

  it('battery voltage: STVR on STN, ATRV on a plain ELM327', async () => {
    const stn = fakeSession({});
    (stn.session as unknown as { send: (c: string) => Promise<string> }).send = async (c) => (c === 'STVR' ? '14.32' : 'NO');
    expect(ok(await new VehicleToolAdapter(() => stn.session).execute({ name: 'read_pids', pids: ['VOLTAGE'] }, signal))).toEqual({
      VOLTAGE: { value: 14.32, unit: 'V' },
    });
    const elm = fakeSession({}, { identity: { elm: 'ELM327 v2.2', stn: null } });
    (elm.session as unknown as { send: (c: string) => Promise<string> }).send = async (c) => (c === 'ATRV' ? '12.6V' : 'NO');
    expect(ok(await new VehicleToolAdapter(() => elm.session).execute({ name: 'read_pids', pids: ['VOLTAGE'] }, signal))).toEqual({
      VOLTAGE: { value: 12.6, unit: 'V' },
    });
  });

  it('a read interrupted by an adapter reboot is retried once the session recovered', async () => {
    let resets = 1;
    let waited = 0;
    const { session } = fakeSession({
      ...B35,
      '0101': { h0: '', h1: '18DAF1110641010007E100' },
    });
    const s = session as unknown as { exclusive: (w: unknown) => Promise<unknown>; settled: () => Promise<void> };
    const exclusive = s.exclusive;
    s.exclusive = async (w) => {
      if (resets-- > 0) throw new AdapterResetError('0101');
      return exclusive(w);
    };
    s.settled = async () => void waited++;
    const out = await new VehicleToolAdapter(() => session).execute({ name: 'read_readiness' }, signal);
    expect(out).toMatchObject({ ok: true });
    expect(waited).toBe(1);

    resets = 2; // rebooted again on the retry: give up with the reason
    expect(await new VehicleToolAdapter(() => session).execute({ name: 'read_readiness' }, signal)).toMatchObject({
      ok: false,
      error: 'adapter_reset',
    });
  });

  it('clearing is never retried by itself after a reboot', async () => {
    const { session, sent } = fakeSession({ ...B35, '04': { h0: '44', h1: '18DAF1110144' } });
    const s = session as unknown as { exclusive: (w: unknown) => Promise<unknown> };
    s.exclusive = async () => {
      throw new AdapterResetError('04');
    };
    expect(await new VehicleToolAdapter(() => session).execute({ name: 'clear_dtcs' }, signal)).toMatchObject({ ok: false, error: 'adapter_reset' });
    expect(sent).not.toContain('04');
  });

  it('MAF readings come with the fuel estimate the app computes', async () => {
    const { session } = fakeSession({ '0110': '411000FC' }); // 2.52 g/s
    const data = ok(await new VehicleToolAdapter(() => session).execute({ name: 'read_pids', pids: ['MAF'] }, signal));
    expect(data.fuelEstimate).toMatchObject({ litersPerHour: 0.83, litersPer100Km: null });
  });

  it('the VIN check digit is only reported for North American VINs', async () => {
    const { session } = fakeSession(B35);
    const data = ok(await new VehicleToolAdapter(() => session).execute({ name: 'read_vehicle_info' }, signal));
    expect(data).not.toHaveProperty('vinCheckDigitOk');
  });

  it('calculate and the fault history work without the adapter', async () => {
    let json: string | null = null;
    const history = new FaultHistory({ load: () => json, save: (j) => void (json = j) });
    history.record({ type: 'cleared', vin: 'X', ecus: [], distSinceClearBeforeKm: 2204, codesBefore: [] });
    const tools = new VehicleToolAdapter(() => null, { history });
    expect(await tools.execute({ name: 'calculate', expression: '2204 * 0.621371' }, signal)).toMatchObject({
      ok: true,
      data: { result: 1369.501684 },
    });
    expect(await tools.execute({ name: 'calculate', expression: '1/0' }, signal)).toMatchObject({ ok: false, error: 'invalid_arguments' });
    const hist = ok(await tools.execute({ name: 'read_fault_history' }, signal));
    expect(hist.events).toEqual([expect.objectContaining({ type: 'cleared', distSinceClearBeforeKm: 2204 })]);
  });

  it('full adapter check: modules that answer, and a genuine ELM327', async () => {
    const elm = fakeSession(
      { '0100': { h0: '4100BE1FB813', h1: '7E8064100BE1FB813\n7E906410080000001' } },
      { identity: { elm: 'ELM327 v2.2', stn: null }, protocol: 'ISO_15765_4_CAN_11BIT_500K' },
    );
    const data = ok(await new VehicleToolAdapter(() => elm.session).execute({ name: 'read_adapter_info', includePower: false, fullCheck: true }, signal));
    expect(data).toMatchObject({ modules: ['7E8', '7E9'], genuine: 'yes', sleepsByItself: false });
    expect(elm.sent).toEqual(expect.arrayContaining(['ATH1', '0100', 'ATH0', 'ATAMC', 'ATCTM1']));
  });

  it('maps failures to tool errors', async () => {
    const none = new VehicleToolAdapter(() => null);
    expect(await none.execute({ name: 'read_readiness' }, signal)).toMatchObject({ ok: false, error: 'not_connected' });

    const lost = fakeSession({ '0101': new ConnectionLostError('Adapter link dropped') });
    expect(await new VehicleToolAdapter(() => lost.session).execute({ name: 'read_readiness' }, signal)).toMatchObject({
      ok: false,
      error: 'not_connected',
    });

    const aborted = new AbortController();
    aborted.abort();
    const call: ToolCall = { name: 'read_dtcs', kind: 'stored' };
    expect(await new VehicleToolAdapter(() => fakeSession(B35).session).execute(call, aborted.signal)).toMatchObject({
      error: 'cancelled',
    });
  });
});
