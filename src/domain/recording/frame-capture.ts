// When to keep a camera frame for the trip log (teacher models, ADR-0005).
//
// Frames are kept in short bursts rather than evenly, shaped for the models
// they feed: each burst ends with the history both planners want before the
// moment they judge (its last frame) —
//   Qwen-Drive: 4 frames at 2 Hz  → offsets 0, 0.5, 1.0, 1.5 s
//   Alpamayo:   4 frames at 10 Hz → offsets 1.2, 1.3, 1.4, 1.5 s
// 7 frames every 2 s (≈1.7 GB/h at 1280×720 JPEG).
// Runs on the camera thread ('worklet'): plain numbers in, plain numbers out.

export interface CapturePlan {
  readonly burstEveryMs: number;
  // Offsets from the burst start, ascending; the first must be 0.
  readonly offsetsMs: readonly number[];
}

export const DEFAULT_CAPTURE: CapturePlan = {
  burstEveryMs: 2000,
  offsetsMs: [0, 500, 1000, 1200, 1300, 1400, 1500],
};

export interface CaptureState {
  // Start of the current burst, ms (-Infinity before the first).
  burstAt: number;
  // Frames already kept in it.
  taken: number;
}

export function initialCaptureState(): CaptureState {
  'worklet';
  return { burstAt: -Infinity, taken: 0 };
}

// Returns the burst and the frame's index in it, or null to skip this frame.
// Each offset takes the first frame at or after it. Mutates `s` only when the
// frame is kept.
export function captureDecision(
  s: CaptureState,
  tMs: number,
  plan: CapturePlan,
): { burst: number; index: number } | null {
  'worklet';
  if (tMs - s.burstAt >= plan.burstEveryMs) {
    s.burstAt = tMs;
    s.taken = 0;
  } else if (s.taken >= plan.offsetsMs.length || tMs - s.burstAt < plan.offsetsMs[s.taken]!) {
    return null;
  }
  s.taken += 1;
  return { burst: s.burstAt, index: s.taken - 1 };
}

// Copies a frame's pixels into a tightly packed buffer (rows may be padded),
// so the JPEG encoder can read it after the camera buffer is released.
export function packRows(
  src: Uint8Array,
  width: number,
  height: number,
  bytesPerRow: number,
  bytesPerPixel: number,
): ArrayBuffer {
  'worklet';
  const row = width * bytesPerPixel;
  if (bytesPerRow === row) return src.slice(0, row * height).buffer as ArrayBuffer;
  const out = new Uint8Array(row * height);
  for (let y = 0; y < height; y++) out.set(src.subarray(y * bytesPerRow, y * bytesPerRow + row), y * row);
  return out.buffer as ArrayBuffer;
}
