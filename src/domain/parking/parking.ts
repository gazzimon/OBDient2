// "Dónde estacioné" (2026-10-29), without extra hardware: when the Bluetooth
// link to the adapter goes (contact off, or the phone walks away from the car),
// the phone's position at that moment is where the car was left. Free, and the
// app works alone (ADR-0001): GPS only, no network.
//
// The position is the best fix around that moment: a recent one from the
// navigation if there is one, else a fresh fix, else the last one the phone
// knows. A fix that is too old or too vague is not a parking spot. The phone
// may be a few metres away from the car (Bluetooth range): good enough to walk
// back to it. Kept on the phone only; one spot per car, the last ones first.

import { bearingDeg, distanceM, type LatLng } from '@/domain/geo/geo';

export interface Fix extends LatLng {
  readonly accuracyM: number;
  // When the phone measured it, epoch ms.
  readonly at: number;
}

export interface ParkingSpot extends LatLng {
  readonly accuracyM: number;
  // When the link went: when the car was left.
  readonly at: number;
  readonly fixAt: number;
  readonly vin: string | null;
  // "Chevrolet 2024", for the card and the assistant.
  readonly car: string | null;
  // The user pressed "Desconectar", or the link went by itself.
  readonly reason: 'lost' | 'user';
}

export interface ParkingStorage {
  load(): ParkingSpot[];
  save(spots: readonly ParkingSpot[]): void;
}

// A fix older than this is not "where the link went".
export const MAX_FIX_AGE_MS = 10 * 60_000;
// Recent enough to trust over a fresher but vaguer one.
const RECENT_MS = 2 * 60_000;
export const MAX_ACCURACY_M = 300;
export const MAX_SPOTS = 20;

// The best of the candidate fixes for a link that went at `at`.
export function bestFix(candidates: readonly (Fix | null | undefined)[], at: number): Fix | null {
  const usable = candidates.filter(
    (f): f is Fix => f != null && Number.isFinite(f.lat) && Number.isFinite(f.lng) && f.accuracyM <= MAX_ACCURACY_M && Math.abs(at - f.at) <= MAX_FIX_AGE_MS,
  );
  const recent = usable.filter((f) => Math.abs(at - f.at) <= RECENT_MS);
  const pool = recent.length ? recent : usable;
  // Among recent fixes the most precise; otherwise the closest in time.
  return [...pool].sort((a, b) => (recent.length ? a.accuracyM - b.accuracyM : Math.abs(at - a.at) - Math.abs(at - b.at)))[0] ?? null;
}

export class ParkingLog {
  constructor(private readonly storage: ParkingStorage) {}

  // One spot per car (a car without VIN is one more): the new one replaces it.
  save(spot: ParkingSpot): void {
    const others = this.storage.load().filter((s) => s.vin !== spot.vin);
    this.storage.save([spot, ...others].slice(0, MAX_SPOTS));
  }

  latest(): ParkingSpot | null {
    return this.storage.load()[0] ?? null;
  }

  forVin(vin: string | null): ParkingSpot | null {
    return this.storage.load().find((s) => s.vin === vin) ?? null;
  }

  // "Ya encontré el auto".
  remove(at: number): void {
    this.storage.save(this.storage.load().filter((s) => s.at !== at));
  }

  clear(): void {
    this.storage.save([]);
  }
}

const DIRECTIONS = ['al norte', 'al noreste', 'al este', 'al sudeste', 'al sur', 'al sudoeste', 'al oeste', 'al noroeste'];

export function direction(from: LatLng, to: LatLng): string {
  return DIRECTIONS[Math.round(bearingDeg(from, to) / 45) % 8]!;
}

export function ago(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `hace ${h} h ${min % 60} min` : `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'hace 1 día' : `hace ${d} días`;
}

export function meters(m: number): string {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

export interface SpotView {
  // "hace 2 h 10 min"
  readonly ago: string;
  readonly distanceM: number | null;
  // "a 350 m al noreste"; null without a position now.
  readonly where: string | null;
  // The car is right here (inside the fix's own error).
  readonly near: boolean;
}

export function describeSpot(spot: ParkingSpot, here: LatLng | null, now: number): SpotView {
  const d = here ? distanceM(here, spot) : null;
  const near = d != null && d <= Math.max(30, spot.accuracyM);
  return {
    ago: ago(now - spot.at),
    distanceM: d,
    where: d == null ? null : near ? 'acá cerca' : `a ${meters(d)} ${direction(here!, spot)}`,
    near,
  };
}
