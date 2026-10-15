// Drives a navigation session: routing requests, progress tracking at the
// fusion rate, voice prompts and automatic rerouting.

import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { container } from '@/data/container';
import { bearingDeg, type LatLng } from '@/domain/geo/geo';
import { Announcer } from '@/domain/navigation/guidance';
import { RouteTracker } from '@/domain/navigation/route-progress';
import type { Place, Route } from '@/domain/navigation/route';
import type { EgoState } from '@/domain/fusion/ego-estimator';
import { useEgoStore } from '@/store/egoStore';
import { useNavStore } from '@/store/navStore';
import { useSettingsStore } from '@/store/settingsStore';

const PROGRESS_INTERVAL_MS = 100;
const REROUTE_COOLDOWN_MS = 15_000;

class NavigationController {
  private tracker: RouteTracker | null = null;
  private announcer = new Announcer();
  private unsubscribe: (() => void) | null = null;
  private lastProgress = 0;
  private lastReroute = 0;
  private rerouting = false;
  private abort: AbortController | null = null;

  async planTo(place: Place): Promise<void> {
    const nav = useNavStore.getState();
    nav.setDestination(place);
    nav.setRouting();
    try {
      const route = await this.fetchRoute(place.location);
      useNavStore.getState().setRoute(route, false);
    } catch (err) {
      useNavStore.getState().setError(message(err));
    }
  }

  async start(): Promise<void> {
    const { route } = useNavStore.getState();
    if (!route) return;
    await container.sensors.acquire();
    this.bind(route);
    useNavStore.getState().start();
    this.say('Iniciando navegación');
  }

  stop(): void {
    this.abort?.abort();
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.tracker) container.sensors.release();
    this.tracker = null;
    Speech.stop();
    useNavStore.getState().clear();
  }

  private bind(route: Route): void {
    this.tracker = new RouteTracker(route);
    this.announcer.reset();
    // Parked at the start, the road the route begins on is the best heading.
    container.sensors.seedHeading(bearingDeg(route.geometry[0]!, route.geometry[1]!));
    this.unsubscribe?.();
    this.unsubscribe = container.sensors.onTick((ego) => this.onTick(ego));
  }

  private onTick(ego: EgoState): void {
    if (!this.tracker || ego.tMs - this.lastProgress < PROGRESS_INTERVAL_MS) return;
    this.lastProgress = ego.tMs;

    const progress = this.tracker.update(ego.position, ego.gpsAccuracyM, ego.tMs);
    const nav = useNavStore.getState();
    nav.setProgress(progress);

    if (progress.arrived && nav.status !== 'arrived') {
      nav.setArrived();
      this.say('Llegaste a tu destino');
      return;
    }

    const phrase = this.announcer.next(progress.nextManeuver, progress.distanceToManeuverM, ego.speedMps);
    if (phrase) this.say(phrase);

    if (progress.offRoute && !this.rerouting && ego.tMs - this.lastReroute > REROUTE_COOLDOWN_MS) {
      void this.reroute();
    }
  }

  private async reroute(): Promise<void> {
    const dest = useNavStore.getState().destination;
    if (!dest) return;
    this.rerouting = true;
    this.lastReroute = Date.now();
    this.say('Recalculando');
    try {
      const route = await this.fetchRoute(dest.location);
      useNavStore.getState().setRoute(route, true);
      this.bind(route);
    } catch (err) {
      // Offline: keep the old route on screen; the next off-route tick retries.
      useNavStore.getState().setError(`Sin conexión para recalcular: ${message(err)}`);
    } finally {
      this.rerouting = false;
    }
  }

  private async fetchRoute(destination: LatLng): Promise<Route> {
    this.abort?.abort();
    this.abort = new AbortController();
    const ego = useEgoStore.getState().ego;
    const origin = ego?.position ?? (await currentPosition());
    return container.routing().route(
      { origin, destination, ...(ego?.headingValid ? { headingDeg: ego.headingDeg } : {}) },
      this.abort.signal,
    );
  }

  private say(text: string): void {
    if (!useSettingsStore.getState().voiceEnabled) return;
    Speech.stop();
    Speech.speak(text, { language: 'es-ES' });
  }
}

async function currentPosition(): Promise<LatLng> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) throw new Error('Se necesita permiso de ubicación');
  const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  return { lat: loc.coords.latitude, lng: loc.coords.longitude };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const navigation = new NavigationController();
