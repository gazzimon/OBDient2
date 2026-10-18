// The assistant's tool catalogue (ADR-0007): a closed set of calls the model
// can ask for, their JSON schemas, and strict parsing of what it sends back.
//
// Rules:
// - Fixed order and fixed schemas, so the prompt prefix (system + tools) stays
//   cacheable on the server.
// - The PID enum is what this car answers (plus battery voltage, read from the
//   adapter): the model cannot ask for something the session cannot read.
// - Arguments are never repaired. Anything outside the schema is rejected with
//   an error the model can read, and counted.

import { PID_DEFINITIONS, type PidId } from '@/core/constants/pids';

export const TOOL_NAMES = [
  'read_pids',
  'sample_pids',
  'read_dtcs',
  'read_freeze_frame',
  'read_readiness',
  'read_vehicle_info',
  'read_adapter_info',
  'run_adapter_bench',
  'clear_dtcs',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export type DtcKind = 'stored' | 'pending' | 'permanent';
const DTC_KINDS: readonly DtcKind[] = ['stored', 'pending', 'permanent'];

export type ToolCall =
  | { readonly name: 'read_pids'; readonly pids: readonly PidId[] }
  | { readonly name: 'sample_pids'; readonly pids: readonly PidId[]; readonly seconds: number }
  | { readonly name: 'read_dtcs'; readonly kind: DtcKind }
  | { readonly name: 'read_freeze_frame' }
  | { readonly name: 'read_readiness' }
  | { readonly name: 'read_vehicle_info' }
  | { readonly name: 'read_adapter_info'; readonly includePower: boolean }
  | { readonly name: 'run_adapter_bench' }
  | { readonly name: 'clear_dtcs' };

export const TOOL_LIMITS = {
  readPidsMax: 6,
  samplePidsMax: 4,
  sampleSecondsMin: 2,
  sampleSecondsMax: 20,
} as const;

// Errors a tool call can end in. The model gets the code and a short message.
export type ToolErrorCode =
  | 'not_connected'
  | 'not_supported'
  | 'not_allowed_while_moving'
  | 'declined_by_user'
  | 'already_done'
  | 'adapter_reset'
  | 'timeout'
  | 'cancelled'
  | 'invalid_arguments'
  | 'unknown_tool'
  | 'too_many_calls';

export type ToolOutcome =
  | { readonly ok: true; readonly data: unknown; readonly summary: string }
  | { readonly ok: false; readonly error: ToolErrorCode; readonly message: string };

// PIDs the model may ask for: what the car supports, in catalogue order. Battery
// voltage comes from the adapter (ATRV/STVR), so it is always readable.
export function toolPids(supported: readonly PidId[]): PidId[] {
  const set = new Set<PidId>([...supported, 'VOLTAGE']);
  return (Object.keys(PID_DEFINITIONS) as PidId[]).filter((p) => set.has(p));
}

export interface ToolSchema {
  readonly type: 'function';
  readonly function: {
    readonly name: ToolName;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  };
}

const NO_ARGS = { type: 'object', properties: {}, additionalProperties: false } as const;

export function toolSchemas(supported: readonly PidId[]): ToolSchema[] {
  const pids = toolPids(supported);
  const pidList = pids.map((p) => `${p} (${PID_DEFINITIONS[p].name}, ${PID_DEFINITIONS[p].unit})`).join('; ');
  const pidArray = (max: number) => ({
    type: 'array',
    items: { type: 'string', enum: pids },
    minItems: 1,
    maxItems: max,
    uniqueItems: true,
  });
  const fn = (name: ToolName, description: string, parameters: Record<string, unknown>): ToolSchema => ({
    type: 'function',
    function: { name, description, parameters },
  });
  return [
    fn('read_pids', `Lee valores en vivo del auto, una vez. Disponibles: ${pidList}.`, {
      type: 'object',
      properties: { pids: pidArray(TOOL_LIMITS.readPidsMax) },
      required: ['pids'],
      additionalProperties: false,
    }),
    fn(
      'sample_pids',
      'Mide valores durante unos segundos y devuelve mínimo, máximo, promedio y último. Útil para ver ' +
        'cómo varía algo (ralentí, temperatura subiendo, tensión con el motor en marcha).',
      {
        type: 'object',
        properties: {
          pids: pidArray(TOOL_LIMITS.samplePidsMax),
          seconds: { type: 'number', minimum: TOOL_LIMITS.sampleSecondsMin, maximum: TOOL_LIMITS.sampleSecondsMax },
        },
        required: ['pids', 'seconds'],
        additionalProperties: false,
      },
    ),
    fn('read_dtcs', 'Lee códigos de falla: guardados (stored), pendientes (pending) o permanentes (permanent).', {
      type: 'object',
      properties: { kind: { type: 'string', enum: DTC_KINDS } },
      required: ['kind'],
      additionalProperties: false,
    }),
    fn('read_freeze_frame', 'Lee la foto que guardó la ECU cuando se registró el código: valores en ese momento.', NO_ARGS),
    fn('read_readiness', 'Lee el estado de los monitores de emisiones y el tiempo y la distancia desde el último borrado.', NO_ARGS),
    fn('read_vehicle_info', 'Lee el VIN y qué PIDs soporta el auto.', NO_ARGS),
    fn('read_adapter_info', 'Datos del adaptador OBD: chip, firmware, protocolo y calidad de la conexión.', {
      type: 'object',
      properties: { include_power: { type: 'boolean', description: 'Incluir la tensión que mide el adaptador.' } },
      required: ['include_power'],
      additionalProperties: false,
    }),
    fn(
      'run_adapter_bench',
      'Prueba la velocidad del adaptador durante unos segundos. Pausa la telemetría mientras corre.',
      NO_ARGS,
    ),
    fn(
      'clear_dtcs',
      'Borra los códigos de falla y apaga el testigo. Es destructivo: la app le pide confirmación al usuario ' +
        'antes de ejecutarlo. Llamalo solo si el usuario pidió borrar.',
      NO_ARGS,
    ),
  ];
}

export type ParsedToolCall =
  | { readonly ok: true; readonly call: ToolCall }
  | { readonly ok: false; readonly error: 'unknown_tool' | 'invalid_arguments'; readonly message: string };

const isName = (n: string): n is ToolName => (TOOL_NAMES as readonly string[]).includes(n);

// Model output (name + JSON string) → a valid call, or a reason it is not one.
export function parseToolCall(name: string, rawArgs: string, supported: readonly PidId[]): ParsedToolCall {
  if (!isName(name)) return { ok: false, error: 'unknown_tool', message: `No existe la herramienta "${name}".` };
  let args: unknown;
  try {
    args = rawArgs.trim() === '' ? {} : JSON.parse(rawArgs);
  } catch {
    return bad('Los argumentos no son JSON válido.');
  }
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return bad('Los argumentos deben ser un objeto.');
  const a = args as Record<string, unknown>;
  const allowed = toolPids(supported);

  const only = (...keys: string[]): string | null => {
    const extra = Object.keys(a).filter((k) => !keys.includes(k));
    return extra.length ? `Argumentos no admitidos: ${extra.join(', ')}.` : null;
  };
  const pidsArg = (max: number): PidId[] | string => {
    const v = a.pids;
    if (!Array.isArray(v) || v.length === 0) return '"pids" debe ser una lista no vacía.';
    if (v.length > max) return `Como máximo ${max} PIDs por llamada.`;
    if (new Set(v).size !== v.length) return '"pids" tiene repetidos.';
    const unknown = v.filter((p) => typeof p !== 'string' || !(allowed as string[]).includes(p));
    if (unknown.length) return `PIDs no disponibles en este auto: ${unknown.join(', ')}.`;
    return v as PidId[];
  };

  switch (name) {
    case 'read_pids': {
      const extra = only('pids');
      if (extra) return bad(extra);
      const pids = pidsArg(TOOL_LIMITS.readPidsMax);
      return typeof pids === 'string' ? bad(pids) : { ok: true, call: { name, pids } };
    }
    case 'sample_pids': {
      const extra = only('pids', 'seconds');
      if (extra) return bad(extra);
      const pids = pidsArg(TOOL_LIMITS.samplePidsMax);
      if (typeof pids === 'string') return bad(pids);
      const s = a.seconds;
      if (typeof s !== 'number' || !Number.isFinite(s) || s < TOOL_LIMITS.sampleSecondsMin || s > TOOL_LIMITS.sampleSecondsMax) {
        return bad(`"seconds" debe estar entre ${TOOL_LIMITS.sampleSecondsMin} y ${TOOL_LIMITS.sampleSecondsMax}.`);
      }
      return { ok: true, call: { name, pids, seconds: s } };
    }
    case 'read_dtcs': {
      const extra = only('kind');
      if (extra) return bad(extra);
      const k = a.kind;
      if (typeof k !== 'string' || !(DTC_KINDS as readonly string[]).includes(k)) {
        return bad('"kind" debe ser stored, pending o permanent.');
      }
      return { ok: true, call: { name, kind: k as DtcKind } };
    }
    case 'read_adapter_info': {
      const extra = only('include_power');
      if (extra) return bad(extra);
      if (typeof a.include_power !== 'boolean') return bad('"include_power" debe ser true o false.');
      return { ok: true, call: { name, includePower: a.include_power } };
    }
    case 'read_freeze_frame':
    case 'read_readiness':
    case 'read_vehicle_info':
    case 'run_adapter_bench':
    case 'clear_dtcs': {
      const extra = only();
      return extra ? bad(extra) : { ok: true, call: { name } };
    }
  }
}

function bad(message: string): ParsedToolCall {
  return { ok: false, error: 'invalid_arguments', message };
}
