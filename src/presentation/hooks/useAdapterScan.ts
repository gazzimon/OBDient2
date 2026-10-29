// Looking for an adapter and connecting to the one the user picks: shared by
// the Vehículo tab and the onboarding. While it looks, the remembered adapter
// is not retried (connection-keeper), so it does not grab the link.

import { useEffect, useRef, useState } from 'react';
import { container } from '@/data/container';
import type { ScannedDevice } from '@/data/adapters/ble-transport';
import { looksLikeObd } from '@/data/obd/obd-manager';
import { connectionKeeper } from '@/presentation/services/connection-keeper';
import { ensurePermission } from '@/presentation/services/permissions';

const SCAN_MS = 10_000;

export function useAdapterScan() {
  const [devices, setDevices] = useState<ScannedDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  // A scan ran and ended without any adapter-looking device.
  const [nothingFound, setNothingFound] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const stopScan = useRef<(() => void) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const found = useRef(false);

  const endScan = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    stopScan.current?.();
    stopScan.current = null;
    setScanning(false);
    connectionKeeper.hold(false);
  };

  const scan = async () => {
    if (!(await ensurePermission('bluetooth'))) return;
    setDevices([]);
    setScanError(null);
    setNothingFound(false);
    found.current = false;
    setScanning(true);
    connectionKeeper.hold(true);
    try {
      stopScan.current = await container.obd.scan((d) => {
        if (looksLikeObd(d.name)) found.current = true;
        setDevices((prev) => (prev.some((p) => p.id === d.id) ? prev : [...prev, d]));
      });
      timer.current = setTimeout(() => {
        endScan();
        setNothingFound(!found.current);
      }, SCAN_MS);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'No se pudo buscar');
      endScan();
    }
  };

  const connect = async (d: ScannedDevice) => {
    endScan();
    if (!(await ensurePermission('bluetooth'))) return;
    await connectionKeeper.userConnect(d.id, d.name).catch(() => undefined);
  };

  useEffect(() => endScan, []);

  // Adapters first, then anything with a name, unnamed last.
  const sorted = [...devices].sort(
    (a, b) => Number(looksLikeObd(b.name)) - Number(looksLikeObd(a.name)) || Number(b.name != null) - Number(a.name != null),
  );

  return { devices: sorted, scanning, nothingFound, scanError, scan, connect };
}
