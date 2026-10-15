// Turn-by-turn wording and WHEN to speak it.
//
// Instructions are built here from the maneuver type, not taken from the
// routing provider: it keeps the voice consistent across providers and in the
// app's language (Spanish first).

import type { Maneuver, ManeuverModifier } from './route';

const MODIFIER_ES: Record<ManeuverModifier, string> = {
  uturn: 'da la vuelta en U',
  'sharp-right': 'gira bruscamente a la derecha',
  right: 'gira a la derecha',
  'slight-right': 'mantente a la derecha',
  straight: 'sigue derecho',
  'slight-left': 'mantente a la izquierda',
  left: 'gira a la izquierda',
  'sharp-left': 'gira bruscamente a la izquierda',
};

export function instructionEs(m: Maneuver): string {
  const onto = m.roadName ? ` hacia ${m.roadName}` : '';
  switch (m.type) {
    case 'depart':
      return `Inicia la ruta${m.roadName ? ` por ${m.roadName}` : ''}`;
    case 'arrive':
      return 'Llegaste a tu destino';
    case 'roundabout':
      return m.exit != null
        ? `En la rotonda, toma la ${ordinalEs(m.exit)} salida${onto}`
        : `Entra en la rotonda${onto}`;
    case 'on-ramp':
      return `Toma la entrada${onto}`;
    case 'off-ramp':
      return `Toma la salida${onto}`;
    case 'fork':
    case 'merge':
    case 'end-of-road':
    case 'turn':
    case 'continue': {
      const verb = m.modifier ? MODIFIER_ES[m.modifier] : 'continúa';
      return capitalize(`${verb}${onto}`);
    }
  }
}

// Spoken distance, rounded the way a person would say it.
export function distanceEs(meters: number): string {
  if (meters >= 1000) {
    const km = Math.round(meters / 100) / 10;
    return `${String(km).replace('.', ',')} km`;
  }
  if (meters >= 100) return `${Math.round(meters / 50) * 50} m`;
  return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
}

// Announcement stages, farthest first. Each fires once per maneuver.
// Thresholds scale with speed so a highway exit is announced earlier.
export type Stage = 'far' | 'near' | 'now';

export function stageFor(distanceM: number, speedMps: number): Stage | null {
  const lead = Math.max(0, speedMps) * 4; // ~4 s of travel added to each threshold
  if (distanceM <= 30 + lead * 0.5) return 'now';
  if (distanceM <= 200 + lead) return 'near';
  if (distanceM <= 800 + lead * 2) return 'far';
  return null;
}

export class Announcer {
  private spoken = new Set<string>();

  // Returns the phrase to speak now, or null. Keyed per maneuver+stage so a
  // jittering distance never repeats an announcement.
  next(maneuver: Maneuver | null, distanceM: number | null, speedMps: number): string | null {
    if (!maneuver || distanceM == null) return null;
    const stage = stageFor(distanceM, speedMps);
    if (!stage) return null;

    const key = `${maneuver.routeOffsetM}:${stage}`;
    // A closer stage supersedes the farther ones still unspoken.
    if (this.spoken.has(key)) return null;
    this.spoken.add(key);

    const text = instructionEs(maneuver);
    if (stage === 'now') return text;
    if (maneuver.type === 'arrive') return `En ${distanceEs(distanceM)}, llegarás a tu destino`;
    return `En ${distanceEs(distanceM)}, ${lowerFirst(text)}`;
  }

  reset(): void {
    this.spoken = new Set();
  }
}

function ordinalEs(n: number): string {
  const words = ['primera', 'segunda', 'tercera', 'cuarta', 'quinta', 'sexta', 'séptima', 'octava'];
  return words[n - 1] ?? `${n}ª`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
