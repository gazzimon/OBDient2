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
  'research',
  'web_search',
  'web_fetch',
  'scan_modules',
  'obd_command',
  'did_probe',
  'knowledge_lookup',
  'docs_search',
  'chat_search',
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
  // The web, through obdient-tools (SearXNG): short results (places, prices), never whole pages.
  | { readonly name: 'web_search'; readonly query: string }
  // Search + read + rank in one call: the fragments that answer, with their source and a grade.
  | { readonly name: 'research'; readonly query: string; readonly queryEn: string | null }
  // Reads a public page: its start, or with `focus` the fragments of it about that.
  | { readonly name: 'web_fetch'; readonly url: string; readonly focus: string | null }
  // Lab: which modules of this car answer (read-only probes 3E, 22 F187/F190). The
  // make (from the VIN, or given) adds that make's known addresses.
  | { readonly name: 'scan_modules'; readonly make: string | null; readonly model: string | null }
  // Lab (Modo laboratorio): a free READ command/frame; writes are blocked.
  | { readonly name: 'obd_command'; readonly command: string; readonly header: string | null }
  // Lab: does a module's link work, and which DIDs does it answer? One DID per request, 22 only.
  | { readonly name: 'did_probe'; readonly header: string; readonly mode: 'control' | 'list'; readonly dids: readonly string[] }
  // The lab's shared facts about what a car supports.
  | { readonly name: 'knowledge_lookup'; readonly make: string | null; readonly model: string | null; readonly year: number | null }
  // The lab's text base: pages already read and manuals, by words and by meaning.
  | { readonly name: 'docs_search'; readonly query: string }
  // What was said in earlier conversations (saved on the phone).
  | { readonly name: 'chat_search'; readonly query: string }
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

// A page the assistant read, as a button under its tool row. For the screen
// only, like MapPin: the model gets `data`, never this.
export interface SourceLink {
  readonly site: string;
  readonly title: string | null;
  readonly url: string;
}

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
  | { readonly ok: true; readonly data: unknown; readonly summary: string; readonly places?: readonly MapPin[]; readonly sources?: readonly SourceLink[]; readonly knowledge?: Record<string, unknown> }
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
      'research',
      'Investiga una pregunta en internet en un solo paso: busca, lee las mejores páginas y devuelve los fragmentos que la ' +
        'responden, cada uno con su sitio, título y sección, y una nota "grade": good (hay evidencia), weak (parcial) o ' +
        'none (no apareció). Para datos técnicos y de conocimiento: DIDs, PIDs, procedimientos, recalls, fallas conocidas ' +
        'de un modelo, especificaciones. "query": la pregunta en pocas palabras clave, sin direcciones de módulo ni VIN ' +
        '("odómetro Chevrolet Tracker 2023 UDS"). "query_en": la misma en inglés, para temas técnicos (foros, GitHub y ' +
        'manuales suelen estar en inglés). No la uses para comercios, direcciones ni precios: para eso es web_search.',
      {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 2, maxLength: 200 },
          query_en: { type: 'string', minLength: 2, maxLength: 200 },
        },
        required: ['query'],
        additionalProperties: false,
      },
    ),
    fn(
      'web_search',
      'Busca en internet y devuelve hasta 5 resultados con título, sitio, un fragmento corto, y las direcciones y precios ' +
        'que aparezcan. Para comercios y talleres, horarios, direcciones y precios. Incluí la ciudad si importa. Para ' +
        'preguntas técnicas o de conocimiento usá research, que lee las páginas.',
      {
        type: 'object',
        properties: { query: { type: 'string', minLength: 2, maxLength: 200 } },
        required: ['query'],
        additionalProperties: false,
      },
    ),
    fn(
      'web_fetch',
      'Lee una página pública cuya URL ya tenés (de research, de web_search o del usuario). Con "focus" (qué buscar en ' +
        'ella: "DID del odómetro") devuelve solo los fragmentos de esa página que hablan de eso; sin "focus", el comienzo ' +
        'de la página. No inventes direcciones de módulos: leé la fuente o medí en el auto.',
      {
        type: 'object',
        properties: { url: { type: 'string', minLength: 8, maxLength: 400 }, focus: { type: 'string', minLength: 2, maxLength: 200 } },
        required: ['url'],
        additionalProperties: false,
      },
    ),
    fn(
      'scan_modules',
      'Barrido de módulos del auto (como el árbol de FORScan): recorre las direcciones y dice cuáles responden (ABS, airbag, ' +
        'caja, tablero, carrocería…), con solo lecturas (3E y el número de pieza, 22 F187). Suma las direcciones conocidas de la marca (la ' +
        'saca del VIN; pasala si el usuario la dijo y el VIN no la da). El auto tiene que estar detenido. Lo que responde ' +
        'queda en la base del laboratorio.',
      {
        type: 'object',
        properties: {
          make: { type: 'string', maxLength: 40, description: 'Marca: "Volkswagen".' },
          model: { type: 'string', maxLength: 40 },
        },
        additionalProperties: false,
      },
    ),
    fn(
      'obd_command',
      'Solo en Modo laboratorio: envía UNA trama o comando de LECTURA al auto y devuelve la respuesta cruda. Libre para leer ' +
        '(19, 22, 23, 24, 3E, 10 01, modos OBD, encabezados ATSH/ATCRA, STPX); bloqueado todo lo que escribe, borra, flashea, ' +
        'reinicia o desbloquea. El auto detenido.',
      {
        type: 'object',
        properties: {
          command: { type: 'string', minLength: 2, maxLength: 60, description: 'La trama o comando: "1902FF", "22 F1 90", "ATI".' },
          header: { type: 'string', maxLength: 8, description: 'Dirección de PEDIDO al módulo (ATSH): 11 bits "7E0"; 29 bits "18DA<módulo>F1", p. ej. "18DA11F1". La de respuesta (7E8, 18DAF1<módulo>) no sirve como pedido.' },
        },
        required: ['command'],
        additionalProperties: false,
      },
    ),
    fn(
      'did_probe',
      'Solo en Modo laboratorio: sondea UN módulo con lecturas 22 de un DID por vez y dice si el enlace funciona o si el DID ' +
        'no existe. Úsala cuando un 22 no devuelve datos y no se sabe si falla el adaptador o falta el DID. mode "control" ' +
        '(por defecto): 3E 00 y los DIDs estándar de identificación (F190, F187, F189, F18C, F186), que todo módulo UDS debería ' +
        'contestar. mode "list": los DIDs de "dids" (hasta 32). El veredicto link_ok significa que el adaptador y el software ' +
        'funcionan (cualquier respuesta, incluso un rechazo 7F, lo prueba); link_silent, que nadie contestó (revisar el header, ' +
        'no el DID). Nunca escribe ni desbloquea. El auto detenido.',
      {
        type: 'object',
        properties: {
          header: { type: 'string', minLength: 3, maxLength: 8, description: 'Dirección de PEDIDO al módulo: 11 bits "7E0"; 29 bits "18DA<módulo>F1", p. ej. "18DA28F1". La de respuesta no sirve.' },
          mode: { type: 'string', enum: ['control', 'list'] },
          dids: { type: 'array', maxItems: 32, items: { type: 'string', minLength: 4, maxLength: 6 }, description: 'Solo con mode "list": DIDs de 4 dígitos hexadecimales, p. ej. ["F190", "F187"].' },
        },
        required: ['header'],
        additionalProperties: false,
      },
    ),
    fn(
      'knowledge_lookup',
      'Qué se sabe en el laboratorio sobre un auto: módulos que responden, direcciones y DIDs ya descubiertos, de este modelo ' +
        'y de la misma marca. Consultalo antes de barrer o explorar, para no empezar de cero.',
      {
        type: 'object',
        properties: {
          make: { type: 'string', maxLength: 40, description: 'Marca: "Ford".' },
          model: { type: 'string', maxLength: 40 },
          year: { type: 'integer', minimum: 1990, maximum: 2100 },
        },
        additionalProperties: false,
      },
    ),
    fn(
      'docs_search',
      'Busca en los textos que el laboratorio ya leyó (páginas web y manuales de los adaptadores, datasheets, notas): ' +
        'sintaxis de comandos, identificadores, procedimientos. Devuelve fragmentos con su fuente y la fecha en que se leyó. ' +
        'Usala antes de buscar en la web. No tiene precios ni nada que cambie a diario: para eso están sus herramientas en vivo.',
      {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 2, maxLength: 200, description: 'La pregunta o los términos, con los códigos tal cual ("STCFCPA", "F187", "18DA10F1").' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    ),
    fn(
      'chat_search',
      'Busca en las conversaciones anteriores con el usuario (no en la actual): un lugar que se mostró, algo que se habló, ' +
        '"la cafetería de ayer", "ese lugar que me mostraste". Devuelve unas pocas líneas con la fecha, sin coordenadas; para ir ' +
        'a un lugar que aparece, buscalo con search_place por su nombre y la ciudad. Solo guarda las últimas conversaciones.',
      {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 2, maxLength: 120, description: 'Las palabras clave de lo que se busca, sin "ayer" ni "antes": "cafetería", "taller Gómez".' },
        },
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
    case 'research': {
      const extra = only('query', 'query_en');
      if (extra) return bad(extra);
      const q = a.query;
      if (typeof q !== 'string' || q.trim().length < 2 || q.length > 200) return bad('"query" debe tener entre 2 y 200 caracteres.');
      const en = a.query_en;
      if (en !== undefined && en !== null && (typeof en !== 'string' || en.trim().length < 2 || en.length > 200)) return bad('"query_en" debe tener entre 2 y 200 caracteres.');
      return { ok: true, call: { name, query: q.trim(), queryEn: typeof en === 'string' ? en.trim() : null } };
    }
    case 'web_fetch': {
      const extra = only('url', 'focus');
      if (extra) return bad(extra);
      const u = a.url;
      if (typeof u !== 'string' || !/^https?:\/\//i.test(u.trim()) || u.length > 400) return bad('"url" debe ser una dirección http(s).');
      const f = a.focus;
      if (f !== undefined && f !== null && (typeof f !== 'string' || f.trim().length < 2 || f.length > 200)) return bad('"focus" debe tener entre 2 y 200 caracteres.');
      return { ok: true, call: { name, url: u.trim(), focus: typeof f === 'string' ? f.trim() : null } };
    }
    case 'obd_command': {
      const extra = only('command', 'header');
      if (extra) return bad(extra);
      const cmd = a.command;
      if (typeof cmd !== 'string' || cmd.trim().length < 2 || cmd.length > 60) return bad('"command" debe ser la trama o el comando.');
      const h = a.header;
      if (h !== undefined && (typeof h !== 'string' || !/^[0-9A-Fa-f]{3,8}$/.test(h.trim()))) return bad('"header" es la dirección del módulo en hexadecimal.');
      return { ok: true, call: { name, command: cmd.trim(), header: typeof h === 'string' ? h.trim().toUpperCase() : null } };
    }
    case 'did_probe': {
      const extra = only('header', 'mode', 'dids');
      if (extra) return bad(extra);
      const h = a.header;
      if (typeof h !== 'string' || !/^[0-9A-Fa-f]{3,8}$/.test(h.trim())) return bad('"header" es la dirección de pedido del módulo, en hexadecimal.');
      const mode = a.mode ?? 'control';
      if (mode !== 'control' && mode !== 'list') return bad('"mode" es "control" o "list".');
      const d = a.dids ?? [];
      if (!Array.isArray(d) || d.length > 32 || d.some((x) => typeof x !== 'string' || x.length > 6)) return bad('"dids" es una lista de hasta 32 DIDs de 4 dígitos hexadecimales.');
      if (mode === 'list' && d.length === 0) return bad('Con mode "list" hacen falta los "dids".');
      return { ok: true, call: { name, header: h.trim().toUpperCase(), mode, dids: d as string[] } };
    }
    case 'knowledge_lookup': {
      const extra = only('make', 'model', 'year');
      if (extra) return bad(extra);
      const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
      const y = a.year;
      if (y !== undefined && (typeof y !== 'number' || !Number.isInteger(y) || y < 1990 || y > 2100)) return bad('"year" debe ser un año.');
      return { ok: true, call: { name, make: str(a.make, 40), model: str(a.model, 40), year: (y as number | undefined) ?? null } };
    }
    case 'docs_search': {
      const extra = only('query');
      if (extra) return bad(extra);
      const q = a.query;
      if (typeof q !== 'string' || q.trim().length < 2 || q.length > 200) return bad('"query" debe tener entre 2 y 200 caracteres.');
      return { ok: true, call: { name, query: q.trim() } };
    }
    case 'chat_search': {
      const extra = only('query');
      if (extra) return bad(extra);
      const q = a.query;
      if (typeof q !== 'string' || q.trim().length < 2 || q.length > 120) return bad('"query" debe tener entre 2 y 120 caracteres.');
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
    case 'scan_modules': {
      const extra = only('make', 'model');
      if (extra) return bad(extra);
      const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 40) : null);
      return { ok: true, call: { name, make: str(a.make), model: str(a.model) } };
    }
  }
}

function bad(message: string): ParsedToolCall {
  return { ok: false, error: 'invalid_arguments', message };
}
