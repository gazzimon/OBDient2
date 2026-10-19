// Detector output tensor → detections in full-frame coordinates.
//
// Two layouts, both from Ultralytics TFLite exports:
//   'raw'  YOLOv8/11: [1, 4 + C, N] channels-first, (cx, cy, w, h, class scores…),
//          needs NMS.
//   'e2e'  YOLO26 / end-to-end: [1, K, 6] (x1, y1, x2, y2, score, class), NMS-free.
// Coordinates come in model pixels or normalised to the input ([0,1]) depending
// on the export; `normalized` says which (read once from the model, see
// detector-model.ts) and everything is mapped to model pixels first.
// 'worklet': runs on the camera thread right after inference.

import { cocoClass, type Detection } from './detection';
import { modelBoxToFrame, type Letterbox } from './tensor';

export type OutputLayout = 'raw' | 'e2e';

export interface DecodeOptions {
  readonly layout: OutputLayout;
  readonly numClasses: number; // 80 for COCO
  readonly normalized: boolean;
  readonly scoreThreshold: number;
  readonly iouThreshold: number; // NMS, 'raw' only
  readonly maxDetections: number;
}

interface Candidate {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  score: number;
  cls: number;
}

function boxIou(a: Candidate, b: Candidate): number {
  'worklet';
  const ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const inter = ix * iy;
  const u = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
  return u <= 0 ? 0 : inter / u;
}

// Helpers first: on the camera thread worklets are not hoisted.
// Per-class greedy NMS.
export function nms(cands: Candidate[], iouThreshold: number, max: number): Candidate[] {
  'worklet';
  const sorted = cands.slice().sort((a, b) => b.score - a.score);
  const kept: Candidate[] = [];
  for (const c of sorted) {
    let suppressed = false;
    for (const k of kept) {
      if (k.cls === c.cls && boxIou(k, c) > iouThreshold) {
        suppressed = true;
        break;
      }
    }
    if (!suppressed) {
      kept.push(c);
      if (kept.length >= max) break;
    }
  }
  return kept;
}

function top(cands: Candidate[], max: number): Candidate[] {
  'worklet';
  return cands.slice().sort((a, b) => b.score - a.score).slice(0, max);
}

export function decodeYolo(out: Float32Array, opts: DecodeOptions, lb: Letterbox): Detection[] {
  'worklet';
  const k = opts.normalized ? lb.size : 1;
  const cands: Candidate[] = [];

  if (opts.layout === 'e2e') {
    const n = Math.floor(out.length / 6);
    for (let i = 0; i < n; i++) {
      const score = out[i * 6 + 4]!;
      if (score < opts.scoreThreshold) continue;
      cands.push({
        x1: out[i * 6]! * k,
        y1: out[i * 6 + 1]! * k,
        x2: out[i * 6 + 2]! * k,
        y2: out[i * 6 + 3]! * k,
        score,
        cls: Math.round(out[i * 6 + 5]!),
      });
    }
  } else {
    const rows = 4 + opts.numClasses;
    const n = Math.floor(out.length / rows);
    for (let i = 0; i < n; i++) {
      let best = 0;
      let cls = -1;
      for (let c = 0; c < opts.numClasses; c++) {
        const s = out[(4 + c) * n + i]!;
        if (s > best) {
          best = s;
          cls = c;
        }
      }
      if (best < opts.scoreThreshold) continue;
      // Only classes the driver cares about; skip the rest before NMS.
      if (cocoClass(cls) == null) continue;
      const cx = out[i]! * k;
      const cy = out[n + i]! * k;
      const w = out[2 * n + i]! * k;
      const h = out[3 * n + i]! * k;
      cands.push({ x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2, score: best, cls });
    }
  }

  const kept = opts.layout === 'raw' ? nms(cands, opts.iouThreshold, opts.maxDetections) : top(cands, opts.maxDetections);
  const dets: Detection[] = [];
  for (const c of kept) {
    const cls = cocoClass(c.cls);
    if (cls == null) continue;
    dets.push({ cls, score: c.score, box: modelBoxToFrame(c, lb) });
  }
  return dets;
}
