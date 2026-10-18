import { ConnectionLostError, NoDataError } from '@/core/errors/obd.errors';
import type { CommandPort } from '@/data/adapters/protocol-manager';
import type { ObdSession, SessionInfo } from '@/data/obd/obd-session';
import { VehicleToolAdapter } from '@/data/obd/vehicle-tool-adapter';
import type { ToolCall, ToolOutcome } from '@/domain/assistant/tools';

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
    const tools = new VehicleToolAdapter(() => session, { describer: { describe: (c) => (c === 'P0301' ? 'Cylinder 1 Misfire Detected' : null) } });
    const data = ok(await tools.execute({ name: 'read_dtcs', kind: 'pending' }, signal));
    expect(data.codes).toEqual([expect.objectContaining({ code: 'P0301', description: 'Cylinder 1 Misfire Detected' })]);
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
      vinCheckDigitOk: false,
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
    const data = ok(await new VehicleToolAdapter(() => session).execute({ name: 'read_adapter_info', includePower: true }, signal));
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
