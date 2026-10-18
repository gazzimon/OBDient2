// Camera frames → detector → perception pipeline (and, optionally, frames
// kept for the trip log: domain/recording/frame-capture).
//
// Returns a VisionCamera frame output to attach to the <Camera>. On the camera
// thread, per frame: pick the region (full frame or virtual telephoto),
// sample it into the model input, run the model synchronously, decode, and
// hand the detections to the JS thread. Frames that arrive while one is being
// processed are dropped by the camera (dropFramesWhileBusy) — never queued, so
// alerts are never about the past.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Asset } from 'expo-asset';
import { useTensorflowModel, type ModelSource, type TensorflowModelDelegate } from 'react-native-fast-tflite';
import { useFrameOutput, type Frame } from 'react-native-vision-camera';
import { createSynchronizable, scheduleOnRN } from 'react-native-worklets';
import { allocateInput, outputToFloat, type DetectorManifest } from '@/data/perception/detector-model';
import { pixelSourceFromFrame } from '@/data/perception/frame-source';
import type { CapturedFrame } from '@/data/recording/trip-recorder';
import { container } from '@/data/container';
import { DEFAULT_CAPTURE, captureDecision, initialCaptureState, packRows } from '@/domain/recording/frame-capture';
import { DEFAULT_PLAN, regionForFrame } from '@/domain/perception/inference-plan';
import { fillInput } from '@/domain/perception/tensor';
import { decodeYolo, type DecodeOptions } from '@/domain/perception/yolo-decode';
import { perception, type FrameResult } from '@/presentation/services/perception-pipeline';
import { usePerceptionStore } from '@/store/perceptionStore';

export type DetectorDelegate = TensorflowModelDelegate | 'cpu';

// 16:9 like the AR preview, enough pixels for the virtual-telephoto crop.
const FRAME_RESOLUTION = { width: 1280, height: 720 };

// `capture`: keep frames for the trip log (only lands while a trip is recorded).
// Bundled models as a file:// URL. fast-tflite resolves require() itself, but
// in a release APK that yields a resource name ("assets_models_…") its loader
// cannot open (MalformedURLException); in development Metro serves http and
// hides the problem. expo-asset copies the file out and gives a real URL.
function useModelFile(source: DetectorManifest['source']): ModelSource | null {
  // Kept as one object: useTensorflowModel reloads whenever the source identity changes.
  const [resolved, setResolved] = useState<{ from: number; source: ModelSource } | null>(null);
  useEffect(() => {
    if (typeof source !== 'number') return;
    let alive = true;
    Asset.fromModule(source)
      .downloadAsync()
      .then((a) => {
        if (alive && a.localUri) setResolved({ from: source, source: { url: a.localUri } });
      })
      .catch((err: unknown) => console.warn('[useDetector] model not resolved:', err));
    return () => {
      alive = false;
    };
  }, [source]);
  if (typeof source !== 'number') return source;
  return resolved?.from === source ? resolved.source : null;
}

// Placeholder while the model file is being resolved: an empty URL fails fast
// and is replaced as soon as the real one arrives.
const PENDING: ModelSource = { url: '' };

export function useDetector(manifest: DetectorManifest, delegate: DetectorDelegate, enabled: boolean, capture = false) {
  const file = useModelFile(manifest.source);
  const plugin = useTensorflowModel(file ?? PENDING, delegate === 'cpu' ? [] : [delegate]);
  const model = plugin.state === 'loaded' ? plugin.model : undefined;
  const frameIndex = useMemo(() => createSynchronizable(0), []);
  const captureState = useMemo(() => createSynchronizable(initialCaptureState()), []);
  const onCapture = container.trips.saveFrame;

  useEffect(() => {
    const store = usePerceptionStore.getState();
    if (!enabled) return;
    if (plugin.state === 'loading' || file == null) store.setStatus('loading');
    else if (plugin.state === 'error') store.setStatus('error', String(plugin.error));
    else if (plugin.state === 'loaded') perception.start(delegate);
    return () => perception.stop();
  }, [enabled, plugin.state, delegate, plugin, file]);

  const decode: DecodeOptions = useMemo(
    () => ({
      layout: manifest.layout,
      numClasses: manifest.numClasses,
      normalized: manifest.normalized,
      scoreThreshold: 0.35,
      iouThreshold: 0.5,
      maxDetections: 30,
    }),
    [manifest],
  );
  const onResult = perception.onFrame;

  const onFrame = useCallback(
    (frame: Frame) => {
      'worklet';
      if ((model == null || !enabled) && !capture) {
        frame.dispose();
        return;
      }
      const t0 = performance.now();
      const src = pixelSourceFromFrame(frame);
      if (src == null) {
        frame.dispose();
        return;
      }

      if (capture) {
        const now = Date.now();
        const cs = captureState.getDirty();
        const keep = captureDecision(cs, now, DEFAULT_CAPTURE);
        if (keep) {
          captureState.setBlocking(cs);
          const shot: CapturedFrame = {
            buffer: packRows(src.data, src.width, src.height, src.bytesPerRow, src.bytesPerPixel),
            width: src.width,
            height: src.height,
            pixelFormat: src.bytesPerPixel === 3 ? 'RGB' : src.rOffset === 2 ? 'BGRA' : 'RGBA',
            orientation: String(src.orientation),
            tMs: now,
            burst: keep.burst,
            index: keep.index,
          };
          scheduleOnRN(onCapture, shot);
        }
      }
      if (model == null || !enabled) {
        frame.dispose();
        return;
      }

      const i = frameIndex.getDirty();
      frameIndex.setBlocking(i + 1);
      const region = regionForFrame(i, DEFAULT_PLAN);
      const input = allocateInput(manifest);
      const lb = fillInput(src, region, manifest.inputSize, manifest.input, input);
      frame.dispose(); // pixels copied into the tensor; free the camera buffer early

      const t1 = performance.now();
      const outputs = model.runSync([input.buffer as ArrayBuffer]);
      const t2 = performance.now();
      const detections = decodeYolo(outputToFloat(outputs[0]!, manifest.output), decode, lb);

      const result: FrameResult = {
        detections,
        tMs: Date.now(),
        inferenceMs: t2 - t1,
        frameMs: performance.now() - t0,
        // By value: on the camera thread FULL_FRAME is a copy, identity never matches.
        crop: region.x1 > 0,
      };
      scheduleOnRN(onResult, result);
    },
    [model, enabled, capture, manifest, decode, frameIndex, captureState, onCapture, onResult],
  );

  const frameOutput = useFrameOutput({
    targetResolution: FRAME_RESOLUTION,
    pixelFormat: 'rgb',
    dropFramesWhileBusy: true,
    onFrame,
  });

  return { frameOutput, modelState: plugin.state };
}
