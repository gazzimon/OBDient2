// What the detector sees, published for the AR view and the HUD (~15 Hz).

import { create } from 'zustand';
import type { DriverAlert } from '@/domain/perception/alerts';
import type { PerceivedObject } from '@/domain/perception/scene';

export type DetectorStatus = 'off' | 'loading' | 'running' | 'error';

export interface DetectorStats {
  // Model inference only, ms (median of the last frames).
  inferenceMs: number;
  // Whole camera-thread work per frame (sampling + inference + decode), ms.
  frameMs: number;
  // Processed frames per second.
  fps: number;
  delegate: string;
}

interface PerceptionState {
  status: DetectorStatus;
  error: string | null;
  objects: readonly PerceivedObject[];
  leadId: number | null;
  lastAlert: (DriverAlert & { at: number }) | null;
  stats: DetectorStats | null;

  setStatus: (status: DetectorStatus, error?: string | null) => void;
  publish: (objects: readonly PerceivedObject[], leadId: number | null, stats: DetectorStats) => void;
  setAlert: (alert: DriverAlert, at: number) => void;
  reset: () => void;
}

export const usePerceptionStore = create<PerceptionState>()((set) => ({
  status: 'off',
  error: null,
  objects: [],
  leadId: null,
  lastAlert: null,
  stats: null,

  setStatus: (status, error = null) => set({ status, error }),
  publish: (objects, leadId, stats) => set({ objects, leadId, stats }),
  setAlert: (alert, at) => set({ lastAlert: { ...alert, at } }),
  reset: () => set({ status: 'off', error: null, objects: [], leadId: null, lastAlert: null, stats: null }),
}));
