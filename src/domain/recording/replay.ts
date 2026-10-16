// Replays a trip log through the same fusion code the phone runs, and
// summarises what matters to diagnose the AR afterwards. Pure: runs in Jest
// and in the `npm run replay` script on a desk.

import { EgoEstimator } from '@/domain/fusion/ego-estimator';
import { GravitySignDetector, type GravitySignVerdict } from '@/domain/fusion/gravity-sign';
import { PoseEstimator, type LandscapeSide } from '@/domain/fusion/pose-estimator';
import { angleDiffDeg, distanceM } from '@/domain/geo/geo';
import type { TripRecord } from './trip-log';

export interface TripSummary {
  readonly durationS: number;
  readonly distanceM: number;
  readonly gps: { fixes: number; meanAccuracyM: number };
  readonly obd: { samples: number; rateHz: number; learnedScale: number };
  readonly imu: { samples: number; rateHz: number };
  // Pose while stopped (speed < 0.5 m/s): the mount's resting tilt.
  readonly restingPose: { pitchDeg: number; rollDeg: number; samples: number } | null;
  // Fused heading vs GPS course while moving > 5 m/s.
  readonly headingErrorDeg: { mean: number; p95: number; samples: number } | null;
  // Accelerometer convention measured from the drive itself (gravity-sign.ts).
  readonly sensorSign: GravitySignVerdict;
  readonly events: Record<string, number>;
  readonly warnings: string[];
}

export function replayTrip(records: readonly TripRecord[], gravitySign: 1 | -1 = 1): TripSummary {
  const ego = new EgoEstimator();
  const pose = new PoseEstimator();
  const signDetector = new GravitySignDetector();
  let side: LandscapeSide = 'top-left';

  let first: number | null = null;
  let last = 0;
  let gpsFixes = 0;
  let accSum = 0;
  let obdSamples = 0;
  let imuSamples = 0;
  let lastImuT: number | null = null;
  let lastGps: { lat: number; lng: number; crs: number | null; spd: number | null } | null = null;
  let distance = 0;
  const rest = { pitch: 0, roll: 0, n: 0 };
  const headingErrors: number[] = [];
  const events: Record<string, number> = {};

  for (const r of records) {
    if (!('t' in r)) continue;
    first ??= r.t;
    last = Math.max(last, r.t);

    switch (r.k) {
      case 'gps': {
        gpsFixes++;
        accSum += r.acc;
        if (lastGps) distance += distanceM(lastGps, r);
        lastGps = r;
        ego.onGps({ position: { lat: r.lat, lng: r.lng }, accuracyM: r.acc, courseDeg: r.crs, speedMps: r.spd, tMs: r.t });
        break;
      }
      case 'obd':
        obdSamples++;
        ego.onObdSpeed({ kmh: r.kmh, tMs: r.t });
        break;
      case 'imu': {
        imuSamples++;
        const dt = lastImuT == null ? 0.02 : Math.min(0.2, (r.t - lastImuT) / 1000);
        lastImuT = r.t;
        const [ax, ay, az] = r.a;
        const upX = ax * gravitySign;
        if (upX > 5) side = 'top-left';
        else if (upX < -5) side = 'top-right';
        pose.configure({ side, gravitySign, timeConstantS: 1.5 });
        const gyro = { x: r.g[0], y: r.g[1], z: r.g[2] };
        const yaw = pose.yawRateDegS(gyro);
        const s = ego.tick(r.t, yaw);
        const p = pose.update(
          { accelWithGravity: { x: ax, y: ay, z: az }, dtS: dt },
          s ? { accelLongMps2: s.accelLongMps2, speedMps: s.speedMps, yawRateDegS: yaw } : null,
        );
        if (s) signDetector.add(az, s.accelLongMps2, s.speedMps);
        if (s && s.speedMps < 0.5) {
          rest.pitch += p.pitchDeg;
          rest.roll += p.rollDeg;
          rest.n++;
        }
        if (s && s.headingValid && s.speedMps > 5 && lastGps?.crs != null && lastGps.crs >= 0) {
          headingErrors.push(Math.abs(angleDiffDeg(s.headingDeg, lastGps.crs)));
        }
        break;
      }
      case 'ev':
        events[r.name] = (events[r.name] ?? 0) + 1;
        break;
      default:
        break;
    }
  }

  const durationS = first == null ? 0 : (last - first) / 1000;
  const restingPose = rest.n ? { pitchDeg: rest.pitch / rest.n, rollDeg: rest.roll / rest.n, samples: rest.n } : null;
  headingErrors.sort((a, b) => a - b);
  const headingErrorDeg = headingErrors.length
    ? {
        mean: headingErrors.reduce((a, b) => a + b, 0) / headingErrors.length,
        p95: headingErrors[Math.floor(headingErrors.length * 0.95)]!,
        samples: headingErrors.length,
      }
    : null;

  const summary: Omit<TripSummary, 'warnings'> = {
    durationS,
    distanceM: distance,
    gps: { fixes: gpsFixes, meanAccuracyM: gpsFixes ? accSum / gpsFixes : 0 },
    obd: { samples: obdSamples, rateHz: durationS ? obdSamples / durationS : 0, learnedScale: ego.obdSpeedScale },
    imu: { samples: imuSamples, rateHz: durationS ? imuSamples / durationS : 0 },
    restingPose,
    headingErrorDeg,
    sensorSign: signDetector.verdict(),
    events,
  };
  return { ...summary, warnings: diagnose(summary, gravitySign) };
}

// Plain-language findings, in the order they should be fixed.
function diagnose(s: Omit<TripSummary, 'warnings'>, gravitySign: 1 | -1): string[] {
  const w: string[] = [];
  if (s.imu.samples === 0) w.push('Sin datos de IMU: la AR no puede dibujarse.');
  else if (s.imu.rateHz < 20) w.push(`IMU a ${s.imu.rateHz.toFixed(0)} Hz: se esperaban ~50.`);
  if (s.sensorSign.sign != null && s.sensorSign.sign !== gravitySign) {
    w.push(
      `El acelerómetro está invertido respecto de la configuración (pendiente ${s.sensorSign.slope.toFixed(2)}): ` +
        'activar "Invertir sensor" en la calibración. El cabeceo se ve espejado.',
    );
  }
  if (s.restingPose) {
    const { pitchDeg, rollDeg } = s.restingPose;
    if (Math.abs(rollDeg) > 120 || Math.abs(pitchDeg) > 60) {
      w.push(
        `Pose en reposo implausible (cabeceo ${pitchDeg.toFixed(0)}°, alabeo ${rollDeg.toFixed(0)}°): ` +
          'probar "Invertir sensor" en la calibración.',
      );
    } else if (Math.abs(pitchDeg) > 15) {
      w.push(`El soporte apunta ${pitchDeg > 0 ? 'hacia abajo' : 'hacia arriba'} ${Math.abs(pitchDeg).toFixed(0)}°: revisar el montaje.`);
    }
  }
  if (s.gps.fixes && s.gps.meanAccuracyM > 20) w.push(`GPS impreciso (±${s.gps.meanAccuracyM.toFixed(0)} m de media).`);
  if (s.headingErrorDeg && s.headingErrorDeg.mean > 10) {
    w.push(`Rumbo fusionado se desvía ${s.headingErrorDeg.mean.toFixed(0)}° del GPS en marcha: revisar el giroscopio (eje/signo).`);
  }
  if (s.obd.samples && s.obd.rateHz < 5) w.push(`OBD a ${s.obd.rateHz.toFixed(1)} Hz: por debajo del objetivo de 5 Hz.`);
  if (Math.abs(s.obd.learnedScale - 1) > 0.08) w.push(`Velocímetro OBD desviado ${((s.obd.learnedScale - 1) * 100).toFixed(0)} % del GPS.`);
  return w;
}

export function formatSummary(s: TripSummary): string {
  const lines = [
    `Duración ${(s.durationS / 60).toFixed(1)} min · ${(s.distanceM / 1000).toFixed(2)} km`,
    `GPS ${s.gps.fixes} fixes, ±${s.gps.meanAccuracyM.toFixed(1)} m`,
    `IMU ${s.imu.rateHz.toFixed(0)} Hz · OBD ${s.obd.rateHz.toFixed(1)} Hz (escala ${s.obd.learnedScale.toFixed(3)})`,
    s.restingPose
      ? `Pose en reposo: cabeceo ${s.restingPose.pitchDeg.toFixed(1)}°, alabeo ${s.restingPose.rollDeg.toFixed(1)}°`
      : 'Pose en reposo: sin datos (nunca se detuvo)',
    s.headingErrorDeg
      ? `Error de rumbo vs GPS: media ${s.headingErrorDeg.mean.toFixed(1)}°, p95 ${s.headingErrorDeg.p95.toFixed(1)}°`
      : 'Error de rumbo: sin datos en marcha',
    `Signo del acelerómetro: ${s.sensorSign.sign == null ? 'sin evidencia suficiente' : s.sensorSign.sign === 1 ? 'normal' : 'invertido'} (pendiente ${s.sensorSign.slope.toFixed(2)}, ${s.sensorSign.samples} muestras)`,
    `Eventos: ${Object.entries(s.events).map(([k, v]) => `${k}×${v}`).join(', ') || 'ninguno'}`,
  ];
  if (s.warnings.length) lines.push('', 'Hallazgos:', ...s.warnings.map((x) => `- ${x}`));
  else lines.push('', 'Sin hallazgos.');
  return lines.join('\n');
}
