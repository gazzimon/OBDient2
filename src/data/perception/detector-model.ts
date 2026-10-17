// Detector models the app can run, described by a manifest.
//
// fast-tflite reports tensor shapes and types but not quantisation
// parameters, so each model ships with what the export printed (see
// server/ml/export-detector.sh). Swapping models — including the student the
// Z440 teacher produces (ADR-0005) — is a new entry here, not new code.

import type { InputKind } from '@/domain/perception/tensor';
import type { OutputLayout } from '@/domain/perception/yolo-decode';

export type OutputKind =
  | { readonly type: 'float32' }
  | { readonly type: 'int8'; readonly scale: number; readonly zeroPoint: number };

export interface DetectorManifest {
  readonly id: string;
  readonly label: string;
  // require('…tflite') or a file:// URL (models downloaded later, OTA).
  readonly source: number | { url: string };
  readonly inputSize: number;
  readonly input: InputKind;
  readonly output: OutputKind;
  readonly layout: OutputLayout;
  readonly normalized: boolean;
  readonly numClasses: number;
}

// Model output (as delivered) → float32 for the decoder. Runs on the camera thread.
export function outputToFloat(buffer: ArrayBuffer, kind: OutputKind): Float32Array {
  'worklet';
  if (kind.type === 'float32') return new Float32Array(buffer);
  const q = new Int8Array(buffer);
  const out = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) out[i] = (q[i]! - kind.zeroPoint) * kind.scale;
  return out;
}

// A typed buffer of the right kind for the model input. Runs on the camera thread.
export function allocateInput(m: Pick<DetectorManifest, 'inputSize' | 'input'>): Float32Array | Uint8Array | Int8Array {
  'worklet';
  const n = m.inputSize * m.inputSize * 3;
  if (m.input.type === 'float32') return new Float32Array(n);
  if (m.input.type === 'uint8') return new Uint8Array(n);
  return new Int8Array(n);
}

// Shipped models. Values from server/ml/export-detector.sh + probe_tflite.py
// (2026-10-17, Ultralytics 8.4.82): both take float32 [0,1] 320×320 RGB and
// return raw YOLO11 output [1, 84, 2100], coordinates normalised to the input.
// The INT8 one is INT8 inside (2.9 MB; NNAPI/CPU), FP16 suits the GPU delegate.
export const DETECTOR_MODELS: readonly DetectorManifest[] = [
  {
    id: 'yolo11n-fp16',
    label: 'YOLO11n FP16 · 320',
    // Assets are bundled through require() in React Native.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    source: require('../../../assets/models/yolo11n-fp16-320.tflite'),
    inputSize: 320,
    input: { type: 'float32' },
    output: { type: 'float32' },
    layout: 'raw',
    normalized: true,
    numClasses: 80,
  },
  {
    id: 'yolo11n-int8',
    label: 'YOLO11n INT8 · 320',
    // Assets are bundled through require() in React Native.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    source: require('../../../assets/models/yolo11n-int8-320.tflite'),
    inputSize: 320,
    input: { type: 'float32' },
    output: { type: 'float32' },
    layout: 'raw',
    normalized: true,
    numClasses: 80,
  },
];

export function detectorModel(id: string): DetectorManifest {
  return DETECTOR_MODELS.find((m) => m.id === id) ?? DETECTOR_MODELS[0]!;
}
