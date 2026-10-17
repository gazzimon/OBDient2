// What the detector reports, in a model-independent shape.
//
// Boxes are normalised to the FULL camera frame ([0,1] × [0,1], origin top
// left), whatever the model saw: a centre crop analysed at full resolution —
// the "virtual telephoto" (see inference-plan.ts) — is mapped back here, so
// tracking and geometry never care how a box was found.

export type ObjectClass =
  | 'car'
  | 'truck'
  | 'bus'
  | 'motorcycle'
  | 'bicycle'
  | 'person'
  | 'animal'
  | 'traffic_light'
  | 'stop_sign';

export interface Box {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface Detection {
  readonly cls: ObjectClass;
  readonly score: number;
  readonly box: Box;
}

export const VEHICLES: ReadonlySet<ObjectClass> = new Set(['car', 'truck', 'bus', 'motorcycle']);
// Vulnerable road users.
export const VRUS: ReadonlySet<ObjectClass> = new Set(['person', 'bicycle', 'motorcycle', 'animal']);

// COCO-80 class index → ours. Everything else is ignored.
const COCO: Readonly<Record<number, ObjectClass>> = {
  0: 'person',
  1: 'bicycle',
  2: 'car',
  3: 'motorcycle',
  5: 'bus',
  7: 'truck',
  9: 'traffic_light',
  11: 'stop_sign',
  15: 'animal', // cat
  16: 'animal', // dog
  17: 'animal', // horse
  18: 'animal', // sheep
  19: 'animal', // cow
};

export function cocoClass(index: number): ObjectClass | null {
  return COCO[index] ?? null;
}

// A region of the full frame, normalised like boxes.
export type Region = Box;

export const FULL_FRAME: Region = { x1: 0, y1: 0, x2: 1, y2: 1 };

// A box found inside `region` (normalised to the region) → full-frame coords.
export function regionToFrame(box: Box, region: Region): Box {
  const w = region.x2 - region.x1;
  const h = region.y2 - region.y1;
  return {
    x1: region.x1 + box.x1 * w,
    y1: region.y1 + box.y1 * h,
    x2: region.x1 + box.x2 * w,
    y2: region.y1 + box.y2 * h,
  };
}

export function iou(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const inter = ix * iy;
  const union = area(a) + area(b) - inter;
  return union <= 0 ? 0 : inter / union;
}

export function area(b: Box): number {
  return Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
}

// Merges detections from overlapping passes (full frame + crop): same class
// and IoU above `threshold` → keep the higher score. Order-independent.
export function mergeDetections(dets: readonly Detection[], threshold = 0.5): Detection[] {
  const sorted = [...dets].sort((a, b) => b.score - a.score);
  const kept: Detection[] = [];
  for (const d of sorted) {
    if (!kept.some((k) => k.cls === d.cls && iou(k.box, d.box) > threshold)) kept.push(d);
  }
  return kept;
}
