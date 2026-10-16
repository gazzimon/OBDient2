// Is the accelerometer reporting "up" (Android convention) or gravity itself?
//
// Getting it wrong is subtle: the landscape side is inferred from the same
// sensor, so an inverted sign also flips the side, and the two errors cancel
// everywhere except the pitch, which comes out mirrored — 4° down reads as 4°
// up, and the AR horizon moves the wrong way. No threshold on the resting
// pose can see that.
//
// Physics can. When the car speeds up, the specific force along the camera's
// optical axis (device −z, whichever way the phone is mounted) rises by the
// car's acceleration. Regress that axis (minus its resting value) on the
// acceleration derived from OBD/GPS speed, through the origin: slope ≈ +1 →
// the sensor reads "up"; ≈ −1 → inverted. A slope, not a correlation, so a
// trip that only ever accelerates the same way still gives an answer.

export interface GravitySignVerdict {
  readonly sign: 1 | -1 | null; // null = not enough evidence yet
  readonly slope: number;
  readonly samples: number;
}

const MIN_ACCEL_MPS2 = 0.6; // only moments when the car clearly changes speed
const MIN_SAMPLES = 40;
// Mount tilt and filter lag shrink the slope; anything clearly away from 0 decides.
const MIN_SLOPE = 0.35;

export class GravitySignDetector {
  private n = 0;
  private sxx = 0;
  private sxy = 0;
  private restZ: number | null = null;

  // `accelZ`: raw accelerometer z (device axes, as reported, sign untouched).
  // `accelLongMps2`: car acceleration from speed. `speedMps` for rest detection.
  add(accelZ: number, accelLongMps2: number, speedMps: number): void {
    const optical = -accelZ; // specific force along the optical axis (if sign = +1)
    if (speedMps < 0.3) {
      // Parked: learn the resting value so moving samples become deltas.
      this.restZ = this.restZ == null ? optical : this.restZ + 0.02 * (optical - this.restZ);
      return;
    }
    if (this.restZ == null || Math.abs(accelLongMps2) < MIN_ACCEL_MPS2) return;
    const x = accelLongMps2;
    const y = optical - this.restZ;
    this.n++;
    this.sxx += x * x;
    this.sxy += x * y;
  }

  verdict(): GravitySignVerdict {
    const slope = this.sxx > 0 ? this.sxy / this.sxx : 0;
    const sign = this.n >= MIN_SAMPLES && Math.abs(slope) >= MIN_SLOPE ? (slope > 0 ? 1 : -1) : null;
    return { sign, slope, samples: this.n };
  }
}
