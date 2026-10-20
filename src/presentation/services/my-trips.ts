// Records "Mis viajes" by itself: while the adapter is connected (and the
// setting is on), one sample per second of the fused position and speed, and
// the fuel flow from the MAF when the dashboard reads it. The trip ends when
// the adapter goes or after 15 min stopped. Then it gets its place names and
// the trouble codes read during it.
//
// The app must be open (decision 2026-10-19): no background location.
//
// The same samples feed the live position for the lab's Traccar, always while
// the adapter is connected (decision 2026-10-20): every 5 s moving, every minute stopped, queued
// while there is no signal, through obdient-tools (checked with the account key).

import { useSyncExternalStore } from 'react';
import { container } from '@/data/container';
import { TripStore } from '@/data/trips/trip-store';
import { TrackQueue, deviceIdFor, newDeviceId, trackDue } from '@/domain/trips/live-track';
import { END_AFTER_MS, TripBuilder, type Trip } from '@/domain/trips/trip-builder';
import { useEgoStore } from '@/store/egoStore';
import { useOBDStore } from '@/store/obdStore';
import { useSettingsStore } from '@/store/settingsStore';

const SAMPLE_MS = 1000;
const DRAFT_EVERY = 30;
const FRESH_MS = 3000;
// g/s → L/h for petrol at 14.7:1 (core/utils/fuel.ts).
const MAF_TO_LPH = 3600 / (14.7 * 740);

export const trips = new TripStore();

class MyTripsRecorder {
  private builder = new TripBuilder(
    () => `trip-${Date.now().toString(36)}`,
    () => container.vehicleTools.knownVin(),
  );
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticks = 0;
  private started = false;
  private readonly queue = new TrackQueue();
  private lastTrackAt: number | null = null;
  private sending = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    // A trip left by a closed app: go on with it if recent, else close it.
    const draft = trips.loadDraft();
    if (draft) {
      if (Date.now() - draft.lastT < END_AFTER_MS) this.builder.resume(draft);
      else {
        this.builder.resume(draft);
        this.close();
      }
    }
    const sync = () => {
      const on = useSettingsStore.getState().recordMyTrips && useOBDStore.getState().connectionState === 'connected';
      if (on && !this.timer) this.begin();
      else if (!on && this.timer) this.end();
    };
    useOBDStore.subscribe(sync);
    useSettingsStore.subscribe(sync);
    sync();
  }

  private begin(): void {
    void container.sensors.acquire();
    // VIN = the car: read it once the session settles, for the trip and the lab.
    setTimeout(() => void container.vehicleTools.ensureVin(), 4_000);
    this.timer = setInterval(() => this.sample(), SAMPLE_MS);
  }

  private end(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    container.sensors.release();
    this.close();
  }

  private sample(): void {
    const ego = useEgoStore.getState().ego;
    if (!ego) return;
    const now = Date.now();
    const p = useOBDStore.getState().parameters;
    const speed = p.SPEED && now - p.SPEED.timestamp.getTime() < FRESH_MS ? p.SPEED.value : ego.speedMps * 3.6;
    const maf = p.MAF && now - p.MAF.timestamp.getTime() < FRESH_MS ? p.MAF.value : null;
    this.track(now, ego.position.lat, ego.position.lng, speed, ego.headingValid ? ego.headingDeg : null, ego.gpsAccuracyM);
    const ev = this.builder.push({
      t: now,
      lat: ego.position.lat,
      lng: ego.position.lng,
      kmh: speed,
      fuelLph: maf != null ? maf * MAF_TO_LPH : null,
    });
    if (ev?.type === 'ended') {
      trips.saveDraft(null);
      if (ev.trip) void this.keep(ev.trip);
    } else if (++this.ticks % DRAFT_EVERY === 0) {
      trips.saveDraft(this.builder.current);
    }
  }

  private track(now: number, lat: number, lng: number, kmh: number, bearing: number | null, acc: number): void {
    // Always on while the adapter is connected (decision 2026-10-20, lab vehicle
    // monitoring). Before Google Play: an explicit consent screen (ROADMAP).
    // Device = the adapter (its Bluetooth address); a random id only if unknown.
    const settings = useSettingsStore.getState();
    let trackingDevice = deviceIdFor(settings.lastDeviceId) ?? settings.trackingDevice;
    if (!trackingDevice) trackingDevice = newDeviceId();
    if (trackingDevice !== settings.trackingDevice) settings.setLiveTracking(true, trackingDevice);
    if (!trackDue(this.lastTrackAt, now, kmh)) return;
    this.lastTrackAt = now;
    const p = useOBDStore.getState().parameters;
    const fresh = (v: { value: number; timestamp: Date } | undefined) => (v && now - v.timestamp.getTime() < FRESH_MS ? v.value : undefined);
    const obd: Record<string, number> = {};
    const put = (k: string, v: number | undefined) => {
      if (v !== undefined) obd[k] = Math.round(v * 10) / 10;
    };
    put('rpm', fresh(p.RPM));
    put('coolant', fresh(p.COOLANT_TEMP));
    put('load', fresh(p.ENGINE_LOAD));
    put('voltage', fresh(p.VOLTAGE));
    const maf = fresh(p.MAF);
    put('fuelLph', maf !== undefined ? maf * MAF_TO_LPH : undefined);
    this.queue.push({ t: now, lat, lng, kmh: Math.round(kmh), bearing, acc: Math.round(acc), obd, vin: container.vehicleTools.knownVin() });
    void this.flush(trackingDevice);
  }

  // Sends what is queued, a batch at a time; on failure it waits for the next point.
  private async flush(device: string): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.queue.size > 0) {
        const batch = this.queue.next();
        const r = await container.toolsClient.post('track', { device, points: batch }, AbortSignal.timeout(8_000), 'seguimiento');
        // A batch the server will never take (bad data) is dropped, not retried forever.
        if (!r.ok && !r.message.includes('HTTP 400')) break;
        this.queue.sent(batch.length);
      }
    } catch {
      // No signal: the points stay queued.
    } finally {
      this.sending = false;
    }
  }

  private close(): void {
    const trip = this.builder.finish();
    trips.saveDraft(null);
    if (trip) void this.keep(trip);
  }

  // Saved at once; place names and codes are added when they arrive.
  private async keep(trip: Trip): Promise<void> {
    trips.save(trip);
    const codes = container.faults
      .list(trip.vin ?? undefined)
      .flatMap((e) => (e.type === 'codes' && e.lastSeenAt >= trip.startedAt && e.at <= trip.endedAt + 60_000 ? e.codes.map((c) => c.code) : []));
    const name = async (lat: number, lng: number) => {
      try {
        const w = await container.geocoder().reverse?.({ lat, lng });
        return w?.street ?? w?.city ?? null;
      } catch {
        return null;
      }
    };
    const first = trip.path[0]!;
    const last = trip.path[trip.path.length - 1]!;
    const [startName, endName] = await Promise.all([name(first.lat, first.lng), name(last.lat, last.lng)]);
    trips.save({ ...trip, startName, endName, codes: [...new Set(codes)] });
  }
}

export const myTrips = new MyTripsRecorder();

// Re-renders when a trip is saved or deleted.
export function useTrips(): readonly Trip[] {
  const version = useSyncExternalStore(
    (cb) => trips.subscribe(cb),
    () => trips.version,
  );
  return useTripsCache(version);
}

let cache: { version: number; list: Trip[] } = { version: -1, list: [] };
function useTripsCache(version: number): Trip[] {
  if (cache.version !== version) cache = { version, list: trips.list() };
  return cache.list;
}
