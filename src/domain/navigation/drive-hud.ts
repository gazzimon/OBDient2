// What the driving screen shows, as plain functions (docs/plans/modo-navegacion-ux.md, F1).

import type { SoundMode } from '@/domain/voice/voice-arbiter';
import { distanceEs, instructionEs } from './guidance';
import type { Maneuver, Route } from './route';

// "Luego ↰": the maneuver right after the next one, when it comes this soon.
export const THEN_WITHIN_M = 150;

export function followingManeuver(route: Route, next: Maneuver | null): Maneuver | null {
  if (!next || next.type === 'arrive') return null;
  const i = route.maneuvers.indexOf(next);
  const after = i >= 0 ? route.maneuvers[i + 1] : undefined;
  if (!after || after.routeOffsetM - next.routeOffsetM > THEN_WITHIN_M) return null;
  return after;
}

// Tapping the banner says it again.
export function repeatPhrase(m: Maneuver, distanceM: number): string {
  if (m.type === 'arrive') return `En ${distanceEs(distanceM)}, llegás a tu destino`;
  const text = instructionEs(m);
  return `En ${distanceEs(distanceM)}, ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

const SOUND_ORDER: readonly SoundMode[] = ['all', 'alerts', 'silent'];

export function nextSoundMode(mode: SoundMode): SoundMode {
  return SOUND_ORDER[(SOUND_ORDER.indexOf(mode) + 1) % SOUND_ORDER.length]!;
}

export const SOUND_LABEL: Readonly<Record<SoundMode, string>> = {
  all: 'Voz: todo',
  alerts: 'Voz: solo alertas',
  silent: 'Voz: silencio',
};

export type GpsQuality = 'ok' | 'weak' | 'none';

// The dot on the recentre button: no fix, a poor one, or good enough to guide.
export function gpsQuality(accuracyM: number | null): GpsQuality {
  if (accuracyM == null || !Number.isFinite(accuracyM)) return 'none';
  return accuracyM <= 20 ? 'ok' : 'weak';
}
