// Without the assistant (M4): no connection, or the server does not answer.
//
// - A phrase the router knows ("¿tengo códigos?") runs its tool and gets a
//   fixed answer built from the result.
// - Anything else becomes a note: the driver's words, the symptoms in them and
//   what the car said at that moment (codes, a few live values). Nothing is
//   sent by itself: when the assistant is back, the screen offers to pass the
//   notes on, and only with the driver's yes.

import { PID_DEFINITIONS, type PidId } from '@/core/constants/pids';
import { hypothesesText, type Hypothesis } from '@/domain/diagnosis/engine';
import type { PhraseIntent } from './phrase-router';
import { matchSymptoms, symptomLabel } from './symptoms';
import type { ToolOutcome } from './tools';

// Notes waiting per conversation; older ones go first.
export const MAX_NOTES = 20;

// Live values kept with a note, when the car answers them.
export const NOTE_PIDS: readonly PidId[] = ['RPM', 'SPEED', 'COOLANT_TEMP', 'ENGINE_LOAD', 'VOLTAGE'];

export interface CarSnapshot {
  // Stored codes; null when they could not be read.
  readonly codes: readonly string[] | null;
  // "RPM 850 rpm, temperatura 88 °C"; null when nothing was read.
  readonly values: string | null;
}

export interface OfflineNote {
  readonly id: string;
  readonly at: number;
  readonly text: string;
  readonly symptoms: readonly string[];
  readonly denied: readonly string[];
  readonly moving: boolean;
  // Null when the adapter was not connected.
  readonly car: CarSnapshot | null;
}

export function makeNote(
  id: string,
  at: number,
  text: string,
  moving: boolean,
  car: CarSnapshot | null,
): OfflineNote {
  const { confirmed, denied } = matchSymptoms(text);
  return { id, at, text: text.trim(), symptoms: confirmed, denied, moving, car };
}

// What the screen says after taking a note. The first note that describes a
// problem asks the two questions a mechanic would ask; the answers become notes
// too.
export function noteReply(note: OfflineNote, earlier: readonly OfflineNote[]): string {
  const base = 'No pude comunicarme con el asistente. Lo anoté y se lo paso cuando vuelva la conexión, si me decís que sí.';
  const parts = [base];
  if (note.symptoms.length) parts.push(`Anoté: ${note.symptoms.map(symptomLabel).join(', ')}.`);
  if (note.car?.codes?.length) parts.push(`El auto tiene estos códigos: ${note.car.codes.join(', ')}.`);
  const asked = earlier.some((n) => n.symptoms.length > 0);
  if (note.symptoms.length && !asked) parts.push('¿Desde cuándo pasa? ¿Pasa en frío, en caliente o siempre?');
  return parts.join(' ');
}

// The notes as one message for the assistant, sent with the driver's yes.
export function notesBrief(notes: readonly OfflineNote[], timeOf: (at: number) => string): string {
  const lines = notes.map((n, i) => {
    const parts = [`${i + 1}. ${timeOf(n.at)}${n.moving ? ' (en movimiento)' : ''}: "${n.text}"`];
    if (n.symptoms.length) parts.push(`síntomas: ${n.symptoms.map(symptomLabel).join(', ')}`);
    if (n.denied.length) parts.push(`dice que no: ${n.denied.map(symptomLabel).join(', ')}`);
    if (!n.car) parts.push('adaptador desconectado');
    else {
      if (n.car.codes) parts.push(n.car.codes.length ? `códigos: ${n.car.codes.join(', ')}` : 'sin códigos');
      if (n.car.values) parts.push(n.car.values);
    }
    return parts.join(' · ');
  });
  return [
    `Mientras no había conexión con el asistente anoté esto (${notes.length === 1 ? '1 nota' : `${notes.length} notas`}):`,
    ...lines,
    'Revisalo y decime qué pensás. Si hace falta, medí ahora con las herramientas.',
  ].join('\n');
}

// "RPM 850 rpm, Temperatura … 88 °C" from a read_pids result.
export function snapshotValues(outcome: ToolOutcome): string | null {
  if (!outcome.ok) return null;
  const data = outcome.data as Partial<Record<PidId, { value: number; unit: string }>>;
  const parts = NOTE_PIDS.flatMap((p) => {
    const v = data[p];
    return v ? [`${PID_DEFINITIONS[p].name} ${number(v.value)} ${v.unit}`] : [];
  });
  return parts.length ? parts.join(', ') : null;
}

export function snapshotCodes(outcome: ToolOutcome): string[] | null {
  if (!outcome.ok) return null;
  const codes = (outcome.data as { codes?: { code: string }[] }).codes;
  return codes ? codes.map((c) => c.code) : null;
}

// The fixed answer to a phrase the router knew.
export function intentAnswer(intent: PhraseIntent, outcome: ToolOutcome): string {
  if (!outcome.ok) return outcome.message;
  const data = outcome.data as Record<string, unknown>;
  switch (intent) {
    case 'codes': {
      const codes = (data.codes ?? []) as { code: string; description: string | null }[];
      if (!codes.length) return 'El auto no tiene códigos guardados.';
      const lines = codes.map((c) => `- ${c.code}: ${c.description ? firstSentence(c.description) : 'sin descripción en la base'}`);
      return [`El auto tiene ${codes.length === 1 ? '1 código' : `${codes.length} códigos`}:`, ...lines].join('\n');
    }
    case 'battery': {
      const v = (data.VOLTAGE as { value: number } | undefined)?.value;
      return v == null ? 'No pude leer la tensión.' : `La tensión es ${number(v)} V.`;
    }
    case 'live_data': {
      const parts = (Object.keys(PID_DEFINITIONS) as PidId[]).flatMap((p) => {
        const v = (data as Partial<Record<PidId, { value: number | null; unit: string }>>)[p];
        return v?.value != null ? [`- ${PID_LABEL[p] ?? PID_DEFINITIONS[p].name}: ${number(v.value)} ${v.unit}`] : [];
      });
      return parts.length ? ['Ahora el auto marca:', ...parts].join('\n') : 'El auto no respondió a esos valores.';
    }
    case 'diagnose':
      return hypothesesText(diagnoseFrom(data));
    case 'route_status': {
      if (!data.navigating && !data.arrived) return 'No hay una navegación en curso.';
      if (data.arrived) return 'Llegaste al destino.';
      return `Faltan ${number(data.remainingKm as number)} km, unos ${data.remainingMin as number} minutos: llegás a las ${data.arrival as string}.`;
    }
    case 'parked': {
      const car = data.car ? `Tu ${data.car as string}` : 'El auto';
      const where = (data.where as string | null) ?? 'en el lugar guardado';
      const address = data.address ? ` (${data.address as string})` : '';
      return `${car} quedó ${where}${address}, ${data.left as string}. Lo ves en la pestaña Mapa, con la P.`;
    }
    case 'stop_navigation':
      return data.stopped ? 'Listo, terminé la navegación.' : 'No había una navegación en curso.';
    case 'readiness':
    case 'freeze_frame':
    case 'vehicle_info':
      return `${outcome.summary}.`;
  }
}

// Spanish names for the live values the phrase reads (and the report).
export const PID_LABEL: Partial<Record<PidId, string>> = {
  RPM: 'Vueltas del motor',
  SPEED: 'Velocidad',
  COOLANT_TEMP: 'Temperatura del motor',
  ENGINE_LOAD: 'Carga del motor',
  VOLTAGE: 'Tensión de batería',
  FUEL_TRIM_SHORT: 'Corrección corta de mezcla',
  FUEL_TRIM_LONG: 'Corrección larga de mezcla',
  INTAKE_MAP: 'Presión de admisión',
};

// The diagnose tool's data back into the shape hypothesesText reads.
function diagnoseFrom(data: Record<string, unknown>): Hypothesis[] {
  const list = (data.hypotheses ?? []) as { cause: string; system: Hypothesis['system']; confidencePct: number; evidence: string[]; checks: string[]; safety?: string }[];
  return list.map((h) => ({
    id: h.cause,
    title: h.cause,
    system: h.system,
    confidence: h.confidencePct,
    score: 0,
    evidence: h.evidence,
    against: [],
    toCheck: [],
    checks: h.checks,
    safety: h.safety ?? null,
  }));
}

function firstSentence(text: string): string {
  const i = text.indexOf('. ');
  return i > 0 ? text.slice(0, i) : text.replace(/\.$/, '');
}

// Comma decimal, at most one decimal.
function number(v: number): string {
  return String(Math.round(v * 10) / 10).replace('.', ',');
}
