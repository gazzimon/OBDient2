// Learns what is normal for each car by itself: while the adapter is
// connected, one sample per second of the fresh telemetry goes into the
// session; when the adapter goes, the session is added to that car's
// baseline (by VIN). Nothing leaves the phone.
//
// The diagnosis compares the session in progress with the baseline, so a
// car that idles 200 rpm higher than usual today says so.

import { container } from '@/data/container';
import { DASHBOARD_PIDS, type PidId } from '@/core/constants/pids';
import { BaselineSession, MIN_SESSIONS, type BaselineMetric, type BaselineSample, type Deviation } from '@/domain/vehicle/baseline';
import { useOBDStore } from '@/store/obdStore';

const SAMPLE_MS = 1000;
// Older than this, a telemetry value is not "now".
const FRESH_MS = 3000;

class BaselineRecorder {
  private session: BaselineSession | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  // The VIN of the session in progress, once read.
  private lastVin: string | null = null;

  start(): void {
    if (this.started) return;
    this.started = true;
    const sync = () => {
      const on = useOBDStore.getState().connectionState === 'connected';
      if (on && !this.timer) this.begin();
      else if (!on && this.timer) this.end();
    };
    useOBDStore.subscribe(sync);
    sync();
  }

  // What is unusual now for this car, and what could be compared at all.
  compare(vin: string | null): { deviations: Deviation[]; comparable: BaselineMetric[] } {
    const current = this.session?.values() ?? {};
    const car = container.baselines.get(vin);
    if (!car) return { deviations: [], comparable: [] };
    const comparable = (Object.keys(current) as BaselineMetric[]).filter((m) => (car.metrics[m]?.n ?? 0) >= MIN_SESSIONS);
    return { deviations: container.baselines.deviations(vin, current), comparable };
  }

  private begin(): void {
    this.session = new BaselineSession();
    // Never the previous car's: a mechanic moves the adapter between cars.
    this.lastVin = null;
    // VIN = the car; read once the session settles (cached per session).
    setTimeout(() => void container.vehicleTools.ensureVin(), 5_000);
    this.timer = setInterval(() => this.sample(), SAMPLE_MS);
  }

  private end(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const session = this.session;
    this.session = null;
    // The VIN of the session that just closed, read while it was open.
    if (session) container.baselines.commit(this.lastVin, session);
  }

  private sample(): void {
    const now = Date.now();
    const p = useOBDStore.getState().parameters;
    const sample: Record<string, number> = { t: now };
    for (const pid of DASHBOARD_PIDS as readonly PidId[]) {
      const v = p[pid];
      if (v && now - v.timestamp.getTime() < FRESH_MS) sample[pid] = v.value;
    }
    this.lastVin = container.vehicleTools.knownVin() ?? this.lastVin;
    this.session?.push(sample as BaselineSample);
  }
}

export const baselineRecorder = new BaselineRecorder();
