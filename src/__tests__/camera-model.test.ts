import { focalPx, horizonY, project, projectPolyline, type CameraPose, type Intrinsics } from '@/domain/ar/camera-model';

const intr: Intrinsics = { width: 1600, height: 900, hfovDeg: 66 };
const level: CameraPose = { heightM: 1.2, yawDeg: 0, pitchDeg: 0, rollDeg: 0 };

describe('camera model', () => {
  it('puts a far point straight ahead at the image centre column, near the horizon', () => {
    const p = project({ east: 0, north: 1000, up: 1.2 }, level, intr)!;
    expect(p.x).toBeCloseTo(800, 3);
    expect(p.y).toBeCloseTo(450, 3);
  });

  it('puts road points below the horizon, closer ones lower', () => {
    const near = project({ east: 0, north: 10, up: 0 }, level, intr)!;
    const far = project({ east: 0, north: 50, up: 0 }, level, intr)!;
    expect(near.y).toBeGreaterThan(far.y);
    expect(far.y).toBeGreaterThan(450);
    // Pinhole: y offset = f·h/d.
    expect(near.y - 450).toBeCloseTo((focalPx(intr) * 1.2) / 10, 3);
  });

  it('puts points to the right of the heading on the right', () => {
    const p = project({ east: 5, north: 20, up: 0 }, level, intr)!;
    expect(p.x).toBeGreaterThan(800);
  });

  it('follows the yaw: facing east, a point to the east is centred', () => {
    const p = project({ east: 30, north: 0, up: 1.2 }, { ...level, yawDeg: 90 }, intr)!;
    expect(p.x).toBeCloseTo(800, 3);
  });

  it('pitching down moves the horizon up', () => {
    const down = { ...level, pitchDeg: 5 };
    expect(horizonY(down, intr)).toBeLessThan(450);
    const farPoint = project({ east: 0, north: 100_000, up: 1.2 }, down, intr)!;
    expect(farPoint.y).toBeCloseTo(horizonY(down, intr), 0);
  });

  it('positive roll rotates the scene clockwise (right side goes down)', () => {
    const rolled = { ...level, rollDeg: 10 };
    const right = project({ east: 10, north: 100, up: 1.2 }, rolled, intr)!;
    const left = project({ east: -10, north: 100, up: 1.2 }, rolled, intr)!;
    expect(right.y).toBeGreaterThan(left.y);
  });

  it('does not project points behind the camera', () => {
    expect(project({ east: 0, north: -10, up: 0 }, level, intr)).toBeNull();
  });

  it('clips a polyline that starts behind the camera at the near plane', () => {
    const pts = projectPolyline(
      [
        { east: 0, north: -5, up: 0 },
        { east: 0, north: 20, up: 0 },
      ],
      level,
      intr,
    );
    expect(pts).toHaveLength(2);
    expect(pts[0]!.depthM).toBeCloseTo(2, 5);
  });
});
