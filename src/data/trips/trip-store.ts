// "Mis viajes" on the phone (MMKV, its own store): one key per trip, an index
// newest first, and the trip in progress (so a closed app does not lose it).
// Local only: positions never leave the phone unless the person shares a trip
// or turns on live tracking (Traccar).

import { createMMKV } from 'react-native-mmkv';
import type { Trip, TripDraft } from '@/domain/trips/trip-builder';

const MAX_TRIPS = 500;
const INDEX = 'index.v1';
const DRAFT = 'draft.v1';

export class TripStore {
  private readonly mmkv = createMMKV({ id: 'obdient2-trips' });
  private readonly listeners = new Set<() => void>();
  private ids: string[] = this.readIndex();

  private readIndex(): string[] {
    try {
      return JSON.parse(this.mmkv.getString(INDEX) ?? '[]') as string[];
    } catch {
      return [];
    }
  }

  // Newest first.
  list(): Trip[] {
    return this.ids.flatMap((id) => {
      const t = this.get(id);
      return t ? [t] : [];
    });
  }

  get(id: string): Trip | null {
    try {
      const raw = this.mmkv.getString(`trip.${id}`);
      return raw ? (JSON.parse(raw) as Trip) : null;
    } catch {
      return null;
    }
  }

  save(trip: Trip): void {
    this.mmkv.set(`trip.${trip.id}`, JSON.stringify(trip));
    if (!this.ids.includes(trip.id)) this.ids = [trip.id, ...this.ids];
    for (const old of this.ids.splice(MAX_TRIPS)) this.mmkv.remove(`trip.${old}`);
    this.mmkv.set(INDEX, JSON.stringify(this.ids));
    this.changed();
  }

  remove(id: string): void {
    this.mmkv.remove(`trip.${id}`);
    this.ids = this.ids.filter((x) => x !== id);
    this.mmkv.set(INDEX, JSON.stringify(this.ids));
    this.changed();
  }

  // Account deleted: every trip and the draft go.
  clear(): void {
    this.mmkv.clearAll();
    this.ids = [];
    this.changed();
  }

  saveDraft(d: TripDraft | null): void {
    if (d) this.mmkv.set(DRAFT, JSON.stringify(d));
    else this.mmkv.remove(DRAFT);
  }

  loadDraft(): TripDraft | null {
    try {
      const raw = this.mmkv.getString(DRAFT);
      return raw ? (JSON.parse(raw) as TripDraft) : null;
    } catch {
      return null;
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // Changes on every save/remove, for useSyncExternalStore.
  version = 0;
  private changed(): void {
    this.version += 1;
    for (const l of this.listeners) l();
  }
}
