// Live position for the lab's Traccar (decision 2026-10-20): how often, and a
// queue for the stretches without signal, so the web still gets the whole
// path when the phone is back online.

export interface TrackPoint {
  readonly t: number;
  readonly lat: number;
  readonly lng: number;
  readonly kmh: number;
  readonly bearing: number | null;
  readonly acc: number;
  readonly obd?: Readonly<Record<string, number>>;
}

export const EVERY_MOVING_MS = 5_000;
export const EVERY_STILL_MS = 60_000;
export const BATCH = 20; // what obdient-tools takes at once
export const MAX_QUEUED = 100; // ~8 min moving; older points are dropped first

export function trackDue(lastAt: number | null, now: number, kmh: number): boolean {
  if (lastAt == null) return true;
  return now - lastAt >= (kmh >= 3 ? EVERY_MOVING_MS : EVERY_STILL_MS);
}

// "obd_" and 8 letters or digits: what Traccar accepts as a device id.
export function newDeviceId(random: () => number = Math.random): string {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let id = 'obd_';
  for (let i = 0; i < 8; i++) id += chars[Math.floor(random() * chars.length)];
  return id;
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
