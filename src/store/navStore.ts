// Navigation state: destination, route and live progress along it.

import { create } from 'zustand';
import type { MapPin } from '@/domain/assistant/tools';
import type { Place, Route } from '@/domain/navigation/route';
import type { RouteProgress } from '@/domain/navigation/route-progress';

export type NavStatus = 'idle' | 'routing' | 'ready' | 'navigating' | 'arrived' | 'error';

interface NavState {
  destination: Place | null;
  route: Route | null;
  progress: RouteProgress | null;
  status: NavStatus;
  error: string | null;
  // Bumped on every reroute so views can reset per-route state.
  routeVersion: number;
  // Places the assistant found, shown numbered on the Mapa tab ("Ver en el mapa").
  candidates: readonly MapPin[];

  setDestination: (place: Place | null) => void;
  setCandidates: (pins: readonly MapPin[]) => void;
  setRouting: () => void;
  // `navigating`: a reroute while driving goes straight back to guidance.
  setRoute: (route: Route, navigating: boolean) => void;
  setError: (message: string) => void;
  start: () => void;
  setProgress: (progress: RouteProgress) => void;
  setArrived: () => void;
  clear: () => void;
}

export const useNavStore = create<NavState>()((set) => ({
  destination: null,
  route: null,
  progress: null,
  status: 'idle',
  error: null,
  routeVersion: 0,
  candidates: [],

  setDestination: (destination) => set({ destination, route: null, progress: null, status: 'idle', error: null, candidates: [] }),
  setCandidates: (candidates) => set({ candidates }),
  setRouting: () => set({ status: 'routing', error: null }),
  setRoute: (route, navigating) =>
    set((s) => ({
      route,
      progress: null,
      status: navigating ? 'navigating' : 'ready',
      routeVersion: s.routeVersion + 1,
    })),
  setError: (error) => set((s) => ({ error, status: s.route ? s.status : 'error' })),
  start: () => set({ status: 'navigating' }),
  setProgress: (progress) => set({ progress }),
  setArrived: () => set({ status: 'arrived' }),
  clear: () => set({ destination: null, route: null, progress: null, status: 'idle', error: null, candidates: [] }),
}));
