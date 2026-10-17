// Time-to-collision from how fast an object grows in the image.
//
// An object's image scale s is inversely proportional to its distance, so
// u = 1/s is proportional to distance — and at constant closing speed u falls
// LINEARLY with time. Fit u = a + b·t over the last fraction of a second and
// evaluate at the newest sample: TTC = u(now) / −b. No calibration and no
// distance needed — it works even when the mount or the field of view are
// off, which is why it is the primary trigger for the collision warning.
//
// (Fitting ln(s) instead is the textbook shortcut, but ln(s) is curved in
// time; its average slope belongs to the middle of the window and makes the
// TTC ~half a window late — 0.4 s at 0.8 s, too late for a braking alert.)

import type { TrackSample } from './tracker';

export interface TtcEstimate {
  // Seconds until contact at the current closing rate; Infinity when not closing.
  readonly ttcS: number;
  // Relative scale growth rate, 1/s (positive = approaching).
  readonly rate: number;
  readonly samples: number;
}

export interface TtcOptions {
  readonly windowMs: number;
  readonly minSamples: number;
  readonly minSpanMs: number;
  // Below this growth rate the object is "not closing" (noise floor).
  readonly minRate: number;
}

export const DEFAULT_TTC: TtcOptions = { windowMs: 800, minSamples: 4, minSpanMs: 300, minRate: 0.02 };

export function scaleTtc(history: readonly TrackSample[], now: number, opts: TtcOptions = DEFAULT_TTC): TtcEstimate | null {
  const pts = history.filter((s) => now - s.t <= opts.windowMs);
  if (pts.length < opts.minSamples) return null;
  const span = pts[pts.length - 1]!.t - pts[0]!.t;
  if (span < opts.minSpanMs) return null;

  // Least squares of u = 1/scale on time (seconds). Scale = sqrt(area): both
  // dimensions, less sensitive to a box that grows only vertically when the
  // car pitches.
  const t0 = pts[0]!.t;
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const p of pts) {
    const w = p.box.x2 - p.box.x1;
    const h = p.box.y2 - p.box.y1;
    if (w <= 0 || h <= 0) continue;
    const x = (p.t - t0) / 1000;
    const y = 1 / Math.sqrt(w * h);
    n++;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const den = n * sxx - sx * sx;
  if (n < opts.minSamples || den <= 0) return null;
  const b = (n * sxy - sx * sy) / den;
  const a = (sy - b * sx) / n;
  const uNow = a + b * ((pts[pts.length - 1]!.t - t0) / 1000);
  if (uNow <= 0) return null;
  // Relative closing rate at this instant, 1/s (positive = approaching).
  const rate = -b / uNow;
  return { ttcS: rate > opts.minRate ? 1 / rate : Infinity, rate, samples: n };
}
