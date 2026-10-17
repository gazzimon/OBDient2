import { project, type CameraPose, type Intrinsics } from '@/domain/ar/camera-model';
import { AlertEngine } from '@/domain/perception/alerts';
import { mergeDetections, regionToFrame, type Box, type Detection, type ObjectClass } from '@/domain/perception/detection';
import { estimateDistance, pixelToGround } from '@/domain/perception/ground';
import { DEFAULT_PLAN, regionForFrame } from '@/domain/perception/inference-plan';
import { buildScene } from '@/domain/perception/scene';
import { Tracker } from '@/domain/perception/tracker';
import { scaleTtc } from '@/domain/perception/ttc';

const intr: Intrinsics = { width: 1280, height: 720, hfovDeg: 66 };
const pose: CameraPose = { heightM: 1.2, yawDeg: 0, pitchDeg: 3, rollDeg: 0 };
const camera = { pose, intr, yawOffsetDeg: 0 };

// The box the camera would see for an object `forwardM` ahead, `rightM` to
// the right, of the given size — produced with the AR's own projection.
function boxFor(forwardM: number, rightM = 0, w = 1.8, h = 1.5): Box {
  const pts = [
    { east: rightM - w / 2, north: forwardM, up: 0 },
    { east: rightM + w / 2, north: forwardM, up: 0 },
    { east: rightM - w / 2, north: forwardM, up: h },
    { east: rightM + w / 2, north: forwardM, up: h },
  ].map((p) => project(p, pose, intr)!);
  const xs = pts.map((p) => p.x / intr.width);
  const ys = pts.map((p) => p.y / intr.height);
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
}

const det = (box: Box, cls: ObjectClass = 'car', score = 0.9): Detection => ({ cls, score, box });

describe('ground geometry', () => {
  it('inverts the AR projection: pixel → metres on the road', () => {
    for (const [f, r] of [
      [10, 0],
      [25, -2],
      [40, 3],
    ] as const) {
      const p = project({ east: r, north: f, up: 0 }, { ...pose, rollDeg: 2 }, intr)!;
      const g = pixelToGround(p, { ...pose, rollDeg: 2 }, intr)!;
      expect(g.forwardM).toBeCloseTo(f, 1);
      expect(g.rightM).toBeCloseTo(r, 1);
    }
  });

  it('returns null above the horizon', () => {
    expect(pixelToGround({ x: 640, y: 50 }, pose, intr)).toBeNull();
  });

  it('measures a car from its bottom edge, and falls back to its size when cut off', () => {
    const d = estimateDistance(boxFor(20), 'car', pose, intr)!;
    expect(d.source).toBe('ground');
    expect(d.forwardM).toBeCloseTo(20, 0);

    const cut: Box = { ...boxFor(4), y2: 1 };
    const s = estimateDistance(cut, 'car', pose, intr)!;
    expect(s.source).toBe('size');
  });
});

describe('virtual telephoto', () => {
  it('maps a crop detection back to the full frame', () => {
    const b = regionToFrame({ x1: 0.5, y1: 0.5, x2: 1, y2: 1 }, { x1: 0.3, y1: 0.25, x2: 0.7, y2: 0.65 });
    expect(b.x1).toBeCloseTo(0.5);
    expect(b.y1).toBeCloseTo(0.45);
    expect(b.x2).toBeCloseTo(0.7);
    expect(b.y2).toBeCloseTo(0.65);
  });

  it('runs the crop pass every third frame', () => {
    const crops = [0, 1, 2, 3, 4, 5].map((i) => regionForFrame(i, DEFAULT_PLAN).x1 > 0);
    expect(crops).toEqual([false, false, true, false, false, true]);
  });

  it('merges the same object seen in the full frame and in the crop', () => {
    const a = det(boxFor(50), 'car', 0.6);
    const b = det(boxFor(50), 'car', 0.85);
    const merged = mergeDetections([a, b, det(boxFor(10, 3), 'person')]);
    expect(merged).toHaveLength(2);
    expect(merged.find((m) => m.cls === 'car')!.score).toBe(0.85);
  });
});

describe('Tracker', () => {
  it('keeps identity across frames and through car/truck flicker', () => {
    const tr = new Tracker();
    let id = 0;
    for (let i = 0; i < 6; i++) {
      const cls: ObjectClass = i === 3 ? 'truck' : 'car';
      const out = tr.update([det(boxFor(30 - i * 0.5), cls)], i * 50);
      if (i >= 2) {
        expect(out).toHaveLength(1);
        id ||= out[0]!.id;
        expect(out[0]!.id).toBe(id);
      }
    }
  });

  it('drops a track after it disappears for a while', () => {
    const tr = new Tracker();
    for (let i = 0; i < 3; i++) tr.update([det(boxFor(20))], i * 50);
    expect(tr.update([], 400)).toHaveLength(1);
    expect(tr.update([], 1000)).toHaveLength(0);
  });
});

describe('scale TTC', () => {
  it('recovers time-to-contact from box growth alone', () => {
    // 10 m/s closing from 30 m: at t = 0.8 s the car is at 22 m → TTC 2.2 s.
    const history = [];
    for (let t = 0; t <= 800; t += 50) history.push({ t, box: boxFor(30 - (t / 1000) * 10) });
    const e = scaleTtc(history, 800)!;
    expect(e.ttcS).toBeGreaterThan(1.9);
    expect(e.ttcS).toBeLessThan(2.5);
  });

  it('says "not closing" for a car keeping its distance', () => {
    const history = [];
    for (let t = 0; t <= 800; t += 50) history.push({ t, box: boxFor(20) });
    expect(scaleTtc(history, 800)!.ttcS).toBe(Infinity);
  });
});

// Drives a scenario through tracker → scene → alerts.
function run(
  frames: number,
  stepMs: number,
  objects: (t: number) => Detection[],
  egoSpeed: (t: number) => number,
): { t: number; kind: string; level: string; message: string }[] {
  const tracker = new Tracker();
  const engine = new AlertEngine();
  const out: { t: number; kind: string; level: string; message: string }[] = [];
  for (let i = 0; i < frames; i++) {
    const t = i * stepMs;
    const scene = buildScene(tracker.update(objects(t), t), t, camera);
    for (const a of engine.update(scene, egoSpeed(t), t)) out.push({ t, ...a });
  }
  return out;
}

describe('AlertEngine', () => {
  it('escalates a forward collision warning to critical as the gap closes', () => {
    // Ego at 15 m/s, lead stopped 45 m ahead.
    // 2.5 s of it: ends 7.5 m short, before the simulated cars would overlap.
    const alerts = run(50, 50, (t) => [det(boxFor(45 - (t / 1000) * 15))], () => 15);
    const fcw = alerts.filter((a) => a.kind === 'fcw');
    expect(fcw.map((a) => a.level)).toEqual(['warning', 'critical']);
    expect(fcw[1]!.message).toBe('¡Frena!');
    expect(fcw[0]!.t).toBeLessThan(fcw[1]!.t);
  });

  it('stays quiet behind a car driving at the same speed', () => {
    expect(run(80, 50, () => [det(boxFor(25))], () => 15)).toEqual([]);
  });

  it('warns about tailgating only when sustained', () => {
    // 12 m behind at 20 m/s = 0.6 s headway.
    const alerts = run(60, 50, () => [det(boxFor(12))], () => 20);
    const hw = alerts.filter((a) => a.kind === 'headway');
    expect(hw).toHaveLength(1);
    expect(hw[0]!.t).toBeGreaterThanOrEqual(2000);
  });

  it('tells the driver when the car ahead pulls away at a light', () => {
    // Stopped 6 m behind; after 3 s the lead accelerates at 2 m/s².
    const lead = (t: number) => {
      const s = Math.max(0, t - 3000) / 1000;
      return [det(boxFor(6 + s * s))];
    };
    const alerts = run(110, 50, lead, () => 0);
    expect(alerts.map((a) => a.kind)).toEqual(['lead-departed']);
    expect(alerts[0]!.message).toBe('El de adelante arrancó');
  });

  it('flags a pedestrian in the path but not one on the sidewalk', () => {
    const ped = (rightM: number) => () => [det(boxFor(15, rightM, 0.5, 1.7), 'person')];
    expect(run(20, 50, ped(0.3), () => 8).map((a) => a.message)).toEqual(['Peatón adelante']);
    expect(run(20, 50, ped(4.5), () => 8)).toEqual([]);
  });
});
