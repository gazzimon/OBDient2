// Camera frame → detector input tensor, without native helpers.
//
// VisionCamera 5 hands the frame processor raw RGB(A) bytes; the resize
// plugin of v4 has no v5 version. This does the three steps the model needs
// in one pass: take a REGION of the frame (full frame or the virtual-telephoto
// crop), LETTERBOX it into a square (keep aspect, pad with grey — how YOLO is
// trained; stretching would distort every object), and write it in the
// model's input type.
//
// The frame arrives in the sensor's native orientation with an orientation
// flag (VisionCamera does not rotate buffers unless told to, and rotating
// costs time). Sampling reads the pixels in the rotated order instead, so the
// model always sees the scene upright and no copy is made.
//
// Nearest-neighbour sampling: at 320×320 the difference with bilinear is far
// below the detector's own noise, and it is ~3× cheaper on the camera thread.
// 'worklet' functions: they run on the camera thread (react-native-worklets).

import type { Region } from './detection';

export interface PixelSource {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly bytesPerRow: number;
  // Byte offsets of R, G, B within a pixel, and bytes per pixel.
  readonly rOffset: number;
  readonly gOffset: number;
  readonly bOffset: number;
  readonly bytesPerPixel: number;
  // How the pixel data is rotated relative to upright (VisionCamera Frame.orientation):
  // 'right' = +90° (clockwise), 'left' = −90°, 'down' = 180°. Default 'up'.
  readonly orientation?: 'up' | 'down' | 'left' | 'right';
}

// Size of the upright image the pixel data represents.
export function uprightSize(src: PixelSource): { width: number; height: number } {
  'worklet';
  const sideways = src.orientation === 'left' || src.orientation === 'right';
  return sideways ? { width: src.height, height: src.width } : { width: src.width, height: src.height };
}

export type InputKind =
  | { readonly type: 'float32' } // [0,1]
  | { readonly type: 'uint8' } // [0,255]
  | { readonly type: 'int8'; readonly scale: number; readonly zeroPoint: number }; // quantised [0,1]

// How the region was placed in the square, to map model boxes back.
export interface Letterbox {
  readonly region: Region;
  readonly size: number;
  readonly scale: number; // model px per source px
  readonly padX: number; // model px
  readonly padY: number;
}

const PAD = 114; // Ultralytics letterbox grey

export function letterboxFor(src: { width: number; height: number }, region: Region, size: number): Letterbox {
  'worklet';
  const rw = (region.x2 - region.x1) * src.width;
  const rh = (region.y2 - region.y1) * src.height;
  const scale = Math.min(size / rw, size / rh);
  return { region, size, scale, padX: (size - rw * scale) / 2, padY: (size - rh * scale) / 2 };
}

// Fills `out` (length size*size*3, HWC, RGB) and returns the letterbox used.
export function fillInput(
  src: PixelSource,
  region: Region,
  size: number,
  kind: InputKind,
  out: Float32Array | Uint8Array | Int8Array,
): Letterbox {
  'worklet';
  const up = uprightSize(src);
  const lb = letterboxFor(up, region, size);
  const x0 = region.x1 * up.width;
  const y0 = region.y1 * up.height;
  const inv = 1 / lb.scale;
  const w = up.width;
  const h = up.height;
  const orient = src.orientation ?? 'up';

  // Value written for a channel byte v in [0,255].
  let mul = 1;
  let add = 0;
  if (kind.type === 'float32') mul = 1 / 255;
  else if (kind.type === 'int8') {
    mul = 1 / (255 * kind.scale);
    add = kind.zeroPoint;
  }
  const padValue =
    kind.type === 'uint8' ? PAD : kind.type === 'float32' ? PAD * mul : clampInt8(Math.round(PAD * mul + add));

  let o = 0;
  for (let y = 0; y < size; y++) {
    const sy = Math.floor(y0 + (y - lb.padY + 0.5) * inv);
    const rowInside = y >= lb.padY && y < size - lb.padY && sy >= 0 && sy < h;
    for (let x = 0; x < size; x++) {
      const sx = Math.floor(x0 + (x - lb.padX + 0.5) * inv);
      if (!rowInside || x < lb.padX || x >= size - lb.padX || sx < 0 || sx >= w) {
        out[o] = padValue;
        out[o + 1] = padValue;
        out[o + 2] = padValue;
      } else {
        // Upright (sx, sy) → position in the stored buffer.
        let bx = sx;
        let by = sy;
        if (orient === 'down') {
          bx = w - 1 - sx;
          by = h - 1 - sy;
        } else if (orient === 'right') {
          bx = h - 1 - sy;
          by = sx;
        } else if (orient === 'left') {
          bx = sy;
          by = w - 1 - sx;
        }
        const p = by * src.bytesPerRow + bx * src.bytesPerPixel;
        const r = src.data[p + src.rOffset]!;
        const g = src.data[p + src.gOffset]!;
        const b = src.data[p + src.bOffset]!;
        if (kind.type === 'uint8') {
          out[o] = r;
          out[o + 1] = g;
          out[o + 2] = b;
        } else if (kind.type === 'float32') {
          out[o] = r * mul;
          out[o + 1] = g * mul;
          out[o + 2] = b * mul;
        } else {
          out[o] = clampInt8(Math.round(r * mul + add));
          out[o + 1] = clampInt8(Math.round(g * mul + add));
          out[o + 2] = clampInt8(Math.round(b * mul + add));
        }
      }
      o += 3;
    }
  }
  return lb;
}

function clampInt8(v: number): number {
  'worklet';
  return v < -128 ? -128 : v > 127 ? 127 : v;
}

// A box in model input pixels → normalised to the full frame.
export function modelBoxToFrame(
  box: { x1: number; y1: number; x2: number; y2: number },
  lb: Letterbox,
): { x1: number; y1: number; x2: number; y2: number } {
  'worklet';
  const rw = lb.region.x2 - lb.region.x1;
  const rh = lb.region.y2 - lb.region.y1;
  const rpxW = lb.size - 2 * lb.padX; // region width in model px
  const rpxH = lb.size - 2 * lb.padY;
  const fx = (v: number) => lb.region.x1 + Math.min(1, Math.max(0, (v - lb.padX) / rpxW)) * rw;
  const fy = (v: number) => lb.region.y1 + Math.min(1, Math.max(0, (v - lb.padY) / rpxH)) * rh;
  return { x1: fx(box.x1), y1: fy(box.y1), x2: fx(box.x2), y2: fy(box.y2) };
}
