// Live OBD connection state and the latest telemetry.

import { create } from 'zustand';
import type { ObdParameter, ObdParameterSnapshot } from '@/domain/entities/obd-parameter';
import type { SessionInfo } from '@/data/obd/obd-session';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected';

interface OBDState {
  connectionState: ConnectionState;
  deviceName: string | null;
  session: SessionInfo | null;
  parameters: ObdParameterSnapshot;
  // Measured, not assumed: what the adapter actually delivers.
  speedRateHz: number;
  error: string | null;

  setConnecting: (deviceName: string | null) => void;
  setConnected: (session: SessionInfo) => void;
  setDisconnected: (error?: string | null) => void;
  updateParameter: (param: ObdParameter) => void;
  setSpeedRate: (hz: number) => void;
}

export const useOBDStore = create<OBDState>()((set) => ({
  connectionState: 'disconnected',
  deviceName: null,
  session: null,
  parameters: {},
  speedRateHz: 0,
  error: null,

  setConnecting: (deviceName) =>
    set({ connectionState: 'connecting', deviceName, session: null, parameters: {}, error: null }),
  setConnected: (session) => set({ connectionState: 'connected', session }),
  setDisconnected: (error = null) =>
    set({ connectionState: 'disconnected', session: null, parameters: {}, speedRateHz: 0, error }),
  updateParameter: (param) => set((s) => ({ parameters: { ...s.parameters, [param.pid]: param } })),
  setSpeedRate: (hz) => set({ speedRateHz: hz }),
}));
