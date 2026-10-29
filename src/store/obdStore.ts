// Live OBD connection state and the latest telemetry.

import { create } from 'zustand';
import type { ObdParameter, ObdParameterSnapshot } from '@/domain/entities/obd-parameter';
import type { SessionInfo } from '@/data/obd/obd-session';
import type { RequestStyle } from '@/data/obd/telemetry-poller';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected';

interface OBDState {
  connectionState: ConnectionState;
  deviceName: string | null;
  session: SessionInfo | null;
  parameters: ObdParameterSnapshot;
  // Measured, not assumed: what the adapter actually delivers.
  speedRateHz: number;
  // How speed is being requested (fastest style the adapter accepted).
  requestStyle: RequestStyle | null;
  // Brown-out reboots of the adapter this session, recovered automatically.
  adapterResets: number;
  error: string | null;
  // The car's VIN once read (null: the car does not give it); undefined until then.
  vin: string | null | undefined;
  // Waiting to try the remembered adapter again (connection-keeper).
  retrying: boolean;
  // The user pressed "Desconectar": no retries until they connect again.
  stoppedByUser: boolean;

  setConnecting: (deviceName: string | null) => void;
  setConnected: (session: SessionInfo) => void;
  setDisconnected: (error?: string | null) => void;
  updateParameter: (param: ObdParameter) => void;
  setLinkStats: (stats: { hz: number; style: RequestStyle | null; resets: number }) => void;
  setVin: (vin: string | null) => void;
  setRetrying: (on: boolean) => void;
  setStoppedByUser: (on: boolean) => void;
}

export const useOBDStore = create<OBDState>()((set) => ({
  connectionState: 'disconnected',
  deviceName: null,
  session: null,
  parameters: {},
  speedRateHz: 0,
  requestStyle: null,
  adapterResets: 0,
  error: null,
  vin: undefined,
  retrying: false,
  stoppedByUser: false,

  setConnecting: (deviceName) =>
    set({ connectionState: 'connecting', deviceName, session: null, parameters: {}, error: null, vin: undefined }),
  setConnected: (session) => set({ connectionState: 'connected', session }),
  setDisconnected: (error = null) =>
    set({
      connectionState: 'disconnected',
      session: null,
      parameters: {},
      speedRateHz: 0,
      requestStyle: null,
      adapterResets: 0,
      error,
      vin: undefined,
    }),
  updateParameter: (param) => set((s) => ({ parameters: { ...s.parameters, [param.pid]: param } })),
  setLinkStats: ({ hz, style, resets }) => set({ speedRateHz: hz, requestStyle: style, adapterResets: resets }),
  setVin: (vin) => set({ vin }),
  setRetrying: (on) => set({ retrying: on }),
  setStoppedByUser: (on) => set({ stoppedByUser: on }),
}));
