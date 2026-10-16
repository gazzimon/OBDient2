// Generates realistic oscillating OBD values for emulator/demo use —
// the emulator has no Bluetooth, so the Dashboard is validated with this first.
// Goes through toParameter (the poller's own builder) so alert thresholds
// behave exactly like real data. Ported from OBDient.

import { useEffect, useState } from 'react';
import { toParameter } from '@/data/obd/telemetry-poller';
import type { ObdParameterSnapshot } from '@/domain/entities/obd-parameter';
import type { PidId } from '@/core/constants/pids';

interface MockProfile {
  base: number;
  // Oscillation amplitude around base
  amplitude: number;
  // Oscillation period in seconds
  periodS: number;
  // Random jitter added each tick
  jitter: number;
}

const PROFILES: Record<PidId, MockProfile> = {
  // Since-clear counters: monotonic odometers, not oscillating sensors. Flat
  // profiles so the demo shows a plausible history instead of a value that
  // swings up and down, which no counter ever does.
  ODOMETER:         { base: 87400, amplitude: 0, periodS: 1, jitter: 0 },
  DIST_SINCE_CLEAR: { base: 2400, amplitude: 0, periodS: 1, jitter: 0 },
  TIME_SINCE_CLEAR: { base: 5200, amplitude: 0, periodS: 1, jitter: 0 },
  DIST_WITH_MIL:    { base: 0,    amplitude: 0, periodS: 1, jitter: 0 },
  TIME_WITH_MIL:    { base: 0,    amplitude: 0, periodS: 1, jitter: 0 },
  RPM:             { base: 1900, amplitude: 1100, periodS: 8,  jitter: 90 },
  SPEED:           { base: 55,   amplitude: 35,   periodS: 14, jitter: 2 },
  COOLANT_TEMP:    { base: 88,   amplitude: 4,    periodS: 60, jitter: 0.5 },
  COOLANT_TEMP_SENSOR1: { base: 88, amplitude: 4, periodS: 60, jitter: 0.5 },
  ENGINE_LOAD:     { base: 45,   amplitude: 25,   periodS: 8,  jitter: 3 },
  MAF:             { base: 14,   amplitude: 9,    periodS: 8,  jitter: 1 },
  TPS:             { base: 30,   amplitude: 22,   periodS: 8,  jitter: 2 },
  IAT:             { base: 32,   amplitude: 3,    periodS: 40, jitter: 0.5 },
  VOLTAGE:         { base: 13.8, amplitude: 0.4,  periodS: 20, jitter: 0.05 },
  FUEL_TRIM_SHORT: { base: 0,    amplitude: 8,    periodS: 6,  jitter: 1 },
  FUEL_TRIM_LONG:  { base: 0,    amplitude: 3,    periodS: 30, jitter: 0.5 },
  TIMING_ADVANCE:  { base: 12,   amplitude: 5,    periodS: 8,  jitter: 0.5 },
  INTAKE_MAP:      { base: 35,   amplitude: 15,   periodS: 8,  jitter: 2 },
  O2_B1S1:         { base: 0.45, amplitude: 0.4,  periodS: 2,  jitter: 0.05 },
  O2_B1S2:         { base: 0.7,  amplitude: 0.1,  periodS: 10, jitter: 0.02 },
  RUN_TIME:        { base: 300,  amplitude: 0,    periodS: 60, jitter: 0 },
  FUEL_LEVEL:      { base: 65,   amplitude: 0,    periodS: 60, jitter: 0 },
  BAROMETRIC:      { base: 101,  amplitude: 0,    periodS: 60, jitter: 0.2 },
  CATALYST_TEMP:   { base: 450,  amplitude: 50,   periodS: 20, jitter: 5 },
  RELATIVE_TPS:    { base: 15,   amplitude: 12,   periodS: 8,  jitter: 1 },
  AMBIENT_TEMP:    { base: 25,   amplitude: 2,    periodS: 60, jitter: 0.3 },
};

// Coolant warm-up: reaches ~95% of operating temp after this many seconds
const WARMUP_SECONDS = 45;
const COLD_START_TEMP = 20;

function mockValue(pid: PidId, elapsedS: number): number {
  const p = PROFILES[pid];
  const wave = Math.sin((2 * Math.PI * elapsedS) / p.periodS);
  const noise = (Math.random() * 2 - 1) * p.jitter;
  let value = p.base + p.amplitude * wave + noise;

  if (pid === 'COOLANT_TEMP') {
    // Exponential warm-up curve from cold start to base temp
    const warmup = 1 - Math.exp((-3 * elapsedS) / WARMUP_SECONDS);
    value = COLD_START_TEMP + (p.base - COLD_START_TEMP) * warmup + noise;
  }

  // Round to match real-world parser precision
  return pid === 'VOLTAGE' ? Math.round(value * 10) / 10 : Math.round(value);
}

export function useMockParameters(intervalMs = 500): ObdParameterSnapshot {
  const [snapshot, setSnapshot] = useState<ObdParameterSnapshot>({});

  useEffect(() => {
    const startedAt = Date.now();

    const tick = () => {
      const elapsedS = (Date.now() - startedAt) / 1000;
      const next: ObdParameterSnapshot = {};
      for (const pid of Object.keys(PROFILES) as PidId[]) {
        next[pid] = toParameter(pid, mockValue(pid, elapsedS), Date.now());
      }
      setSnapshot(next);
    };

    tick();
    const handle = setInterval(tick, intervalMs);
    return () => clearInterval(handle);
  }, [intervalMs]);

  return snapshot;
}
