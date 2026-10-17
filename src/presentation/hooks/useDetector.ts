// Camera frames → detector → perception pipeline.
//
// Returns a VisionCamera frame output to attach to the <Camera>. On the camera
// thread, per frame: pick the region (full frame or virtual telephoto),
// sample it into the model input, run the model synchronously, decode, and
// hand the detections to the JS thread. Frames that arrive while one is being
// processed are dropped by the camera (dropFramesWhileBusy) — never queued, so
// alerts are never about the past.

import { useCallback, useEffect, useMemo } from 'react';
import { useTensorflowModel, type TensorflowModelDelegate } from 'react-native-fast-tflite';
import { useFrameOutput, type Frame } from 'react-native-vision-camera';
import { createSynchronizable, scheduleOnRN } from 'react-native-worklets';
import { allocateInput, outputToFloat, type DetectorManifest } from '@/data/perception/detector-model';
import { pixelSourceFromFrame } from '@/data/perception/frame-source';
import { DEFAULT_PLAN, regionForFrame } from '@/domain/perception/inference-plan';
import { fillInput } from '@/domain/perception/tensor';
import { decodeYolo, type DecodeOptions } from '@/domain/perception/yolo-decode';
import { perception, type FrameResult } from '@/presentation/services/perception-pipeline';
import { usePerceptionStore } from '@/store/perceptionStore';

export type DetectorDelegate = TensorflowModelDelegate | 'cpu';

// 16:9 like the AR preview, enough pixels for the virtual-telephoto crop.
const FRAME_RESOLUTION = { width: 1280, height: 720 };

export function useDetector(manifest: DetectorManifest, delegate: DetectorDelegate, enabled: boolean) {
  const plugin = useTensorflowModel(manifest.source, delegate === 'cpu' ? [] : [delegate]);
  const model = plugin.state === 'loaded' ? plugin.model : undefined;
  const frameIndex = useMemo(() => createSynchronizable(0), []);

  useEffect(() => {
    const store = usePerceptionStore.getState();
    if (!enabled) return;
    if (plugin.state === 'loading') store.setStatus('loading');
    else if (plugin.state === 'error') store.setStatus('error', String(plugin.error));
    else if (plugin.state === 'loaded') perception.start(delegate);
    return () => perception.stop();
  }, [enabled, plugin.state, delegate, plugin]);

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
      if (model == null || !enabled) {
        frame.dispose();
        return;
      }
      const t0 = performance.now();
      const i = frameIndex.getDirty();
      frameIndex.setBlocking(i + 1);
      const region = regionForFrame(i, DEFAULT_PLAN);

      const src = pixelSourceFromFrame(frame);
      if (src == null) {
        frame.dispose();
        return;
      }
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
    [model, enabled, manifest, decode, frameIndex, onResult],
  );

  const frameOutput = useFrameOutput({
    targetResolution: FRAME_RESOLUTION,
    pixelFormat: 'rgb',
    dropFramesWhileBusy: true,
    onFrame,
  });

  return { frameOutput, modelState: plugin.state };
}
