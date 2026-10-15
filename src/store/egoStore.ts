// Latest fused ego state and camera pose, published at the UI rate (~20 Hz).

import { create } from 'zustand';
import type { EgoState } from '@/domain/fusion/ego-estimator';
import type { LandscapeSide } from '@/domain/fusion/pose-estimator';

export interface PoseView {
  pitchDeg: number;
  rollDeg: number;
  side: LandscapeSide;
  motionShare: number;
}

export type SensorStatus = 'off' | 'starting' | 'ok' | 'denied' | 'unavailable';

interface EgoStoreState {
  ego: EgoState | null;
  pose: PoseView | null;
  location: SensorStatus;
  motion: SensorStatus;

  publish: (ego: EgoState | null, pose: PoseView | null) => void;
  setStatus: (patch: Partial<Pick<EgoStoreState, 'location' | 'motion'>>) => void;
}

export const useEgoStore = create<EgoStoreState>()((set) => ({
  ego: null,
  pose: null,
  location: 'off',
  motion: 'off',

  publish: (ego, pose) => set({ ego, pose }),
  setStatus: (patch) => set(patch),
}));
