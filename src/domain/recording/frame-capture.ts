// When to keep a camera frame for the trip log (teacher models, ADR-0005).
//
// Frames are kept in short bursts rather than evenly: Alpamayo-style models
// want a few frames of history at 10 Hz before the moment they judge, and
// bursts give that for ~2 frames/s of storage (≈1 GB/h at 1280×720 JPEG).
// Runs on the camera thread ('worklet'): plain numbers in, plain numbers out.

export interface CapturePlan {
  readonly burstEveryMs: number;
  readonly burstFrames: number;
  readonly spacingMs: number;
}

export const DEFAULT_CAPTURE: CapturePlan = { burstEveryMs: 2000, burstFrames: 4, spacingMs: 100 };

export interface CaptureState {
  // Start of the current burst, ms (-Infinity before the first).
  burstAt: number;
  // Frames already kept in it.
  taken: number;
  lastAt: number;
}

export function initialCaptureState(): CaptureState {
  'worklet';
  return { burstAt: -Infinity, taken: 0, lastAt: -Infinity };
}

// Returns the burst and the frame's index in it, or null to skip this frame.
// Mutates `s` only when the frame is kept.
export function captureDecision(
  s: CaptureState,
  tMs: number,
  plan: CapturePlan,
): { burst: number; index: number } | null {
  'worklet';
  if (s.taken < plan.burstFrames && tMs - s.burstAt < plan.burstEveryMs) {
    // Inside a burst: the next frame once the spacing has passed.
    if (tMs - s.lastAt < plan.spacingMs) return null;
  } else if (tMs - s.burstAt >= plan.burstEveryMs) {
    s.burstAt = tMs;
    s.taken = 0;
  } else {
    return null; // burst complete, waiting for the next one
  }
  s.lastAt = tMs;
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
