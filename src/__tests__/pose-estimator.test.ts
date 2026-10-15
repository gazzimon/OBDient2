import { PoseEstimator, cameraAxes, type Vec3 } from '@/domain/fusion/pose-estimator';
import { toRad } from '@/domain/geo/geo';

const G = 9.80665;

// Accelerometer reading ("reads up" convention) for a phone in landscape
// top-left, camera pitched down by `pitch`, rolled by `roll` (degrees),
// with the car accelerating forward at `aLong`.
function reading(pitch: number, roll: number, aLong = 0): Vec3 {
  const axes = cameraAxes('top-left');
  const θ = toRad(pitch);
  const φ = toRad(roll);
  // World up in camera axes (see camera-model.ts): (cosθ sinφ, −cosθ cosφ, −sinθ).
  const cam = { x: Math.cos(θ) * Math.sin(φ), y: -Math.cos(θ) * Math.cos(φ), z: -Math.sin(θ) };
  const up = {
    x: cam.x * axes.right.x + cam.y * axes.down.x + cam.z * axes.forward.x,
    y: cam.x * axes.right.y + cam.y * axes.down.y + cam.z * axes.forward.y,
    z: cam.x * axes.right.z + cam.y * axes.down.z + cam.z * axes.forward.z,
  };
  // Specific force = g·up + vehicle acceleration (forward ≈ optical axis).
  return {
    x: up.x * G + axes.forward.x * aLong,
    y: up.y * G + axes.forward.y * aLong,
    z: up.z * G + axes.forward.z * aLong,
  };
}

function settle(est: PoseEstimator, r: Vec3, aLong = 0) {
  let out = est.update({ accelWithGravity: r, dtS: 0.02 }, { accelLongMps2: aLong, speedMps: 10, yawRateDegS: 0 });
  for (let i = 0; i < 500; i++) {
    out = est.update({ accelWithGravity: r, dtS: 0.02 }, { accelLongMps2: aLong, speedMps: 10, yawRateDegS: 0 });
  }
  return out;
}

describe('PoseEstimator', () => {
  it('recovers pitch and roll from gravity', () => {
    const out = settle(new PoseEstimator(), reading(6, -3));
    expect(out.pitchDeg).toBeCloseTo(6, 1);
    expect(out.rollDeg).toBeCloseTo(-3, 1);
  });

  it('removes braking from the pitch when OBD acceleration is known', () => {
    const braking = reading(4, 0, -3);
    const corrected = settle(new PoseEstimator(), braking, -3);
    expect(corrected.pitchDeg).toBeCloseTo(4, 1);
  });

  it('without the OBD correction, braking shows up as a large pitch error', () => {
    const est = new PoseEstimator();
    let out = est.update({ accelWithGravity: reading(4, 0, -3), dtS: 0.02 }, null);
    for (let i = 0; i < 500; i++) out = est.update({ accelWithGravity: reading(4, 0, -3), dtS: 0.02 }, null);
    expect(Math.abs(out.pitchDeg - 4)).toBeGreaterThan(10);
  });
});
