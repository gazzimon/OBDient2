// Gives detections an identity over time, so distance, closing speed and
// time-to-collision are measured on the same object frame after frame.
//
// Greedy IoU matching within compatible classes (a "car" that the detector
// calls "truck" on the next frame is still the same object). Time-based
// expiry, not frame-based: the frame rate varies with the device tier and the
// crop passes.

import { VEHICLES, iou, type Box, type Detection, type ObjectClass } from './detection';

export interface TrackSample {
  readonly t: number;
  readonly box: Box;
}

export interface Track {
  readonly id: number;
  cls: ObjectClass;
  score: number;
  box: Box; // smoothed
  hits: number;
  lastSeen: number;
  history: TrackSample[]; // raw boxes, last HISTORY_MS
}

export interface TrackerOptions {
  readonly minIou: number;
  readonly confirmHits: number;
  readonly maxAgeMs: number;
  readonly historyMs: number;
  readonly smoothing: number; // 0..1, weight of the new box
}

export const DEFAULT_TRACKER: TrackerOptions = {
  minIou: 0.25,
  confirmHits: 3,
  maxAgeMs: 600,
  historyMs: 2500,
  smoothing: 0.6,
};

export class Tracker {
  private tracks: Track[] = [];
  private nextId = 1;

  constructor(private readonly opts: TrackerOptions = DEFAULT_TRACKER) {}

  update(dets: readonly Detection[], t: number): Track[] {
    this.tracks = this.tracks.filter((tr) => t - tr.lastSeen <= this.opts.maxAgeMs);

    // All candidate pairs, best IoU first.
    const pairs: { ti: number; di: number; v: number }[] = [];
    this.tracks.forEach((tr, ti) =>
      dets.forEach((d, di) => {
        if (!compatible(tr.cls, d.cls)) return;
        const v = iou(tr.box, d.box);
        if (v >= this.opts.minIou) pairs.push({ ti, di, v });
      }),
    );
    pairs.sort((a, b) => b.v - a.v);

    const usedT = new Set<number>();
    const usedD = new Set<number>();
    for (const { ti, di } of pairs) {
      if (usedT.has(ti) || usedD.has(di)) continue;
      usedT.add(ti);
      usedD.add(di);
      this.observe(this.tracks[ti]!, dets[di]!, t);
    }

    dets.forEach((d, di) => {
      if (usedD.has(di)) return;
      this.tracks.push({
        id: this.nextId++,
        cls: d.cls,
        score: d.score,
        box: d.box,
        hits: 1,
        lastSeen: t,
        history: [{ t, box: d.box }],
      });
    });
    return this.confirmed();
  }

  confirmed(): Track[] {
    return this.tracks.filter((tr) => tr.hits >= this.opts.confirmHits);
  }

  private observe(tr: Track, d: Detection, t: number): void {
    const a = this.opts.smoothing;
    tr.box = {
      x1: tr.box.x1 + a * (d.box.x1 - tr.box.x1),
      y1: tr.box.y1 + a * (d.box.y1 - tr.box.y1),
      x2: tr.box.x2 + a * (d.box.x2 - tr.box.x2),
      y2: tr.box.y2 + a * (d.box.y2 - tr.box.y2),
    };
    tr.score = Math.max(d.score, tr.score * 0.9);
    // Vehicle class flicker: keep the class seen most recently with good confidence.
    if (d.score > 0.5) tr.cls = d.cls;
    tr.hits++;
    tr.lastSeen = t;
    tr.history.push({ t, box: d.box });
    while (tr.history.length && t - tr.history[0]!.t > this.opts.historyMs) tr.history.shift();
  }
}

function compatible(a: ObjectClass, b: ObjectClass): boolean {
  return a === b || (VEHICLES.has(a) && VEHICLES.has(b));
}
