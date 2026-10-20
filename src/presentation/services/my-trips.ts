// Records "Mis viajes" by itself: while the adapter is connected (and the
// setting is on), one sample per second of the fused position and speed, and
// the fuel flow from the MAF when the dashboard reads it. The trip ends when
// the adapter goes or after 15 min stopped. Then it gets its place names and
// the trouble codes read during it.
//
// The app must be open (decision 2026-10-19): no background location.

import { useSyncExternalStore } from 'react';
import { container } from '@/data/container';
import { TripStore } from '@/data/trips/trip-store';
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
