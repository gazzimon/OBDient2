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
  'read_fault_history',
  'calculate',
  'search_place',
  'set_destination',
  'start_navigation',
  'route_status',
  'stop_navigation',
  'where_am_i',
  'web_search',
  'fuel_prices',
  'dollar_rate',
  'weather',
  'car_price',
  'log_service',
  'read_service_log',
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
  | { readonly name: 'read_adapter_info'; readonly includePower: boolean; readonly fullCheck: boolean }
  | { readonly name: 'run_adapter_bench' }
  | { readonly name: 'clear_dtcs' }
  | { readonly name: 'read_fault_history' }
  | { readonly name: 'calculate'; readonly expression: string }
  // An address ("Uruguay 1223") or a well-known place by name (MVP: no shops).
  | { readonly name: 'search_place'; readonly query: string }
  // One of the results of the last search_place, numbered from 1: shown on the
  // map with its route, not started until the user confirms.
  | { readonly name: 'set_destination'; readonly result: number }
  | { readonly name: 'start_navigation' }
  | { readonly name: 'route_status' }
  | { readonly name: 'stop_navigation' }
  // Street and town where the car is (GPS), for "¿dónde estoy?".
  | { readonly name: 'where_am_i' }
  // The web, through obdient-tools (SearXNG): short results, never whole pages.
  | { readonly name: 'web_search'; readonly query: string }
  // Nearest stations and prices (Secretaría de Energía data, daily).
  | { readonly name: 'fuel_prices'; readonly product: FuelProduct | null }
  | { readonly name: 'dollar_rate' }
  // Here (GPS) or a named town.
  | { readonly name: 'weather'; readonly place: string | null }
  // CCA monthly list, thousands of pesos.
  | { readonly name: 'car_price'; readonly query: string; readonly year: number | null }
  // The service log on the phone; the car is always confirmed with the user first.
  | { readonly name: 'log_service'; readonly car: string; readonly item: string; readonly km: number | null; readonly note: string | null }
  | { readonly name: 'read_service_log'; readonly car: string | null };

export const FUEL_PRODUCTS = ['nafta', 'nafta_premium', 'gasoil', 'gasoil_premium', 'gnc'] as const;
export type FuelProduct = (typeof FUEL_PRODUCTS)[number];

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
  | 'too_many_calls'
  // The car answered with a refusal (7F); the message carries the reason.
  | 'rejected_by_car';

// A numbered point the chat can show on a map (search and fuel results).
// For the screen only: the model gets `data`, never this.
export interface MapPin {
  readonly n: number;
  readonly name: string;
  readonly detail: string;
  readonly lat: number;
  readonly lng: number;
  readonly distanceKm: number | null;
}

export type ToolOutcome =
  | { readonly ok: true; readonly data: unknown; readonly summary: string; readonly places?: readonly MapPin[] }
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
    fn(
      'read_adapter_info',
      'Datos del adaptador OBD: chip, firmware, protocolo y calidad de la conexión. Con full_check, además: qué ' +
        'módulos del auto responden, si el adaptador es genuino o una copia y si se apaga solo (pausa la ' +
        'telemetría un momento; solo con el auto detenido). Usalo para "¿anda bien mi adaptador?".',
      {
        type: 'object',
        properties: {
          include_power: { type: 'boolean', description: 'Incluir la tensión que mide el adaptador.' },
          full_check: { type: 'boolean', description: 'Prueba completa de la conexión.' },
        },
        required: ['include_power'],
        additionalProperties: false,
      },
    ),
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
    fn(
      'read_fault_history',
      'Historial de fallas de este auto guardado en el teléfono: cuándo apareció o desapareció cada código, ' +
        'freeze frames y borrados, con los km desde el borrado. No necesita el adaptador conectado.',
      NO_ARGS,
    ),
    fn(
      'calculate',
      'Calcula una expresión aritmética exacta: + - * / % ^, paréntesis, sqrt, abs, round(x, decimales), min, ' +
        'max, pow, log10, ln, pi. Decimales con punto. Usalo para toda cuenta en vez de calcular de cabeza.',
      {
        type: 'object',
        properties: { expression: { type: 'string', maxLength: 200 } },
        required: ['expression'],
        additionalProperties: false,
      },
    ),
    fn(
      'search_place',
      'Busca un destino por dirección (calle y número, por ejemplo "Uruguay 1223") o por el nombre de un lugar ' +
        'conocido. Devuelve hasta 5 resultados numerados, el más cercano primero, con localidad y distancia. Para ' +
        'otra ciudad, incluila en el texto ("Uruguay 1223, Rosario"). No busca comercios.',
      {
        type: 'object',
        properties: { query: { type: 'string', maxLength: 120, description: 'Dirección o lugar.' } },
        required: ['query'],
        additionalProperties: false,
      },
    ),
    fn(
      'set_destination',
      'Muestra en el mapa uno de los resultados de la última search_place (número desde 1) con su ruta, ' +
        'distancia y hora de llegada. No arranca la guía: preguntale al usuario si es ahí.',
      {
        type: 'object',
        properties: { result: { type: 'integer', minimum: 1, maximum: 5 } },
        required: ['result'],
        additionalProperties: false,
      },
    ),
    fn('start_navigation', 'Arranca la guía al destino ya mostrado, cuando el usuario confirmó. Abre la vista de manejo.', NO_ARGS),
    fn('route_status', 'Estado de la navegación: destino, distancia y tiempo que faltan, hora de llegada y próxima maniobra.', NO_ARGS),
    fn('stop_navigation', 'Termina la navegación en curso.', NO_ARGS),
    fn('where_am_i', 'Dónde está ahora el auto según el GPS: calle, altura y ciudad.', NO_ARGS),
    fn(
      'web_search',
      'Busca en internet. Devuelve hasta 5 resultados con título, sitio y un fragmento corto, y las direcciones ' +
        'que aparezcan. Para lo que no sale del auto ni de las otras herramientas: comercios y talleres, ' +
        'horarios, precios, recalls, datos de un modelo de auto. Incluí la ciudad en la búsqueda si importa.',
      {
        type: 'object',
        properties: { query: { type: 'string', minLength: 2, maxLength: 200 } },
        required: ['query'],
        additionalProperties: false,
      },
    ),
    fn(
      'fuel_prices',
      'Estaciones de servicio más cercanas al auto con su marca, dirección, distancia y precio por litro (con cuántos ' +
        'días tiene el dato), y la más barata cerca. Datos oficiales de la Secretaría de Energía. Los resultados quedan ' +
        'numerados para set_destination.',
      {
        type: 'object',
        properties: { product: { type: 'string', enum: FUEL_PRODUCTS, description: 'Si se sabe qué carga.' } },
        additionalProperties: false,
      },
    ),
    fn('dollar_rate', 'Cotización del dólar en Argentina: oficial, blue, MEP, contado con liquidación, tarjeta.', NO_ARGS),
    fn('weather', 'El tiempo ahora y en las próximas 6 horas: cielo, temperatura, lluvia, viento y visibilidad.', {
      type: 'object',
      properties: { place: { type: 'string', maxLength: 80, description: 'Otra ciudad; sin esto, donde está el auto.' } },
      additionalProperties: false,
    }),
    fn(
      'car_price',
      'Precio de un auto nuevo o usado por versión y año, según la lista mensual de la Cámara del Comercio Automotor ' +
        '(en miles de pesos, para autos en muy buen estado).',
      {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 2, maxLength: 100, description: 'Marca, modelo y versión: "Onix 1.4 LTZ".' },
          year: { type: 'integer', minimum: 1990, maximum: 2100 },
        },
        required: ['query'],
        additionalProperties: false,
      },
    ),
    fn(
      'log_service',
      'Anota en el registro de service del teléfono un trabajo hecho (cambio de aceite, filtros, frenos, VTV…). ' +
        'Antes confirmá con el usuario de qué auto se trata.',
      {
        type: 'object',
        properties: {
          car: { type: 'string', minLength: 2, maxLength: 60, description: 'El auto confirmado por el usuario: marca, modelo, año o patente.' },
          item: { type: 'string', minLength: 2, maxLength: 80, description: 'Qué se hizo.' },
          km: { type: 'integer', minimum: 0, maximum: 2000000 },
          note: { type: 'string', maxLength: 200 },
        },
        required: ['car', 'item'],
        additionalProperties: false,
      },
    ),
    fn('read_service_log', 'Lee el registro de service: qué se hizo, cuándo y a cuántos km.', {
      type: 'object',
      properties: { car: { type: 'string', maxLength: 60, description: 'Solo los de este auto.' } },
      additionalProperties: false,
    }),
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
      const extra = only('include_power', 'full_check');
      if (extra) return bad(extra);
      if (typeof a.include_power !== 'boolean') return bad('"include_power" debe ser true o false.');
      if (a.full_check !== undefined && typeof a.full_check !== 'boolean') return bad('"full_check" debe ser true o false.');
      return { ok: true, call: { name, includePower: a.include_power, fullCheck: a.full_check === true } };
    }
    case 'calculate': {
      const extra = only('expression');
      if (extra) return bad(extra);
      const e = a.expression;
      if (typeof e !== 'string' || e.trim() === '' || e.length > 200) return bad('"expression" debe ser texto de hasta 200 caracteres.');
      return { ok: true, call: { name, expression: e } };
    }
    case 'search_place': {
      const extra = only('query');
      if (extra) return bad(extra);
      const q = a.query;
      if (typeof q !== 'string' || q.trim().length < 3 || q.length > 120) return bad('"query" debe tener entre 3 y 120 caracteres.');
      return { ok: true, call: { name, query: q.trim() } };
    }
    case 'set_destination': {
      const extra = only('result');
      if (extra) return bad(extra);
      const r = a.result;
      if (typeof r !== 'number' || !Number.isInteger(r) || r < 1 || r > 5) return bad('"result" debe ser un número de 1 a 5.');
      return { ok: true, call: { name, result: r } };
    }
    case 'web_search': {
      const extra = only('query');
      if (extra) return bad(extra);
      const q = a.query;
      if (typeof q !== 'string' || q.trim().length < 2 || q.length > 200) return bad('"query" debe tener entre 2 y 200 caracteres.');
      return { ok: true, call: { name, query: q.trim() } };
    }
    case 'fuel_prices': {
      const extra = only('product');
      if (extra) return bad(extra);
      const p = a.product;
      if (p !== undefined && !(FUEL_PRODUCTS as readonly unknown[]).includes(p)) return bad(`"product" debe ser ${FUEL_PRODUCTS.join(', ')}.`);
      return { ok: true, call: { name, product: (p as FuelProduct | undefined) ?? null } };
    }
    case 'weather': {
      const extra = only('place');
      if (extra) return bad(extra);
      const p = a.place;
      if (p !== undefined && (typeof p !== 'string' || p.trim().length < 2 || p.length > 80)) return bad('"place" debe ser el nombre de una ciudad.');
      return { ok: true, call: { name, place: typeof p === 'string' ? p.trim() : null } };
    }
    case 'car_price': {
      const extra = only('query', 'year');
      if (extra) return bad(extra);
      const q = a.query;
      if (typeof q !== 'string' || q.trim().length < 2 || q.length > 100) return bad('"query" debe tener entre 2 y 100 caracteres.');
      const y = a.year;
      if (y !== undefined && (typeof y !== 'number' || !Number.isInteger(y) || y < 1990 || y > 2100)) return bad('"year" debe ser un año.');
      return { ok: true, call: { name, query: q.trim(), year: (y as number | undefined) ?? null } };
    }
    case 'log_service': {
      const extra = only('car', 'item', 'km', 'note');
      if (extra) return bad(extra);
      const { car, item, km, note } = a;
      if (typeof car !== 'string' || car.trim().length < 2 || car.length > 60) return bad('"car" debe decir qué auto, confirmado con el usuario.');
      if (typeof item !== 'string' || item.trim().length < 2 || item.length > 80) return bad('"item" debe decir qué se hizo.');
      if (km !== undefined && (typeof km !== 'number' || !Number.isInteger(km) || km < 0 || km > 2_000_000)) return bad('"km" debe ser un número entero.');
      if (note !== undefined && (typeof note !== 'string' || note.length > 200)) return bad('"note" es texto de hasta 200 caracteres.');
      return {
        ok: true,
        call: { name, car: car.trim(), item: item.trim(), km: (km as number | undefined) ?? null, note: typeof note === 'string' && note.trim() ? note.trim() : null },
      };
    }
    case 'read_service_log': {
      const extra = only('car');
      if (extra) return bad(extra);
      const car = a.car;
      if (car !== undefined && (typeof car !== 'string' || car.length > 60)) return bad('"car" es texto.');
      return { ok: true, call: { name, car: typeof car === 'string' && car.trim() ? car.trim() : null } };
    }
    case 'dollar_rate':
    case 'read_freeze_frame':
    case 'read_readiness':
    case 'read_vehicle_info':
    case 'run_adapter_bench':
    case 'clear_dtcs':
    case 'read_fault_history':
    case 'start_navigation':
    case 'route_status':
    case 'stop_navigation':
    case 'where_am_i': {
      const extra = only();
      return extra ? bad(extra) : { ok: true, call: { name } };
    }
  }
}

function bad(message: string): ParsedToolCall {
  return { ok: false, error: 'invalid_arguments', message };
}
