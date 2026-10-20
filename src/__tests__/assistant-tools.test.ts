import { evaluatePolicy, SAMPLE_SECONDS_WHILE_MOVING } from '@/domain/assistant/policy';
import { parseToolCall, TOOL_NAMES, toolPids, toolSchemas, type ToolCall } from '@/domain/assistant/tools';
import type { PidId } from '@/core/constants/pids';

const SUPPORTED: PidId[] = ['SPEED', 'RPM', 'COOLANT_TEMP', 'ENGINE_LOAD'];

describe('tool catalogue', () => {
  it('offers the PIDs this car supports plus battery voltage, in catalogue order', () => {
    expect(toolPids(['COOLANT_TEMP', 'RPM'])).toEqual(['RPM', 'COOLANT_TEMP', 'VOLTAGE']);
  });

  it('has fixed order, strict schemas and the supported PIDs as enum', () => {
    const schemas = toolSchemas(SUPPORTED);
    expect(schemas.map((s) => s.function.name)).toEqual([...TOOL_NAMES]);
    for (const s of schemas) expect(s.function.parameters.additionalProperties).toBe(false);
    const readPids = schemas[0]!.function.parameters as { properties: { pids: { items: { enum: string[] } } } };
    expect(readPids.properties.pids.items.enum).toEqual(['RPM', 'SPEED', 'COOLANT_TEMP', 'ENGINE_LOAD', 'VOLTAGE']);
  });

  it('is identical for the same car, so the prompt prefix can be cached', () => {
    expect(JSON.stringify(toolSchemas(SUPPORTED))).toBe(JSON.stringify(toolSchemas([...SUPPORTED].reverse())));
  });
});

describe('parseToolCall', () => {
  const ok = (name: string, args: string) => {
    const r = parseToolCall(name, args, SUPPORTED);
    if (!r.ok) throw new Error(r.message);
    return r.call;
  };
  const err = (name: string, args: string) => {
    const r = parseToolCall(name, args, SUPPORTED);
    if (r.ok) throw new Error('expected an error');
    return r;
  };

  it('accepts valid calls', () => {
    expect(ok('read_pids', '{"pids":["RPM","VOLTAGE"]}')).toEqual({ name: 'read_pids', pids: ['RPM', 'VOLTAGE'] });
    expect(ok('sample_pids', '{"pids":["RPM"],"seconds":10}')).toEqual({ name: 'sample_pids', pids: ['RPM'], seconds: 10 });
    expect(ok('read_dtcs', '{"kind":"pending"}')).toEqual({ name: 'read_dtcs', kind: 'pending' });
    expect(ok('read_adapter_info', '{"include_power":true}')).toEqual({ name: 'read_adapter_info', includePower: true, fullCheck: false });
    expect(ok('read_adapter_info', '{"include_power":false,"full_check":true}')).toEqual({ name: 'read_adapter_info', includePower: false, fullCheck: true });
    expect(ok('calculate', '{"expression":"2204*0.621371"}')).toEqual({ name: 'calculate', expression: '2204*0.621371' });
    expect(ok('read_fault_history', '{}')).toEqual({ name: 'read_fault_history' });
    expect(ok('clear_dtcs', '')).toEqual({ name: 'clear_dtcs' });
    expect(ok('read_readiness', '{}')).toEqual({ name: 'read_readiness' });
  });

  it('every tool without arguments parses on its own (no fall-through into another tool)', () => {
    for (const name of ['read_freeze_frame', 'read_readiness', 'read_vehicle_info', 'run_adapter_bench', 'clear_dtcs', 'read_fault_history', 'start_navigation', 'route_status', 'stop_navigation']) {
      expect(ok(name, '{}')).toEqual({ name });
    }
  });

  it('rejects instead of repairing', () => {
    expect(err('read_engine', '{}').error).toBe('unknown_tool');
    expect(err('read_pids', '{"pids":["OIL_PRESSURE"]}').message).toMatch(/OIL_PRESSURE/);
    expect(err('read_pids', '{"pids":["FUEL_LEVEL"]}').error).toBe('invalid_arguments'); // not supported by this car
    expect(err('read_pids', '{"pids":["RPM","RPM"]}').message).toMatch(/repetidos/);
    expect(err('read_pids', '{"pids":[]}').error).toBe('invalid_arguments');
    expect(err('read_pids', '{"pids":["RPM","SPEED","COOLANT_TEMP","ENGINE_LOAD","VOLTAGE","RPM2"]}').error).toBe(
      'invalid_arguments',
    );
    expect(err('read_pids', '{"pids":["RPM"],"fast":true}').message).toMatch(/fast/);
    expect(err('sample_pids', '{"pids":["RPM"],"seconds":60}').error).toBe('invalid_arguments');
    expect(err('read_dtcs', '{"kind":"all"}').error).toBe('invalid_arguments');
    expect(err('read_dtcs', '{kind:stored}').message).toMatch(/JSON/);
    expect(err('clear_dtcs', '{"force":true}').error).toBe('invalid_arguments');
  });
});

describe('tool policy', () => {
  const stopped = { moving: false, navigating: false, labMode: false, clearsThisConversation: 0 };
  const moving = { ...stopped, moving: true };
  const decide = (call: ToolCall, ctx = stopped) => evaluatePolicy(call, ctx).kind;

  it('allows reads anytime', () => {
    expect(decide({ name: 'read_pids', pids: ['RPM'] }, moving)).toBe('allow');
    expect(decide({ name: 'read_dtcs', kind: 'stored' }, moving)).toBe('allow');
  });

  it('limits samples while moving', () => {
    expect(decide({ name: 'sample_pids', pids: ['RPM'], seconds: SAMPLE_SECONDS_WHILE_MOVING }, moving)).toBe('allow');
    expect(decide({ name: 'sample_pids', pids: ['RPM'], seconds: 10 }, moving)).toBe('deny');
    expect(decide({ name: 'sample_pids', pids: ['RPM'], seconds: 10 })).toBe('allow');
  });

  it('keeps the bench away from driving and navigation', () => {
    expect(decide({ name: 'run_adapter_bench' })).toBe('allow');
    expect(decide({ name: 'run_adapter_bench' }, moving)).toBe('deny');
    expect(decide({ name: 'run_adapter_bench' }, { ...stopped, navigating: true, labMode: false })).toBe('deny');
  });

  it('asks before clearing codes, once per conversation, never while moving', () => {
    expect(decide({ name: 'clear_dtcs' })).toBe('confirm');
    expect(decide({ name: 'clear_dtcs' }, moving)).toBe('deny');
    const again = evaluatePolicy({ name: 'clear_dtcs' }, { ...stopped, clearsThisConversation: 1 });
    expect(again).toMatchObject({ kind: 'deny', error: 'already_done' });
  });
});
