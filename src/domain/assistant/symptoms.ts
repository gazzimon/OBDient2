// Symptoms in what the driver writes (M4), for the offline notes: a fixed
// keyword table, deterministic, ported from OBDient's symptom-matcher.ts.
// Misses are fine: the note keeps the driver's own words for the assistant;
// this only tags it ("tironea al acelerar") and tells denials apart ("no tira
// humo blanco").

import { normalise } from './phrase-router';

export interface Symptom {
  readonly label: string;
  // Lowercase, without accents.
  readonly keywords: readonly string[];
}

export const SYMPTOMS: Readonly<Record<string, Symptom>> = {
  hesitation: { label: 'tironea al acelerar', keywords: ['tironea', 'tirones', 'da tirones', 'duda al acelerar'] },
  power_loss: { label: 'falta de potencia', keywords: ['falta de potencia', 'perdida de potencia', 'no tiene fuerza', 'sin fuerza', 'no levanta velocidad'] },
  surging: { label: 'cabecea (rpm suben y bajan)', keywords: ['cabecea', 'cabeceo', 'rpm sube y baja', 'rpm oscila', 'se acelera solo'] },
  knock_ping: { label: 'pistonea', keywords: ['cascabelea', 'cascabeleo del motor', 'pistonea', 'pistoneo'] },
  stall: { label: 'se apaga andando', keywords: ['se apaga', 'se para en marcha', 'se me apaga', 'se planta'] },
  harsh_shift: { label: 'cambios bruscos', keywords: ['cambios bruscos', 'golpea al cambiar', 'patea la caja', 'pega tirones la caja'] },
  high_consumption: { label: 'consume mucho', keywords: ['consume mucho', 'consumo alto', 'gasta mucha nafta', 'gasta mucho combustible', 'gasta mucho'] },
  no_start: { label: 'no arranca', keywords: ['no arranca', 'no enciende', 'no da arranque'] },
  hard_start_cold: { label: 'arranca mal en frío', keywords: ['arranca mal en frio', 'cuesta arrancar en frio', 'en frio cuesta arrancar'] },
  hard_start_hot: { label: 'arranca mal en caliente', keywords: ['arranca mal en caliente', 'cuesta arrancar en caliente'] },
  long_crank: { label: 'tarda en arrancar', keywords: ['gira mucho antes de arrancar', 'tarda en arrancar', 'da vueltas antes de arrancar'] },
  rough_idle: { label: 'ralentí inestable', keywords: ['ralenti inestable', 'tiembla en ralenti', 'vibra en ralenti', 'tiembla', 'vibra parado'] },
  high_idle: { label: 'ralentí alto', keywords: ['ralenti alto', 'queda acelerado', 'acelerado en ralenti'] },
  low_idle: { label: 'ralentí bajo', keywords: ['ralenti bajo', 'se ahoga'] },
  engine_noise: { label: 'golpeteo en el motor', keywords: ['golpeteo', 'golpea el motor', 'ruido metalico'] },
  hiss: { label: 'silbido (posible pérdida de vacío)', keywords: ['silbido', 'soplido', 'chistido'] },
  exhaust_rattle: { label: 'ruido en el escape', keywords: ['ruido en el escape', 'cascabeleo en el escape', 'matraquea'] },
  smell_fuel: { label: 'olor a nafta', keywords: ['olor a nafta', 'olor a combustible', 'olor a gasolina', 'huele a nafta', 'huele a combustible'] },
  smell_burning: { label: 'olor a quemado', keywords: ['olor a quemado', 'huele a quemado'] },
  smell_sulfur: { label: 'olor a huevo podrido', keywords: ['olor a azufre', 'huele a azufre', 'huevo podrido'] },
  smell_coolant: { label: 'olor dulce (refrigerante)', keywords: ['olor dulce', 'huele dulce', 'olor a refrigerante', 'huele a refrigerante'] },
  smoke_white: { label: 'humo blanco', keywords: ['humo blanco'] },
  smoke_blue: { label: 'humo azul (quema aceite)', keywords: ['humo azul', 'quema aceite'] },
  smoke_black: { label: 'humo negro', keywords: ['humo negro'] },
  coolant_leak: { label: 'pierde refrigerante', keywords: ['pierde refrigerante', 'perdida de refrigerante', 'pierde agua'] },
  oil_leak: { label: 'pierde aceite', keywords: ['pierde aceite', 'perdida de aceite', 'mancha de aceite'] },
  fuel_leak: { label: 'pierde nafta', keywords: ['pierde nafta', 'pierde combustible'] },
  overheating: { label: 'levanta temperatura', keywords: ['recalienta', 'sobrecalienta', 'levanta temperatura', 'se calienta mucho', 'aguja alta'] },
  no_warmup: { label: 'no levanta temperatura', keywords: ['no calienta', 'tarda en calentar', 'no levanta temperatura'] },
  lights_flicker: { label: 'luces tenues o que parpadean', keywords: ['luces tenues', 'parpadean las luces', 'luces parpadean'] },
  battery_drain: { label: 'se descarga la batería', keywords: ['se descarga la bateria', 'bateria se descarga', 'me deja sin bateria'] },
  check_flashing: { label: 'testigo de motor titilando', keywords: ['check engine titila', 'titila el check', 'parpadea el check', 'check parpadea', 'titila el testigo'] },
  check_on: { label: 'testigo de motor encendido', keywords: ['se prendio el check', 'check encendido', 'luz del motor', 'testigo del motor', 'check engine'] },
  temp_light: { label: 'testigo de temperatura', keywords: ['luz de temperatura', 'testigo de temperatura'] },
  oil_light: { label: 'testigo de aceite', keywords: ['luz de aceite', 'testigo de aceite'] },
  battery_light: { label: 'testigo de batería', keywords: ['luz de bateria', 'testigo de bateria'] },
  // Beyond the engine (2026-10-28): what the OBD cannot measure, so the root
  // causes of those systems rest on these and on the chassis/body codes.
  brake_pedal_soft: { label: 'pedal de freno largo o que se hunde', keywords: ['pedal largo', 'pedal esponjoso', 'se hunde el pedal', 'pedal se va al fondo', 'frena poco', 'no frena'] },
  brake_noise: { label: 'ruido o vibración al frenar', keywords: ['ruido al frenar', 'chilla al frenar', 'chillan los frenos', 'rechina al frenar', 'vibra al frenar'] },
  wheel_hum: { label: 'zumbido que sube con la velocidad', keywords: ['zumbido', 'ronroneo', 'ruido de ruleman', 'ruido de rodamiento'] },
  cv_click: { label: 'clic al doblar', keywords: ['clic al doblar', 'hace clic al doblar', 'tac tac al doblar', 'ruido al doblar', 'ruido al girar'] },
  suspension_noise: { label: 'ruido en la suspensión', keywords: ['ruido en la suspension', 'golpe en los pozos', 'golpea en los pozos', 'ruido en el tren delantero', 'rebota mucho'] },
  steering_vibration: { label: 'vibra el volante', keywords: ['vibra el volante', 'tiembla el volante', 'vibra la direccion'] },
  pulls_side: { label: 'tira hacia un lado', keywords: ['tira para un lado', 'tira hacia un lado', 'se va para un lado', 'tira a la derecha', 'tira a la izquierda'] },
  steering_heavy: { label: 'dirección dura', keywords: ['direccion dura', 'volante duro', 'se endurecio la direccion', 'testigo de direccion'] },
  clutch_slip: { label: 'patina el embrague', keywords: ['patina el embrague', 'embrague patina', 'patina la placa', 'acelera y no avanza'] },
  ac_not_cold: { label: 'el aire acondicionado no enfría', keywords: ['aire no enfria', 'aire acondicionado no enfria', 'no enfria el aire', 'el aire tira caliente'] },
  blower_fault: { label: 'el ventilador del habitáculo no sopla bien', keywords: ['no anda el ventilador', 'ventilador solo en el maximo', 'forzador no anda', 'solo anda en la cuatro', 'calefaccion no sopla'] },
  abs_light: { label: 'testigo de ABS', keywords: ['luz de abs', 'luz del abs', 'testigo de abs', 'testigo del abs'] },
  airbag_light: { label: 'testigo de airbag', keywords: ['luz de airbag', 'luz del airbag', 'testigo de airbag', 'testigo del airbag'] },
  tpms_light: { label: 'testigo de presión de neumáticos', keywords: ['testigo de presion', 'luz de presion de neumaticos', 'testigo de neumaticos', 'luz de las cubiertas', 'tpms'] },
  dpf_light: { label: 'testigo del filtro de partículas', keywords: ['testigo del filtro de particulas', 'luz del dpf', 'testigo dpf', 'filtro de particulas'] },
};

// A negator right before the keyword flips it to denied.
const NEGATORS = new Set(['no', 'ni', 'nunca', 'sin', 'tampoco']);
const NEGATION_WINDOW = 16;

export interface SymptomMatch {
  readonly confirmed: readonly string[];
  readonly denied: readonly string[];
}

export function matchSymptoms(text: string): SymptomMatch {
  const haystack = normalise(text);
  const confirmed: string[] = [];
  const denied: string[] = [];
  if (!haystack) return { confirmed, denied };
  for (const [id, { keywords }] of Object.entries(SYMPTOMS)) {
    let yes = false;
    let no = false;
    for (const k of keywords) {
      // Only whole words: "tiembla" is not inside "estiembla".
      const re = new RegExp(`(?:^|[^a-zñ])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-zñ])`, 'g');
      for (const m of haystack.matchAll(re)) {
        const at = m.index + (m[0].length - k.length);
        if (negated(haystack, at)) no = true;
        else yes = true;
      }
    }
    // A keyword that itself starts with "no" ("no arranca") is never negated by
    // that same "no": negated() only looks before it.
    if (yes) confirmed.push(id);
    else if (no) denied.push(id);
  }
  // "check engine titila" also says the light is on: keep the more specific one.
  if (confirmed.includes('check_flashing')) return { confirmed: confirmed.filter((s) => s !== 'check_on'), denied };
  return { confirmed, denied };
}

function negated(haystack: string, at: number): boolean {
  const window = haystack.slice(Math.max(0, at - NEGATION_WINDOW), at);
  // A sentence break between the negator and the keyword cancels it.
  if (/[.;!?]/.test(window)) return false;
  return window.split(' ').some((w) => NEGATORS.has(w));
}

export const symptomLabel = (id: string): string => SYMPTOMS[id]?.label ?? id;
