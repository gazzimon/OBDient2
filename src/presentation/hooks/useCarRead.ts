// A Diagnóstico screen's reading: the last one kept (shown at once), a fresh one
// each time the screen shows with the adapter connected, and "leer de nuevo".

import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import type { ToolCall, ToolOutcome } from '@/domain/assistant/tools';
import { readCar, useCarReads } from '@/presentation/services/car-reads';
import { useOBDStore } from '@/store/obdStore';

type KeptCall = Extract<ToolCall, { name: 'read_readiness' | 'read_pids' | 'read_vehicle_info' | 'read_dtcs' | 'read_freeze_frame' }>;

export function useCarRead(call: KeptCall) {
  const connected = useOBDStore((s) => s.connectionState === 'connected');
  const kept = useCarReads((s) => s.last[call.name]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(call);

  const read = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const out: ToolOutcome = await readCar(call);
      if (!out.ok) setError(out.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Each time the screen shows (and when the adapter connects).
  useFocusEffect(
    useCallback(() => {
      if (connected) void read();
    }, [connected, read]),
  );

  const data = kept?.outcome.ok ? (kept.outcome.data as Record<string, unknown>) : null;
  return { data, at: kept?.at ?? null, loading, error: connected ? error : data ? null : 'Conectá el adaptador para leer el auto.', read, connected };
}
