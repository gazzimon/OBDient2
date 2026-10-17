import { FULL_FRAME } from '@/domain/perception/detection';
import { centreCrop } from '@/domain/perception/inference-plan';
import { fillInput, letterboxFor, modelBoxToFrame, uprightSize, type PixelSource } from '@/domain/perception/tensor';
import { decodeYolo, type DecodeOptions } from '@/domain/perception/yolo-decode';

// 16:9 RGBA frame: left half red, right half blue.
function frame(width = 160, height = 90): PixelSource {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      data[p] = x < width / 2 ? 255 : 0;
      data[p + 2] = x < width / 2 ? 0 : 255;
      data[p + 3] = 255;
    }
  }
  return { data, width, height, bytesPerRow: width * 4, rOffset: 0, gOffset: 1, bOffset: 2, bytesPerPixel: 4 };
}

describe('fillInput (letterbox)', () => {
  it('keeps aspect: a 16:9 frame becomes a band with grey above and below', () => {
    const out = new Uint8Array(32 * 32 * 3);
    const lb = fillInput(frame(), FULL_FRAME, 32, { type: 'uint8' }, out);
    expect(lb.padX).toBeCloseTo(0);
    expect(lb.padY).toBeCloseTo((32 - 18) / 2);
    const px = (x: number, y: number) => Array.from(out.slice((y * 32 + x) * 3, (y * 32 + x) * 3 + 3));
    expect(px(16, 0)).toEqual([114, 114, 114]); // top padding
    expect(px(4, 16)).toEqual([255, 0, 0]); // left half red
    expect(px(28, 16)).toEqual([0, 0, 255]); // right half blue
  });

  it('writes float32 in [0,1] and int8 with the model quantisation', () => {
    const f = new Float32Array(16 * 16 * 3);
    fillInput(frame(), FULL_FRAME, 16, { type: 'float32' }, f);
    expect(f[(8 * 16 + 2) * 3]).toBeCloseTo(1);
    const q = new Int8Array(16 * 16 * 3);
    fillInput(frame(), FULL_FRAME, 16, { type: 'int8', scale: 1 / 255, zeroPoint: -128 }, q);
    expect(q[(8 * 16 + 2) * 3]).toBe(127);
    expect(q[(8 * 16 + 2) * 3 + 1]).toBe(-128);
  });

  it('samples only the virtual-telephoto crop when asked', () => {
    const out = new Uint8Array(16 * 16 * 3);
    // Crop centred on the red/blue boundary.
    fillInput(frame(), centreCrop(0.4, 0.5), 16, { type: 'uint8' }, out);
    const row = 8;
    expect(Array.from(out.slice((row * 16 + 1) * 3, (row * 16 + 1) * 3 + 3))).toEqual([255, 0, 0]);
    expect(Array.from(out.slice((row * 16 + 14) * 3, (row * 16 + 14) * 3 + 3))).toEqual([0, 0, 255]);
  });

  it('reads an upside-down buffer (phone mounted the other way) as upright', () => {
    const out = new Uint8Array(32 * 32 * 3);
    fillInput({ ...frame(), orientation: 'down' }, FULL_FRAME, 32, { type: 'uint8' }, out);
    const px = (x: number, y: number) => Array.from(out.slice((y * 32 + x) * 3, (y * 32 + x) * 3 + 3));
    expect(px(4, 16)).toEqual([0, 0, 255]); // halves swapped
    expect(px(28, 16)).toEqual([255, 0, 0]);
  });

  it('reads a sideways buffer with swapped dimensions', () => {
    // Stored 90×160 (portrait), upright it is the 160×90 frame.
    const src = frame(90, 160);
    expect(uprightSize({ ...src, orientation: 'right' })).toEqual({ width: 160, height: 90 });
    const out = new Uint8Array(32 * 32 * 3);
    const lb = fillInput({ ...src, orientation: 'right' }, FULL_FRAME, 32, { type: 'uint8' }, out);
    expect(lb.padY).toBeCloseTo((32 - 18) / 2); // letterboxed as landscape
  });

  it('maps model boxes back to the full frame, through padding and crop', () => {
    const crop = centreCrop(0.4, 0.5);
    const lb = letterboxFor({ width: 1280, height: 720 }, crop, 320);
    // The whole crop area in model pixels = the crop region in the frame.
    const b = modelBoxToFrame({ x1: lb.padX, y1: lb.padY, x2: 320 - lb.padX, y2: 320 - lb.padY }, lb);
    expect(b.x1).toBeCloseTo(crop.x1);
    expect(b.y2).toBeCloseTo(crop.y2);
  });
});

describe('decodeYolo', () => {
  const lb = letterboxFor({ width: 1280, height: 720 }, FULL_FRAME, 320);

  it('decodes the raw YOLO11 layout and suppresses duplicates with NMS', () => {
    const n = 4;
    const C = 80;
    const out = new Float32Array((4 + C) * n);
    const put = (i: number, cx: number, cy: number, w: number, h: number, cls: number, s: number) => {
      out[i] = cx;
      out[n + i] = cy;
      out[2 * n + i] = w;
      out[3 * n + i] = h;
      out[(4 + cls) * n + i] = s;
    };
    put(0, 160, 160, 40, 30, 2, 0.9); // car
    put(1, 162, 161, 40, 30, 2, 0.7); // same car, lower score
    put(2, 80, 170, 10, 30, 0, 0.6); // person
    put(3, 250, 150, 20, 20, 56, 0.95); // chair: not a road class
    const opts: DecodeOptions = { layout: 'raw', numClasses: C, normalized: false, scoreThreshold: 0.3, iouThreshold: 0.5, maxDetections: 20 };
    const dets = decodeYolo(out, opts, lb);
    expect(dets.map((d) => d.cls).sort()).toEqual(['car', 'person']);
    const car = dets.find((d) => d.cls === 'car')!;
    expect((car.box.x1 + car.box.x2) / 2).toBeCloseTo(0.5, 2);
  });

  it('decodes the end-to-end YOLO26 layout with normalised coordinates', () => {
    const out = new Float32Array([
      0.4, 0.45, 0.6, 0.55, 0.8, 2, // car
      0.1, 0.1, 0.2, 0.2, 0.1, 0, // below threshold
    ]);
    const opts: DecodeOptions = { layout: 'e2e', numClasses: 80, normalized: true, scoreThreshold: 0.3, iouThreshold: 0.5, maxDetections: 20 };
    const dets = decodeYolo(out, opts, lb);
    expect(dets).toHaveLength(1);
    expect(dets[0]!.cls).toBe('car');
    expect(dets[0]!.box.x1).toBeCloseTo(0.4, 2);
  });
});
