// Owns the phone sensors while navigation needs them and runs the fusion.
//
//   expo-location  → EgoEstimator.onGps          (~1 Hz)
//   OBD telemetry  → EgoEstimator.onObdSpeed     (~5–10 Hz, pushed by ObdManager)
//   DeviceMotion   → PoseEstimator + EgoEstimator.tick (50 Hz)
//
// Fusion runs at the motion rate; the store is published at ~20 Hz, which is
// what React can paint without starving the JS thread.

import * as Location from 'expo-location';
import { Accelerometer, DeviceMotion, Gyroscope } from 'expo-sensors';
import { EgoEstimator, type EgoState } from '@/domain/fusion/ego-estimator';
import { PoseEstimator, type LandscapeSide, type PoseEstimate, type Vec3 } from '@/domain/fusion/pose-estimator';
import type { TripRecord } from '@/domain/recording/trip-log';
import { useEgoStore } from '@/store/egoStore';
import { useSettingsStore } from '@/store/settingsStore';

const MOTION_INTERVAL_MS = 20;
// Some phones (seen on a Xiaomi 2510DPC44G) deliver DeviceMotion events with
// only `orientation` and `interval` — no acceleration, no rotation rate. If
// none carries acceleration within this window, read the raw sensors instead.
const MOTION_FALLBACK_MS = 1500;
const G = 9.80665;
const RAD_TO_DEG = 180 / Math.PI;
const PUBLISH_INTERVAL_MS = 50;
// Landscape side flips only on a clear reading (phone being re-mounted).
const SIDE_SWITCH_MPS2 = 5;

// `pose` is null when the phone has no motion sensor (GPS-only fallback).
export type TickListener = (ego: EgoState, pose: PoseEstimate | null) => void;

export class SensorHub {
  private readonly ego = new EgoEstimator();
  private readonly pose = new PoseEstimator();
  private side: LandscapeSide = 'top-left';
  private lastMotionT: number | null = null;
  private lastPublish = 0;
  private users = 0;
  // Bumped by stop(): a start() still awaiting permissions must not subscribe.
  private generation = 0;
  private locationSub: Location.LocationSubscription | null = null;
  private motionSubs: { remove(): void }[] = [];
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<TickListener>();
  // Trip log tap: raw inputs and fused state (see domain/recording).
  private recordSink: ((rec: TripRecord) => void) | null = null;

  // Reference-counted: the map and the AR screen can both hold it.
  async acquire(): Promise<void> {
    this.users++;
    if (this.users === 1) await this.start();
  }

  release(): void {
    this.users = Math.max(0, this.users - 1);
    if (this.users === 0) this.stop();
  }

  onTick(listener: TickListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setRecordSink(sink: ((rec: TripRecord) => void) | null): void {
    this.recordSink = sink;
  }

  onObdSpeed(kmh: number, tMs: number): void {
    this.ego.onObdSpeed({ kmh, tMs });
  }

  seedHeading(deg: number): void {
    this.ego.seedHeading(deg);
  }

  // Past ego poses for the optional Qwen-Drive path (ADR-0001).
  egoHistory() {
    return this.ego.egoFrameHistory();
  }

  private async start(): Promise<void> {
    const gen = ++this.generation;
    const stale = () => gen !== this.generation;
    const status = useEgoStore.getState().setStatus;
    status({ location: 'starting', motion: 'starting' });

    const perm = await Location.requestForegroundPermissionsAsync();
    if (stale()) return;
    if (!perm.granted) {
      status({ location: 'denied' });
    } else {
      const sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
        (loc) => {
          const fix = {
            position: { lat: loc.coords.latitude, lng: loc.coords.longitude },
            accuracyM: loc.coords.accuracy ?? 50,
            courseDeg: loc.coords.heading,
            speedMps: loc.coords.speed,
            tMs: Date.now(),
          };
          this.ego.onGps(fix);
          this.recordSink?.({
            k: 'gps',
            t: fix.tMs,
            lat: fix.position.lat,
            lng: fix.position.lng,
            acc: fix.accuracyM,
            crs: fix.courseDeg,
            spd: fix.speedMps,
          });
          status({ location: 'ok' });
          if (!this.motionSubs.length) this.tickWithoutMotion();
        },
      );
      if (stale()) {
        sub.remove();
        return;
      }
      this.locationSub = sub;
    }

    const motionAvailable = await DeviceMotion.isAvailableAsync();
    if (stale()) return;
    if (!motionAvailable) {
      this.startRawSensors(gen);
      return;
    }
    DeviceMotion.setUpdateInterval(MOTION_INTERVAL_MS);
    let gotAccel = false;
    this.motionSubs.push(
      DeviceMotion.addListener((m) => {
        const g = m.accelerationIncludingGravity;
        if (!g) return;
        gotAccel = true;
        const r = m.rotationRate;
        this.onMotion(
          { x: g.x, y: g.y, z: g.z },
          // alpha/beta/gamma are rotations about z/x/y, already in deg/s.
          r ? { x: r.beta, y: r.gamma, z: r.alpha } : { x: 0, y: 0, z: 0 },
        );
      }),
    );
    this.fallbackTimer = setTimeout(() => {
      this.fallbackTimer = null;
      if (gotAccel || stale()) return;
      console.warn('[SensorHub] DeviceMotion has no acceleration on this phone; using raw sensors');
      this.removeMotionSubs();
      this.startRawSensors(gen);
    }, MOTION_FALLBACK_MS);
    status({ motion: 'ok' });
  }

  // Accelerometer (g) + gyroscope (rad/s), converted to the DeviceMotion units
  // the fusion expects (m/s², deg/s). The accelerometer drives the loop; the
  // latest gyro sample rides along.
  private startRawSensors(gen: number): void {
    const status = useEgoStore.getState().setStatus;
    void Promise.all([Accelerometer.isAvailableAsync(), Gyroscope.isAvailableAsync()]).then(([acc, gyro]) => {
      if (gen !== this.generation) return;
      if (!acc) {
        status({ motion: 'unavailable' });
        return;
      }
      let rate = { x: 0, y: 0, z: 0 };
      if (gyro) {
        Gyroscope.setUpdateInterval(MOTION_INTERVAL_MS);
        this.motionSubs.push(
          Gyroscope.addListener((r) => {
            rate = { x: r.x * RAD_TO_DEG, y: r.y * RAD_TO_DEG, z: r.z * RAD_TO_DEG };
          }),
        );
      }
      Accelerometer.setUpdateInterval(MOTION_INTERVAL_MS);
      this.motionSubs.push(
        Accelerometer.addListener((a) => this.onMotion({ x: a.x * G, y: a.y * G, z: a.z * G }, rate)),
      );
      status({ motion: 'ok' });
    });
  }

  private removeMotionSubs(): void {
    for (const sub of this.motionSubs) sub.remove();
    this.motionSubs = [];
  }

  private onMotion(accel: Vec3, gyroDegS: Vec3): void {
    const t = Date.now();
    const dt = this.lastMotionT == null ? MOTION_INTERVAL_MS / 1000 : Math.min(0.2, (t - this.lastMotionT) / 1000);
    this.lastMotionT = t;

    const { gravitySign } = useSettingsStore.getState().calibration;
    this.updateSide(accel, gravitySign);
    this.pose.configure({ side: this.side, gravitySign, timeConstantS: 1.5 });

    this.recordSink?.({ k: 'imu', t, a: [accel.x, accel.y, accel.z], g: [gyroDegS.x, gyroDegS.y, gyroDegS.z] });
    const yawRate = this.pose.yawRateDegS(gyroDegS);
    const ego = this.ego.tick(t, yawRate);
    const pose = this.pose.update(
      { accelWithGravity: accel, dtS: dt },
      ego ? { accelLongMps2: ego.accelLongMps2, speedMps: ego.speedMps, yawRateDegS: yawRate } : null,
    );
    if (!ego) return;

    this.recordSink?.({
      k: 'st',
      t,
      lat: ego.position.lat,
      lng: ego.position.lng,
      hdg: ego.headingDeg,
      hv: ego.headingValid,
      spd: ego.speedMps,
      src: ego.speedSource,
      al: ego.accelLongMps2,
      yr: ego.yawRateDegS,
      p: pose.pitchDeg,
      r: pose.rollDeg,
    });
    for (const l of this.listeners) l(ego, pose);
    if (t - this.lastPublish >= PUBLISH_INTERVAL_MS) {
      this.lastPublish = t;
      useEgoStore.getState().publish(ego, { ...pose, side: this.side });
    }
  }

  // No IMU: advance on each GPS fix so navigation still works; no AR pose.
  private tickWithoutMotion(): void {
    const ego = this.ego.tick(Date.now(), 0);
    if (!ego) return;
    for (const l of this.listeners) l(ego, null);
    useEgoStore.getState().publish(ego, null);
  }

  // In landscape, "up" lies along the device x axis; its sign says which way
  // the phone is mounted. Read from gravity rather than the screen-orientation
  // API, so it cannot disagree with the sensor we actually use.
  private updateSide(accel: Vec3, sign: 1 | -1): void {
    const upX = accel.x * sign;
    if (upX > SIDE_SWITCH_MPS2) this.side = 'top-left';
    else if (upX < -SIDE_SWITCH_MPS2) this.side = 'top-right';
  }

  private stop(): void {
    this.generation++;
    this.locationSub?.remove();
    this.locationSub = null;
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
    this.fallbackTimer = null;
    this.removeMotionSubs();
    this.lastMotionT = null;
    this.pose.reset();
    useEgoStore.getState().setStatus({ location: 'off', motion: 'off' });
  }
}
