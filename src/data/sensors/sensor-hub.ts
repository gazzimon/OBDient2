// Owns the phone sensors while navigation needs them and runs the fusion.
//
//   expo-location  → EgoEstimator.onGps          (~1 Hz)
//   OBD telemetry  → EgoEstimator.onObdSpeed     (~5–10 Hz, pushed by ObdManager)
//   DeviceMotion   → PoseEstimator + EgoEstimator.tick (50 Hz)
//
// Fusion runs at the motion rate; the store is published at ~20 Hz, which is
// what React can paint without starving the JS thread.

import * as Location from 'expo-location';
import { DeviceMotion } from 'expo-sensors';
import { EgoEstimator, type EgoState } from '@/domain/fusion/ego-estimator';
import { PoseEstimator, type LandscapeSide, type PoseEstimate, type Vec3 } from '@/domain/fusion/pose-estimator';
import { useEgoStore } from '@/store/egoStore';
import { useSettingsStore } from '@/store/settingsStore';

const MOTION_INTERVAL_MS = 20;
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
  private motionSub: { remove(): void } | null = null;
  private readonly listeners = new Set<TickListener>();

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
          this.ego.onGps({
            position: { lat: loc.coords.latitude, lng: loc.coords.longitude },
            accuracyM: loc.coords.accuracy ?? 50,
            courseDeg: loc.coords.heading,
            speedMps: loc.coords.speed,
            tMs: Date.now(),
          });
          status({ location: 'ok' });
          if (!this.motionSub) this.tickWithoutMotion();
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
      status({ motion: 'unavailable' });
      return;
    }
    DeviceMotion.setUpdateInterval(MOTION_INTERVAL_MS);
    this.motionSub = DeviceMotion.addListener((m) => {
      const g = m.accelerationIncludingGravity;
      const r = m.rotationRate;
      this.onMotion(
        { x: g.x, y: g.y, z: g.z },
        // alpha/beta/gamma are rotations about z/x/y.
        r ? { x: r.beta, y: r.gamma, z: r.alpha } : { x: 0, y: 0, z: 0 },
      );
    });
    status({ motion: 'ok' });
  }

  private onMotion(accel: Vec3, gyroDegS: Vec3): void {
    const t = Date.now();
    const dt = this.lastMotionT == null ? MOTION_INTERVAL_MS / 1000 : Math.min(0.2, (t - this.lastMotionT) / 1000);
    this.lastMotionT = t;

    const { gravitySign } = useSettingsStore.getState().calibration;
    this.updateSide(accel, gravitySign);
    this.pose.configure({ side: this.side, gravitySign, timeConstantS: 1.5 });

    const yawRate = this.pose.yawRateDegS(gyroDegS);
    const ego = this.ego.tick(t, yawRate);
    const pose = this.pose.update(
      { accelWithGravity: accel, dtS: dt },
      ego ? { accelLongMps2: ego.accelLongMps2, speedMps: ego.speedMps, yawRateDegS: yawRate } : null,
    );
    if (!ego) return;

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
    this.motionSub?.remove();
    this.motionSub = null;
    this.lastMotionT = null;
    this.pose.reset();
    useEgoStore.getState().setStatus({ location: 'off', motion: 'off' });
  }
}
