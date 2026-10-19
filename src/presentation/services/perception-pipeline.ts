// JS side of the detector: camera-thread results → tracking → scene → alerts.
//
// The camera thread only samples, infers and decodes; everything with state
// (tracks, cooldowns) lives here, on the JS thread, where it is plain
// testable domain code. Alerts are spoken and buzzed; the scene is published
// for the AR overlay.

import * as Haptics from 'expo-haptics';
import { container } from '@/data/container';
import { AlertEngine, type DriverAlert } from '@/domain/perception/alerts';
import type { Detection } from '@/domain/perception/detection';
import { buildScene } from '@/domain/perception/scene';
import { Tracker } from '@/domain/perception/tracker';
import { useEgoStore } from '@/store/egoStore';
import { usePerceptionStore } from '@/store/perceptionStore';
import { useSettingsStore } from '@/store/settingsStore';
import { voice } from './voice';

export interface FrameResult {
  readonly detections: Detection[];
  readonly tMs: number;
  readonly inferenceMs: number;
  readonly frameMs: number;
  readonly crop: boolean;
  // Diagnostics, every 30th frame.
  readonly probe?: string | undefined;
}

const STATS_WINDOW = 30;
const PUBLISH_MS = 66;

class PerceptionPipeline {
  private tracker = new Tracker();
  private alerts = new AlertEngine();
  private inference: number[] = [];
  private frame: number[] = [];
  private times: number[] = [];
  private lastPublish = 0;
  private delegate = 'cpu';

  start(delegate: string): void {
    this.tracker = new Tracker();
    this.alerts = new AlertEngine();
    this.inference = [];
    this.frame = [];
    this.times = [];
    this.delegate = delegate;
    usePerceptionStore.getState().setStatus('running');
  }

  stop(): void {
    usePerceptionStore.getState().reset();
  }

  // Called (via scheduleOnRN) for every processed frame.
  onFrame = (r: FrameResult): void => {
    const now = r.tMs;
    this.push(this.inference, r.inferenceMs);
    this.push(this.frame, r.frameMs);
    this.push(this.times, now);

    if (r.probe && __DEV__) {
      console.log(`[detector] ${r.probe} · ${r.inferenceMs.toFixed(0)}/${r.frameMs.toFixed(0)} ms · ${this.delegate}`);
    }
    const tracks = this.tracker.update(r.detections, now);
    const camera = this.camera();
    const scene = buildScene(tracks, now, camera);
    const ego = useEgoStore.getState().ego;
    for (const a of this.alerts.update(scene, ego?.speedMps ?? 0, now)) this.raise(a, now);

    if (now - this.lastPublish < PUBLISH_MS) return;
    this.lastPublish = now;
    const span = this.times.length > 1 ? (this.times[this.times.length - 1]! - this.times[0]!) / 1000 : 0;
    usePerceptionStore.getState().publish(scene.objects, scene.lead?.trackId ?? null, {
      inferenceMs: median(this.inference),
      frameMs: median(this.frame),
      fps: span > 0 ? (this.times.length - 1) / span : 0,
      delegate: this.delegate,
    }, now);
  };

  // Pose and intrinsics for metric distance: the same ones the AR uses.
  private camera() {
    const pose = useEgoStore.getState().pose;
    const cal = useSettingsStore.getState().calibration;
    if (!pose) return null;
    // Distances are computed in a unit frame: only the aspect and FOV matter.
    return {
      pose: {
        heightM: cal.cameraHeightM,
        pitchDeg: pose.pitchDeg + cal.pitchOffsetDeg,
        rollDeg: pose.rollDeg + cal.rollOffsetDeg,
      },
      intr: { width: 1600, height: 900, hfovDeg: cal.hfovDeg },
      yawOffsetDeg: cal.yawOffsetDeg,
    };
  }

  private raise(a: DriverAlert, now: number): void {
    usePerceptionStore.getState().setAlert(a, now);
    container.trips.event('alert', { kind: a.kind, level: a.level, trackId: a.trackId });
    if (a.level === 'critical') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    else if (a.level === 'warning') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    // The arbiter decides: a critical alert cuts guidance, the others wait.
    voice.say(a.message, a.level === 'critical' ? 'critical' : 'alert');
  }

  private push(arr: number[], v: number): void {
    arr.push(v);
    if (arr.length > STATS_WINDOW) arr.shift();
  }
}

function median(arr: readonly number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

export const perception = new PerceptionPipeline();
