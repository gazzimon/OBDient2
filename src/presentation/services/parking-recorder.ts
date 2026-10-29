// "Dónde estacioné": when the adapter link goes (contact off, or the phone
// walks away from the car), the phone's position then is saved as where that
// car was left (domain/parking). GPS only, nothing leaves the phone.
//
// The fix: the navigation's if it is recent, else a fresh one (only possible
// with the app in front), else the last one the phone knows.

import * as Location from 'expo-location';
import { container } from '@/data/container';
import { bestFix, type Fix } from '@/domain/parking/parking';
import { carLabel } from '@/domain/vehicle/car-brief';
import { useEgoStore } from '@/store/egoStore';
import { useOBDStore } from '@/store/obdStore';

const FRESH_FIX_MS = 15_000;

class ParkingRecorder {
  private started = false;
  // The car of the session in progress, once its VIN was read.
  private vin: string | null = null;
  private readonly listeners = new Set<() => void>();

  // Called after each saved spot; returns the unsubscribe.
  onSaved(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    let last = useOBDStore.getState().connectionState;
    useOBDStore.subscribe((s) => {
      if (s.connectionState === 'connected' && s.vin !== undefined) this.vin = s.vin;
      if (s.connectionState === last) return;
      const was = last;
      last = s.connectionState;
      if (s.connectionState === 'connecting') this.vin = null;
      if (was === 'connected' && s.connectionState === 'disconnected') void this.save(this.vin, s.stoppedByUser ? 'user' : 'lost');
    });
  }

  private async save(vin: string | null, reason: 'lost' | 'user'): Promise<void> {
    const at = Date.now();
    const fix = bestFix([egoFix(), await currentFix(), await lastKnownFix()], at);
    if (!fix) return;
    container.parking.save({
      lat: fix.lat,
      lng: fix.lng,
      accuracyM: fix.accuracyM,
      at,
      fixAt: fix.at,
      vin,
      car: vin ? carLabel(vin, at) : null,
      reason,
    });
    for (const l of this.listeners) l();
  }
}

function egoFix(): Fix | null {
  const ego = useEgoStore.getState().ego;
  return ego ? { ...ego.position, accuracyM: ego.gpsAccuracyM, at: ego.tMs } : null;
}

async function currentFix(): Promise<Fix | null> {
  try {
    if (!(await Location.getForegroundPermissionsAsync()).granted) return null;
    const loc = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<null>((r) => setTimeout(() => r(null), FRESH_FIX_MS)),
    ]);
    return loc ? fromLocation(loc) : null;
  } catch {
    // In the background Android refuses a new fix: the last known one is used.
    return null;
  }
}

async function lastKnownFix(): Promise<Fix | null> {
  try {
    const loc = await Location.getLastKnownPositionAsync();
    return loc ? fromLocation(loc) : null;
  } catch {
    return null;
  }
}

function fromLocation(loc: Location.LocationObject): Fix {
  return { lat: loc.coords.latitude, lng: loc.coords.longitude, accuracyM: loc.coords.accuracy ?? 100, at: loc.timestamp };
}

export const parkingRecorder = new ParkingRecorder();
