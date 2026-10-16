// Trip log: everything needed to replay a drive off the phone.
//
// Raw inputs (GPS fixes, OBD speed, IMU samples) are kept so the fusion and
// the AR projection can be re-run and debugged on a desk; fused outputs (ego
// state, pose, route progress) are kept so a replay can be compared against
// what the driver actually saw. One JSON object per line (JSONL): appendable,
// survives a crash mid-trip, greppable.
//
// Keys are short on purpose — an hour of driving is ~10 MB.

export const TRIP_LOG_VERSION = 1;

export type TripRecord =
  | { k: 'hdr'; v: number; startedAt: string; meta: Record<string, unknown> }
  // GPS fix: position, accuracy, course, speed
  | { k: 'gps'; t: number; lat: number; lng: number; acc: number; crs: number | null; spd: number | null }
  | { k: 'obd'; t: number; kmh: number }
  // IMU sample: accelerometer incl. gravity (m/s²) and gyro (deg/s), device axes
  | { k: 'imu'; t: number; a: [number, number, number]; g: [number, number, number] }
  // Fused state: ego + camera pose
  | {
      k: 'st';
      t: number;
      lat: number;
      lng: number;
      hdg: number;
      hv: boolean;
      spd: number;
      src: string;
      al: number;
      yr: number;
      p: number | null;
      r: number | null;
    }
  // Route progress
  | { k: 'nav'; t: number; off: number; xt: number; rem: number; offRoute: boolean }
  // Discrete events: voice prompts, reroutes, arrival, adapter resets…
  | { k: 'ev'; t: number; name: string; data?: Record<string, unknown> };

export type TripRecordKind = TripRecord['k'];

// Minimum spacing per kind, ms. Raw inputs are kept at their native rate;
// fused outputs at the UI rate.
const MIN_INTERVAL_MS: Partial<Record<TripRecordKind, number>> = {
  st: 100,
  nav: 100,
};

export class TripLogBuffer {
  private lines: string[] = [];
  private lastAt = new Map<TripRecordKind, number>();

  // Returns false when the record was dropped by rate limiting.
  push(record: TripRecord): boolean {
    const min = MIN_INTERVAL_MS[record.k];
    if (min != null && 't' in record) {
      const last = this.lastAt.get(record.k);
      if (last != null && record.t - last < min) return false;
      this.lastAt.set(record.k, record.t);
    }
    this.lines.push(JSON.stringify(round(record)));
    return true;
  }

  get pending(): number {
    return this.lines.length;
  }

  // Everything buffered, as JSONL text ready to append; empties the buffer.
  drain(): string {
    if (!this.lines.length) return '';
    const text = `${this.lines.join('\n')}\n`;
    this.lines = [];
    return text;
  }
}

export function parseTripLog(text: string): TripRecord[] {
  const out: TripRecord[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as TripRecord);
    } catch {
      // A crash can leave half a line at the end; skip it.
    }
  }
  return out;
}

// 7 decimals of a degree ≈ 1 cm; 3 decimals for everything else.
function round(record: TripRecord): TripRecord {
  return JSON.parse(
    JSON.stringify(record, (key, value: unknown) => {
      if (typeof value !== 'number' || Number.isInteger(value)) return value;
      const places = key === 'lat' || key === 'lng' ? 7 : 3;
      return Number(value.toFixed(places));
    }),
  ) as TripRecord;
}
