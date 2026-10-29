// The root causes the diagnosis weighs (engine.ts), written for this app
// (2026-10-28) from general workshop practice and the generic codes of SAE
// J2012. Weights are judgement, to be tuned with real cases: a code that
// names the fault weighs most, a measurement next, a symptom least, and a
// symptom shared by many causes (falta de potencia) weighs little.
//
// Codes ending in "*" are prefixes. Only generic codes (P0, P2, B0, C0, U0):
// carmaker codes mean different things on each make.
//
// Systems the OBD cannot see (brakes, suspension, A/C) rest on symptoms and,
// at most, on the chassis or body code family: their confidence is lower by
// design, and the answer says to check them in person.

import type { Condition, RootCause } from './engine';

const WARM: Condition = { pid: 'COOLANT_TEMP', stat: 'mean', op: '>=', value: 80 };
const RUNNING: Condition = { pid: 'RPM', stat: 'mean', op: '>=', value: 400 };
const IDLE: Condition = { pid: 'SPEED', stat: 'max', op: '<=', value: 1 };
const ENGINE_OFF: Condition = { pid: 'RPM', stat: 'max', op: '<', value: 100 };
// Long enough running for an ordinary engine to be warm.
const RUN_15_MIN: Condition = { pid: 'RUN_TIME', stat: 'max', op: '>=', value: 900 };

export const ROOT_CAUSES: readonly RootCause[] = [
  // ── Mixture and air ───────────────────────────────────────────────────────
  {
    id: 'vacuum_leak',
    title: 'Entrada de aire falso (pérdida de vacío)',
    system: 'admisión',
    checks: [
      'Escuchar silbidos con el motor en ralentí y revisar mangueras de vacío, PCV y junta del múltiple',
      'Ver si las correcciones de mezcla bajan al acelerar a 2500 rpm (típico de aire falso)',
      'Prueba de humo en la admisión',
    ],
    indicators: [
      { kind: 'dtc', codes: ['P0171', 'P0174'], weight: 50, text: 'código de mezcla pobre (P0171/P0174)' },
      { kind: 'sensor_sum', pids: ['FUEL_TRIM_SHORT', 'FUEL_TRIM_LONG'], op: '>', value: 15, when: [WARM, RUNNING], weight: 40, text: 'la ECU agrega más de 15 % de combustible (correcciones corta + larga) en caliente' },
      { kind: 'sensor', pid: 'INTAKE_MAP', stat: 'mean', op: '>', value: 45, when: [WARM, RUNNING, IDLE], weight: 25, text: 'presión de admisión alta en ralentí (más de 45 kPa)' },
      { kind: 'baseline', metric: 'ltft_warm', direction: 'high', weight: 25, text: 'corrección larga más alta que lo habitual en este auto' },
      { kind: 'symptom', symptom: 'hiss', weight: 30, text: 'silbido' },
      { kind: 'symptom', symptom: 'rough_idle', weight: 15, text: 'ralentí inestable' },
    ],
  },
  {
    id: 'maf_dirty',
    title: 'Sensor de flujo de aire (MAF) sucio o fallando',
    system: 'admisión',
    checks: ['Limpiar el MAF con limpiador específico y revisar el filtro de aire', 'Comparar el caudal en ralentí con el valor de fábrica para la cilindrada'],
    indicators: [
      { kind: 'dtc', codes: ['P0100', 'P0101', 'P0102', 'P0103', 'P0104'], weight: 60, text: 'código del sensor MAF (P0100–P0104)' },
      { kind: 'dtc', codes: ['P0171', 'P0174'], weight: 15, text: 'código de mezcla pobre' },
      { kind: 'baseline', metric: 'idle_maf', direction: 'low', weight: 35, text: 'caudal de aire en ralentí más bajo que lo habitual' },
      { kind: 'symptom', symptom: 'hesitation', weight: 15, text: 'tironea al acelerar' },
      { kind: 'symptom', symptom: 'power_loss', weight: 10, text: 'falta de potencia' },
    ],
  },
  {
    id: 'rich_mixture',
    title: 'Mezcla rica (inyector que gotea, presión alta o sensor que miente)',
    system: 'combustible',
    checks: ['Revisar inyectores y regulador de presión', 'Verificar el sensor de temperatura del motor (si marca frío, la ECU enriquece)', 'Ver el estado de la sonda lambda'],
    indicators: [
      { kind: 'dtc', codes: ['P0172', 'P0175'], weight: 50, text: 'código de mezcla rica (P0172/P0175)' },
      { kind: 'sensor_sum', pids: ['FUEL_TRIM_SHORT', 'FUEL_TRIM_LONG'], op: '<', value: -15, when: [WARM, RUNNING], weight: 40, text: 'la ECU quita más de 15 % de combustible en caliente' },
      { kind: 'sensor', pid: 'O2_B1S1', stat: 'mean', op: '>', value: 0.7, when: [WARM, RUNNING], weight: 20, text: 'sonda lambda delantera casi siempre en rico (más de 0,7 V)' },
      { kind: 'symptom', symptom: 'smoke_black', weight: 30, text: 'humo negro' },
      { kind: 'symptom', symptom: 'smell_fuel', weight: 20, text: 'olor a nafta' },
      { kind: 'symptom', symptom: 'high_consumption', weight: 20, text: 'consume mucho' },
      { kind: 'baseline', metric: 'l_per_100km', direction: 'high', weight: 15, text: 'consumo más alto que lo habitual' },
    ],
  },
  {
    id: 'fuel_pressure_low',
    title: 'Presión de combustible baja (bomba, filtro o regulador)',
    system: 'combustible',
    checks: ['Medir la presión de combustible con manómetro, en ralentí y con carga', 'Cambiar el filtro de combustible si tiene muchos km', 'Escuchar si la bomba ceba al dar contacto'],
    indicators: [
      { kind: 'dtc', codes: ['P0087', 'P0190', 'P0191', 'P0192', 'P0193', 'P0230'], weight: 55, text: 'código de presión o bomba de combustible (P0087, P0190–P0193, P0230)' },
      { kind: 'dtc', codes: ['P0171', 'P0174'], weight: 15, text: 'código de mezcla pobre' },
      { kind: 'sensor_sum', pids: ['FUEL_TRIM_SHORT', 'FUEL_TRIM_LONG'], op: '>', value: 15, when: [WARM, RUNNING], weight: 15, text: 'correcciones de mezcla altas' },
      { kind: 'symptom', symptom: 'power_loss', weight: 20, text: 'falta de potencia' },
      { kind: 'symptom', symptom: 'long_crank', weight: 25, text: 'tarda en arrancar' },
      { kind: 'symptom', symptom: 'hard_start_hot', weight: 20, text: 'arranca mal en caliente' },
      { kind: 'symptom', symptom: 'stall', weight: 15, text: 'se apaga andando' },
    ],
  },
  {
    id: 'injector',
    title: 'Inyector trabado, sucio o con falla eléctrica',
    system: 'combustible',
    checks: ['Medir la resistencia y el pulso de cada inyector', 'Prueba de balance o limpieza por ultrasonido', 'Ver si la falla de encendido sigue al inyector al rotarlo'],
    indicators: [
      { kind: 'dtc', codes: ['P0200', 'P0201', 'P0202', 'P0203', 'P0204', 'P0205', 'P0206', 'P0207', 'P0208'], weight: 55, text: 'código de circuito de inyector (P0200–P0208)' },
      { kind: 'dtc', codes: ['P030*', 'P0310', 'P0311', 'P0312'], weight: 20, text: 'código de falla de encendido' },
      { kind: 'symptom', symptom: 'rough_idle', weight: 20, text: 'ralentí inestable' },
      { kind: 'symptom', symptom: 'smell_fuel', weight: 15, text: 'olor a nafta' },
      { kind: 'symptom', symptom: 'hard_start_hot', weight: 15, text: 'arranca mal en caliente' },
    ],
  },
  // ── Ignition and engine ───────────────────────────────────────────────────
  {
    id: 'misfire_ignition',
    title: 'Falla de encendido (bujías, bobinas o cables)',
    system: 'encendido',
    checks: ['Revisar bujías (desgaste, luz, carbón) y bobinas', 'Intercambiar la bobina del cilindro que falla y ver si la falla se muda', 'No andar con el testigo titilando: daña el catalizador'],
    safety: 'Con el testigo de motor titilando no conviene seguir andando: la nafta sin quemar recalienta el catalizador.',
    indicators: [
      { kind: 'dtc', codes: ['P030*', 'P0310', 'P0311', 'P0312'], weight: 55, text: 'código de falla de encendido (P0300–P0312)' },
      { kind: 'dtc', codes: ['P035*'], weight: 30, text: 'código de circuito de bobina (P035x)' },
      { kind: 'sensor', pid: 'RPM', stat: 'range', op: '>', value: 150, when: [WARM, IDLE, RUNNING], weight: 20, text: 'las rpm oscilan más de 150 en ralentí' },
      { kind: 'sensor', pid: 'CATALYST_TEMP', stat: 'max', op: '>', value: 900, when: [RUNNING], weight: 15, text: 'catalizador a más de 900 °C' },
      { kind: 'symptom', symptom: 'check_flashing', weight: 40, text: 'testigo de motor titilando' },
      { kind: 'symptom', symptom: 'rough_idle', weight: 20, text: 'ralentí inestable' },
      { kind: 'symptom', symptom: 'hesitation', weight: 15, text: 'tironea al acelerar' },
      { kind: 'symptom', symptom: 'power_loss', weight: 10, text: 'falta de potencia' },
    ],
  },
  {
    id: 'idle_control',
    title: 'Cuerpo de mariposa sucio o control de ralentí',
    system: 'admisión',
    checks: ['Limpiar el cuerpo de mariposa y hacer el reaprendizaje de ralentí', 'Revisar pérdidas de vacío cerca de la mariposa'],
    indicators: [
      { kind: 'dtc', codes: ['P0505', 'P0506', 'P0507', 'P0120', 'P0121', 'P0122', 'P0123', 'P0124', 'P2101', 'P2111', 'P2112', 'P2119'], weight: 50, text: 'código de ralentí o de mariposa (P0505–P0507, P0120–P0124, P21xx)' },
      { kind: 'sensor', pid: 'RPM', stat: 'mean', op: '>', value: 1000, when: [WARM, IDLE, RUNNING], weight: 25, text: 'ralentí por encima de 1000 rpm en caliente' },
      { kind: 'sensor', pid: 'RPM', stat: 'range', op: '>', value: 150, when: [WARM, IDLE, RUNNING], weight: 15, text: 'ralentí que oscila' },
      { kind: 'baseline', metric: 'idle_rpm', direction: 'high', weight: 25, text: 'ralentí más alto que lo habitual en este auto' },
      { kind: 'baseline', metric: 'idle_rpm', direction: 'low', weight: 20, text: 'ralentí más bajo que lo habitual en este auto' },
      { kind: 'symptom', symptom: 'high_idle', weight: 30, text: 'ralentí alto' },
      { kind: 'symptom', symptom: 'low_idle', weight: 25, text: 'ralentí bajo' },
      { kind: 'symptom', symptom: 'surging', weight: 25, text: 'cabecea' },
      { kind: 'symptom', symptom: 'stall', weight: 15, text: 'se apaga' },
    ],
  },
  {
    id: 'crank_cam_sensor',
    title: 'Sensor de cigüeñal o de árbol de levas',
    system: 'encendido',
    checks: ['Revisar el sensor y su ficha (suciedad metálica, cables rozados)', 'Medir la señal con osciloscopio o multímetro mientras se da arranque'],
    indicators: [
      { kind: 'dtc', codes: ['P0335', 'P0336', 'P0337', 'P0338', 'P0339', 'P0340', 'P0341', 'P0342', 'P0343', 'P0344', 'P0345', 'P0346', 'P0347', 'P0348', 'P0349'], weight: 60, text: 'código de sensor de cigüeñal o de levas (P0335–P0349)' },
      { kind: 'symptom', symptom: 'no_start', weight: 30, text: 'no arranca' },
      { kind: 'symptom', symptom: 'stall', weight: 30, text: 'se apaga andando' },
      { kind: 'symptom', symptom: 'hard_start_hot', weight: 20, text: 'arranca mal en caliente' },
      { kind: 'symptom', symptom: 'long_crank', weight: 15, text: 'tarda en arrancar' },
    ],
  },
  {
    id: 'timing_vvt',
    title: 'Distribución estirada o variador de fase (VVT)',
    system: 'motor',
    checks: ['Revisar el nivel y el estado del aceite (el VVT depende de él)', 'Verificar la puesta a punto y el estado de cadena o correa y tensor', 'Revisar el solenoide del variador'],
    indicators: [
      { kind: 'dtc', codes: ['P0010', 'P0011', 'P0012', 'P0013', 'P0014', 'P0015', 'P0016', 'P0017', 'P0018', 'P0019', 'P0020', 'P0021', 'P0022', 'P0023', 'P0024', 'P0025'], weight: 60, text: 'código de variador o de correlación cigüeñal-levas (P0010–P0025)' },
      { kind: 'symptom', symptom: 'engine_noise', weight: 25, text: 'golpeteo o ruido metálico' },
      { kind: 'symptom', symptom: 'oil_light', weight: 20, text: 'testigo de aceite' },
      { kind: 'symptom', symptom: 'power_loss', weight: 10, text: 'falta de potencia' },
      { kind: 'symptom', symptom: 'rough_idle', weight: 10, text: 'ralentí inestable' },
    ],
  },
  {
    id: 'knock',
    title: 'Detonación (pistoneo) o sensor de detonación',
    system: 'motor',
    checks: ['Usar el combustible del octanaje que pide el fabricante', 'Revisar el sensor de detonación y su torque de ajuste', 'Ver si hay sobrecalentamiento o carbón acumulado'],
    indicators: [
      { kind: 'dtc', codes: ['P0325', 'P0326', 'P0327', 'P0328', 'P0329', 'P0330', 'P0331', 'P0332', 'P0333', 'P0334'], weight: 55, text: 'código del sensor de detonación (P0325–P0334)' },
      { kind: 'symptom', symptom: 'knock_ping', weight: 40, text: 'pistonea' },
      { kind: 'symptom', symptom: 'power_loss', weight: 10, text: 'falta de potencia' },
      { kind: 'sensor', pid: 'COOLANT_TEMP', stat: 'max', op: '>', value: 100, weight: 15, text: 'motor por encima de 100 °C' },
    ],
  },
  // ── Cooling ──────────────────────────────────────────────────────────────
  {
    id: 'overheating',
    title: 'Sobrecalentamiento (falta de refrigerante, bomba, electroventilador o junta)',
    system: 'refrigeración',
    checks: ['Con el motor frío: nivel de refrigerante y pérdidas', 'Ver si el electroventilador arranca al llegar a temperatura', 'Revisar bomba de agua, radiador tapado y tapa del depósito', 'Humo blanco y olor dulce: sospechar de la junta de tapa de cilindros'],
    safety: 'Si la temperatura sigue subiendo, pará el motor: andar recalentado puede deformar la tapa de cilindros. No abras el depósito en caliente.',
    indicators: [
      { kind: 'sensor', pid: 'COOLANT_TEMP', stat: 'max', op: '>', value: 105, weight: 60, text: 'temperatura de motor por encima de 105 °C' },
      { kind: 'sensor', pid: 'COOLANT_TEMP', stat: 'max', op: '>', value: 100, weight: 25, text: 'temperatura de motor por encima de 100 °C' },
      { kind: 'baseline', metric: 'cruise_coolant', direction: 'high', weight: 30, text: 'temperatura en ruta más alta que lo habitual en este auto' },
      { kind: 'dtc', codes: ['P0217', 'P0480', 'P0481', 'P0482'], weight: 40, text: 'código de sobretemperatura o de electroventilador (P0217, P0480–P0482)' },
      { kind: 'symptom', symptom: 'overheating', weight: 45, text: 'levanta temperatura' },
      { kind: 'symptom', symptom: 'temp_light', weight: 40, text: 'testigo de temperatura' },
      { kind: 'symptom', symptom: 'coolant_leak', weight: 30, text: 'pierde refrigerante' },
      { kind: 'symptom', symptom: 'smell_coolant', weight: 20, text: 'olor dulce' },
      { kind: 'symptom', symptom: 'smoke_white', weight: 15, text: 'humo blanco' },
    ],
  },
  {
    id: 'thermostat_open',
    title: 'Termostato trabado abierto',
    system: 'refrigeración',
    checks: ['Ver cuánto tarda en llegar a temperatura en ralentí', 'Cambiar el termostato (es barato y es la causa más común)', 'Descartar el sensor de temperatura midiendo con un termómetro'],
    indicators: [
      { kind: 'dtc', codes: ['P0128'], weight: 60, text: 'código de temperatura por debajo de la del termostato (P0128)' },
      { kind: 'sensor', pid: 'COOLANT_TEMP', stat: 'max', op: '<', value: 75, when: [RUN_15_MIN], weight: 40, text: 'después de 15 minutos en marcha el motor no llega a 75 °C' },
      { kind: 'baseline', metric: 'warmup_min', direction: 'high', weight: 35, text: 'tarda más que lo habitual en llegar a temperatura' },
      { kind: 'baseline', metric: 'cruise_coolant', direction: 'low', weight: 30, text: 'temperatura en ruta más baja que lo habitual' },
      { kind: 'symptom', symptom: 'no_warmup', weight: 40, text: 'no levanta temperatura' },
      { kind: 'symptom', symptom: 'high_consumption', weight: 10, text: 'consume mucho' },
    ],
  },
  // ── Electrical ────────────────────────────────────────────────────────────
  {
    id: 'battery_weak',
    title: 'Batería débil o descargada',
    system: 'eléctrico',
    checks: ['Medir la batería con el motor apagado después de unas horas (12,6 V es carga completa)', 'Hacer prueba de carga o de arranque (CCA)', 'Si se descarga parada, medir el consumo con todo apagado'],
    indicators: [
      { kind: 'sensor', pid: 'VOLTAGE', stat: 'mean', op: '<', value: 12.2, when: [ENGINE_OFF], weight: 50, text: 'batería por debajo de 12,2 V con el motor apagado' },
      { kind: 'sensor', pid: 'VOLTAGE', stat: 'min', op: '<', value: 11.8, when: [ENGINE_OFF], weight: 20, text: 'la tensión cae por debajo de 11,8 V' },
      { kind: 'baseline', metric: 'resting_v', direction: 'low', weight: 35, text: 'tensión en reposo más baja que lo habitual en este auto' },
      { kind: 'symptom', symptom: 'battery_drain', weight: 40, text: 'se descarga la batería' },
      { kind: 'symptom', symptom: 'long_crank', weight: 20, text: 'tarda en arrancar' },
      { kind: 'symptom', symptom: 'no_start', weight: 15, text: 'no arranca' },
    ],
  },
  {
    id: 'charging_low',
    title: 'Alternador que no carga (o correa floja)',
    system: 'eléctrico',
    checks: ['Medir la tensión con el motor en marcha y luces encendidas: debería estar entre 13,5 y 14,8 V', 'Revisar la correa y su tensor', 'Revisar bornes y masa del alternador'],
    indicators: [
      { kind: 'sensor', pid: 'VOLTAGE', stat: 'mean', op: '<', value: 13.2, when: [RUNNING], weight: 55, text: 'menos de 13,2 V con el motor en marcha' },
      { kind: 'baseline', metric: 'charging_v', direction: 'low', weight: 35, text: 'tensión de carga más baja que lo habitual en este auto' },
      { kind: 'dtc', codes: ['P0562', 'P0620', 'P0621', 'P0622'], weight: 45, text: 'código de tensión baja o de alternador (P0562, P0620–P0622)' },
      { kind: 'symptom', symptom: 'battery_light', weight: 45, text: 'testigo de batería' },
      { kind: 'symptom', symptom: 'lights_flicker', weight: 25, text: 'luces tenues o que parpadean' },
      { kind: 'symptom', symptom: 'battery_drain', weight: 15, text: 'se descarga la batería' },
    ],
  },
  {
    id: 'charging_high',
    title: 'Sobrecarga: regulador del alternador',
    system: 'eléctrico',
    checks: ['Confirmar con un multímetro en bornes de batería', 'Cambiar el regulador o el alternador: la sobrecarga daña la batería y los módulos'],
    indicators: [
      { kind: 'sensor', pid: 'VOLTAGE', stat: 'mean', op: '>', value: 14.9, when: [RUNNING], weight: 60, text: 'más de 14,9 V con el motor en marcha' },
      { kind: 'baseline', metric: 'charging_v', direction: 'high', weight: 30, text: 'tensión de carga más alta que lo habitual' },
      { kind: 'dtc', codes: ['P0563'], weight: 45, text: 'código de tensión alta (P0563)' },
      { kind: 'symptom', symptom: 'battery_light', weight: 20, text: 'testigo de batería' },
      { kind: 'symptom', symptom: 'lights_flicker', weight: 15, text: 'luces que parpadean' },
    ],
  },
  // ── Exhaust and emissions ─────────────────────────────────────────────────
  {
    id: 'o2_sensor',
    title: 'Sonda lambda (sensor de oxígeno)',
    system: 'escape y emisiones',
    checks: ['Ver la señal de la sonda delantera: en caliente debe oscilar entre 0,1 y 0,9 V', 'Revisar el calefactor de la sonda y su ficha', 'Buscar pérdidas de escape antes de la sonda'],
    indicators: [
      { kind: 'dtc', codes: ['P013*', 'P014*', 'P015*', 'P016*'], weight: 55, text: 'código de sonda lambda (P0130–P0167)' },
      { kind: 'sensor', pid: 'O2_B1S1', stat: 'range', op: '<', value: 0.3, when: [WARM, RUNNING], weight: 30, text: 'la sonda delantera casi no oscila en caliente' },
      { kind: 'symptom', symptom: 'high_consumption', weight: 15, text: 'consume mucho' },
      { kind: 'symptom', symptom: 'check_on', weight: 10, text: 'testigo de motor encendido' },
    ],
  },
  {
    id: 'catalyst',
    title: 'Catalizador gastado',
    system: 'escape y emisiones',
    checks: ['Antes de cambiarlo, resolver fallas de encendido o mezcla (lo dañan y vuelve a pasar)', 'Comparar las sondas: la trasera debería quedar estable', 'Golpear suave el catalizador frío: un ruido de piedras indica panal roto'],
    indicators: [
      { kind: 'dtc', codes: ['P0420', 'P0430'], weight: 60, text: 'código de eficiencia del catalizador (P0420/P0430)' },
      { kind: 'sensor', pid: 'O2_B1S2', stat: 'range', op: '>', value: 0.5, when: [WARM, RUNNING], weight: 30, text: 'la sonda trasera oscila como la delantera' },
      { kind: 'symptom', symptom: 'smell_sulfur', weight: 30, text: 'olor a huevo podrido' },
      { kind: 'symptom', symptom: 'exhaust_rattle', weight: 25, text: 'ruido en el escape' },
      { kind: 'symptom', symptom: 'power_loss', weight: 10, text: 'falta de potencia (catalizador tapado)' },
    ],
  },
  {
    id: 'egr',
    title: 'Válvula EGR trabada o conductos tapados',
    system: 'escape y emisiones',
    checks: ['Revisar y limpiar la válvula EGR y sus conductos', 'Ver si se mueve al pedirlo con un escáner que lo permita'],
    indicators: [
      { kind: 'dtc', codes: ['P0400', 'P0401', 'P0402', 'P0403', 'P0404', 'P0405', 'P0406', 'P0407', 'P0408', 'P0409'], weight: 60, text: 'código de EGR (P0400–P0409)' },
      { kind: 'symptom', symptom: 'rough_idle', weight: 20, text: 'ralentí inestable (EGR abierta)' },
      { kind: 'symptom', symptom: 'knock_ping', weight: 20, text: 'pistonea (EGR cerrada)' },
      { kind: 'symptom', symptom: 'stall', weight: 15, text: 'se apaga' },
    ],
  },
  {
    id: 'evap',
    title: 'Pérdida en el sistema EVAP (tapa de nafta, mangueras o válvula de purga)',
    system: 'escape y emisiones',
    checks: ['Revisar que la tapa del tanque cierre bien y su junta', 'Revisar la válvula de purga del canister', 'Prueba de humo del sistema EVAP'],
    indicators: [
      { kind: 'dtc', codes: ['P044*', 'P045*'], weight: 60, text: 'código del sistema EVAP (P0440–P0457)' },
      { kind: 'symptom', symptom: 'smell_fuel', weight: 25, text: 'olor a nafta' },
      { kind: 'symptom', symptom: 'hard_start_hot', weight: 10, text: 'arranca mal después de cargar (purga abierta)' },
    ],
  },
  // ── Diesel and turbo ──────────────────────────────────────────────────────
  {
    id: 'turbo_boost',
    title: 'Turbo con poca o demasiada presión (pérdida de manguera, wastegate o geometría)',
    system: 'admisión',
    checks: ['Revisar mangueras y abrazaderas del intercooler', 'Verificar el actuador del wastegate o de la geometría variable', 'Ver si hay juego o aceite en el eje del turbo'],
    indicators: [
      { kind: 'dtc', codes: ['P0299', 'P0234', 'P0235', 'P0236', 'P0237', 'P0238'], weight: 60, text: 'código de presión de turbo (P0299, P0234–P0238)' },
      { kind: 'symptom', symptom: 'power_loss', weight: 25, text: 'falta de potencia' },
      { kind: 'symptom', symptom: 'hiss', weight: 15, text: 'silbido al acelerar' },
      { kind: 'symptom', symptom: 'smoke_black', weight: 15, text: 'humo negro' },
    ],
  },
  {
    id: 'dpf',
    title: 'Filtro de partículas (DPF) tapado',
    system: 'escape y emisiones',
    checks: ['Hacer un tramo de ruta sostenido para que regenere', 'Revisar el sensor de presión diferencial y sus mangueras', 'Si no regenera, regeneración forzada o limpieza en taller'],
    indicators: [
      { kind: 'dtc', codes: ['P2002', 'P2003', 'P2463', 'P2452', 'P2453', 'P2454', 'P2455'], weight: 60, text: 'código del filtro de partículas (P2002, P2463, P2452–P2455)' },
      { kind: 'symptom', symptom: 'dpf_light', weight: 45, text: 'testigo del filtro de partículas' },
      { kind: 'symptom', symptom: 'power_loss', weight: 20, text: 'falta de potencia (modo de emergencia)' },
      { kind: 'symptom', symptom: 'high_consumption', weight: 10, text: 'consume mucho' },
    ],
  },
  // ── Transmission ─────────────────────────────────────────────────────────
  {
    id: 'clutch',
    title: 'Embrague gastado',
    system: 'transmisión',
    checks: ['Probar en cuarta o quinta a bajas vueltas acelerando a fondo: si las rpm suben sin que suba la velocidad, patina', 'Revisar el recorrido del pedal y el sistema hidráulico'],
    indicators: [
      { kind: 'symptom', symptom: 'clutch_slip', weight: 60, text: 'patina el embrague' },
      { kind: 'symptom', symptom: 'smell_burning', weight: 25, text: 'olor a quemado' },
      { kind: 'symptom', symptom: 'power_loss', weight: 10, text: 'falta de potencia' },
    ],
  },
  {
    id: 'auto_transmission',
    title: 'Caja automática: aceite, solenoides o adaptaciones',
    system: 'transmisión',
    checks: ['Revisar el nivel y el estado del aceite de la caja (color, olor a quemado)', 'Leer los códigos del módulo de la caja', 'Consultar si hay actualización o reaprendizaje para esa caja'],
    indicators: [
      { kind: 'dtc', codes: ['P07*', 'P08*'], weight: 55, text: 'código de transmisión (P07xx/P08xx)' },
      { kind: 'symptom', symptom: 'harsh_shift', weight: 40, text: 'cambios bruscos' },
      { kind: 'symptom', symptom: 'smell_burning', weight: 15, text: 'olor a quemado' },
    ],
  },
  // ── What the OBD cannot see ───────────────────────────────────────────────
  {
    id: 'brakes_hydraulic',
    title: 'Frenos: aire en el circuito, líquido bajo o bomba',
    system: 'frenos',
    checks: ['Revisar el nivel de líquido de frenos y buscar pérdidas en ruedas y caños', 'Purgar el circuito', 'Si el pedal se va al fondo con el auto detenido, revisar la bomba de freno'],
    safety: 'Con el pedal largo o que se hunde no sigas andando: hacelo revisar antes de usar el auto.',
    indicators: [
      { kind: 'symptom', symptom: 'brake_pedal_soft', weight: 70, text: 'pedal de freno largo o que se hunde' },
      { kind: 'symptom', symptom: 'abs_light', weight: 15, text: 'testigo de ABS' },
    ],
  },
  {
    id: 'brakes_wear',
    title: 'Frenos: pastillas gastadas o discos alabeados',
    system: 'frenos',
    checks: ['Medir el espesor de pastillas y discos', 'Si vibra al frenar, medir el alabeo de los discos'],
    safety: 'Si chillan con metal contra metal, revisalos cuanto antes: la frenada empeora y el disco se arruina.',
    indicators: [
      { kind: 'symptom', symptom: 'brake_noise', weight: 65, text: 'ruido o vibración al frenar' },
      { kind: 'symptom', symptom: 'steering_vibration', weight: 20, text: 'vibra el volante' },
      { kind: 'symptom', symptom: 'pulls_side', weight: 15, text: 'tira hacia un lado' },
    ],
  },
  {
    id: 'abs_sensor',
    title: 'Sensor de velocidad de rueda o módulo ABS',
    system: 'frenos',
    checks: ['Leer los códigos del módulo ABS con un escáner que llegue a ese módulo', 'Revisar el sensor de la rueda y su anillo (suciedad, cable cortado)'],
    indicators: [
      { kind: 'symptom', symptom: 'abs_light', weight: 55, text: 'testigo de ABS' },
      { kind: 'dtc', codes: ['C0*'], weight: 30, text: 'código de chasis (C0xxx)' },
    ],
  },
  {
    id: 'wheel_bearing',
    title: 'Rulemán (rodamiento) de rueda gastado',
    system: 'tren delantero y suspensión',
    checks: ['Con el auto levantado, mover la rueda arriba-abajo buscando juego y girarla escuchando', 'En ruta, ver si el ruido cambia al doblar hacia un lado'],
    indicators: [
      { kind: 'symptom', symptom: 'wheel_hum', weight: 65, text: 'zumbido que sube con la velocidad' },
      { kind: 'symptom', symptom: 'steering_vibration', weight: 15, text: 'vibra el volante' },
    ],
  },
  {
    id: 'cv_joint',
    title: 'Junta homocinética gastada',
    system: 'tren delantero y suspensión',
    checks: ['Revisar el fuelle de la homocinética: si está roto, perdió la grasa', 'Probar girando con el volante a fondo en una playa de estacionamiento'],
    indicators: [{ kind: 'symptom', symptom: 'cv_click', weight: 70, text: 'clic al doblar' }],
  },
  {
    id: 'suspension',
    title: 'Suspensión: amortiguadores, bujes o extremos',
    system: 'tren delantero y suspensión',
    checks: ['Revisar amortiguadores (pérdidas, rebote), bujes de parrilla, bieletas y extremos de dirección', 'Hacer alineación y balanceo si tira o vibra'],
    indicators: [
      { kind: 'symptom', symptom: 'suspension_noise', weight: 55, text: 'ruido en la suspensión' },
      { kind: 'symptom', symptom: 'pulls_side', weight: 25, text: 'tira hacia un lado' },
      { kind: 'symptom', symptom: 'steering_vibration', weight: 20, text: 'vibra el volante' },
    ],
  },
  {
    id: 'steering',
    title: 'Dirección asistida (bomba, líquido o asistencia eléctrica)',
    system: 'dirección',
    checks: ['Hidráulica: nivel de líquido, pérdidas y correa', 'Eléctrica: tensión de batería y códigos del módulo de dirección'],
    indicators: [
      { kind: 'symptom', symptom: 'steering_heavy', weight: 65, text: 'dirección dura' },
      { kind: 'sensor', pid: 'VOLTAGE', stat: 'mean', op: '<', value: 12.5, when: [RUNNING], weight: 15, text: 'tensión baja con el motor en marcha (la asistencia eléctrica la necesita)' },
    ],
  },
  {
    id: 'ac',
    title: 'Aire acondicionado: falta de gas, compresor o electroventilador',
    system: 'climatización',
    checks: ['Ver si el compresor engrana al prender el aire (clic y caída de rpm)', 'Medir presiones y buscar pérdidas (la carga de gas sin reparar se vuelve a ir)', 'Revisar que el electroventilador arranque con el aire prendido'],
    indicators: [
      { kind: 'symptom', symptom: 'ac_not_cold', weight: 70, text: 'el aire acondicionado no enfría' },
      { kind: 'dtc', codes: ['P0530', 'P0531', 'P0532', 'P0533', 'P0534'], weight: 30, text: 'código del sensor de presión del aire acondicionado (P0530–P0534)' },
    ],
  },
  {
    id: 'blower',
    title: 'Forzador del habitáculo: resistencia, módulo o motor',
    system: 'climatización',
    checks: ['Si solo anda en la velocidad máxima, cambiar la resistencia del forzador', 'Si no anda en ninguna, revisar fusible, relé y motor'],
    indicators: [{ kind: 'symptom', symptom: 'blower_fault', weight: 70, text: 'el ventilador del habitáculo no sopla bien' }],
  },
  {
    id: 'airbag',
    title: 'Sistema de airbag (ficha de asiento, cinta del volante o sensor)',
    system: 'seguridad',
    checks: ['Leer los códigos del módulo de airbag', 'Revisar las fichas debajo de los asientos (sin tocar con el contacto puesto)', 'Revisar la cinta espiral del volante'],
    safety: 'Con el testigo de airbag encendido, los airbags pueden no abrirse en un choque. Hacelo revisar pronto.',
    indicators: [
      { kind: 'symptom', symptom: 'airbag_light', weight: 60, text: 'testigo de airbag' },
      { kind: 'dtc', codes: ['B00*'], weight: 40, text: 'código del sistema de retención (B00xx)' },
    ],
  },
  {
    id: 'tpms',
    title: 'Presión de neumáticos o sensor de TPMS',
    system: 'seguridad',
    checks: ['Medir la presión de las cuatro ruedas en frío', 'Si las presiones están bien, hacer el reaprendizaje del sistema o revisar la pila del sensor'],
    indicators: [{ kind: 'symptom', symptom: 'tpms_light', weight: 65, text: 'testigo de presión de neumáticos' }],
  },
  {
    id: 'network',
    title: 'Comunicación entre módulos (red CAN)',
    system: 'comunicación',
    checks: ['Revisar la batería y las masas: tensión baja provoca estos códigos', 'Ver qué módulo dejó de responder y revisar su ficha y su fusible'],
    indicators: [
      { kind: 'dtc', codes: ['U0*'], weight: 60, text: 'código de pérdida de comunicación (U0xxx)' },
      { kind: 'sensor', pid: 'VOLTAGE', stat: 'min', op: '<', value: 11.5, weight: 20, text: 'tensión por debajo de 11,5 V' },
    ],
  },
];
