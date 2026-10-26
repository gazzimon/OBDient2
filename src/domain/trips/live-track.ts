// Live position for the lab's Traccar (decision 2026-10-20): how often, and a
// queue for the stretches without signal, so the web still gets the whole
// path when the phone is back online.

import { pseudonym } from '@/domain/privacy/hash';

export interface TrackPoint {
  readonly t: number;
  readonly lat: number;
  readonly lng: number;
  readonly kmh: number;
  readonly bearing: number | null;
  readonly acc: number;
  readonly obd?: Readonly<Record<string, number>>;
  // The car: the first 11 characters of its VIN (carOf), when the adapter has read it.
  readonly vin?: string | null;
}

export const EVERY_MOVING_MS = 5_000;
export const EVERY_STILL_MS = 60_000;
export const BATCH = 20; // what obdient-tools takes at once
export const MAX_QUEUED = 100; // ~8 min moving; older points are dropped first

export function trackDue(lastAt: number | null, now: number, kmh: number): boolean {
  if (lastAt == null) return true;
  return now - lastAt >= (kmh >= 3 ? EVERY_MOVING_MS : EVERY_STILL_MS);
}

// The device is the adapter (decision 2026-10-20), but the lab receives a
// pseudonym of its Bluetooth address, not the address (ADR-0011): "obd_" + 16 hex
// characters of a hash salted with this install's secret, which is what Traccar
// accepts and what keeps one adapter's trips together. Without an address, the
// phone itself.
export function trackDeviceFor(salt: string, adapterId: string | null): string {
  const clean = (adapterId ?? '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  return `obd_${pseudonym(salt, clean.length >= 4 ? `adapter:${clean}` : 'phone')}`;
}

// The car as the lab gets it: the first 11 characters of the VIN (make, model
// line, engine, year, plant), never the serial that names the unit.
export function carOf(vin: string | null): string | null {
  return vin && vin.length >= 11 ? vin.slice(0, 11) : null;
}

export class TrackQueue {
  private points: TrackPoint[] = [];

  get size(): number {
    return this.points.length;
  }

  push(p: TrackPoint): void {
    this.points.push(p);
    if (this.points.length > MAX_QUEUED) this.points.splice(0, this.points.length - MAX_QUEUED);
  }

  // The oldest points first, up to one batch.
  next(): readonly TrackPoint[] {
    return this.points.slice(0, BATCH);
  }

  // The server took the first `n`.
  sent(n: number): void {
    this.points.splice(0, n);
  }
}
