// The verdicts on Diagnóstico's summary screens (2026-10-31): a state first, the
// data under it. Words only for what was measured; no rule is invented for an
// inspection we have not checked (the VTV says "puede no pasar", not "no pasa",
// when only monitors are incomplete).

import type { MonitorId } from '@/core/utils/obdDiagnostics';

export type Tone = 'ok' | 'warn' | 'bad';

export interface Verdict {
  readonly tone: Tone;
  readonly title: string;
  readonly detail: string;
}

// read_readiness's data.
export interface ReadinessData {
  readonly milOn: boolean;
  readonly dtcCount: number;
  readonly complete: readonly MonitorId[];
  readonly incomplete: readonly MonitorId[];
  readonly distSinceClear?: { readonly value: number; readonly unit: string };
}

export function readinessVerdict(d: ReadinessData, label: (id: MonitorId) => string): Verdict {
  const total = d.complete.length + d.incomplete.length;
  if (d.milOn) {
    return { tone: 'bad', title: 'No pasa la VTV', detail: `El testigo del motor está encendido (${d.dtcCount} ${d.dtcCount === 1 ? 'código' : 'códigos'}).` };
  }
  if (d.incomplete.length) {
    const list = d.incomplete.map(label).join(', ');
    const since = d.distSinceClear ? ` Van ${Math.round(d.distSinceClear.value)} ${d.distSinceClear.unit} desde que se borraron los códigos.` : '';
    return {
      tone: 'warn',
      title: `Puede no pasar: ${d.complete.length} de ${total} monitores listos`,
      detail: `Pendientes: ${list}. Se completan manejando unos días en ciudad y ruta.${since}`,
    };
  }
  return { tone: 'ok', title: 'Listo para la VTV', detail: `Testigo apagado y los ${total} monitores completos.` };
}

// Resting battery and charging (alternator), the usual 12 V lead-acid figures.
export function batteryVerdict(volts: number, engineRunning: boolean | null): Verdict {
  const v = volts.toFixed(1).replace('.', ',');
  if (engineRunning) {
    if (volts < 13.2) return { tone: 'bad', title: `${v} V con el motor en marcha`, detail: 'El alternador no está cargando: revisá la correa, el alternador y los bornes.' };
    if (volts > 15) return { tone: 'bad', title: `${v} V con el motor en marcha`, detail: 'Carga de más: el regulador del alternador puede estar fallando.' };
    return { tone: 'ok', title: `${v} V: carga bien`, detail: 'Con el motor en marcha, entre 13,2 y 15 V es normal.' };
  }
  const state = engineRunning === false ? 'con el motor apagado' : 'sin saber si el motor está en marcha';
  if (volts >= 12.4) return { tone: 'ok', title: `${v} V: batería bien`, detail: `Medida ${state}. Entre 12,4 y 12,8 V es una batería cargada.` };
  if (volts >= 12.0) return { tone: 'warn', title: `${v} V: batería baja`, detail: `Medida ${state}. Conviene cargarla o andar un rato.` };
  return { tone: 'bad', title: `${v} V: batería descargada`, detail: `Medida ${state}. Puede no arrancar; revisala o cambiala.` };
}

// Who reported a code, from the reply ID: OBD fixes engine and gearbox
// (7E8/7E9, 18DAF110/18DAF118); any other is shown by its ID.
export function ecuLabel(ecu: string | null): string {
  if (!ecu) return 'sin dato de la ECU';
  const id = ecu.toUpperCase();
  if (id === '7E8' || id === '18DAF110') return `Motor · ${id}`;
  if (id === '7E9' || id === '18DAF118') return `Caja · ${id}`;
  return `ECU ${id}`;
}
