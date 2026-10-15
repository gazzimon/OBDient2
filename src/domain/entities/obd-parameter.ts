// A single real-time OBD-II parameter reading at a point in time.

import type { PidId, AlertSeverity } from '@/core/constants/pids';

export interface ObdParameter {
  readonly pid: PidId;
  readonly name: string;
  readonly value: number;
  readonly unit: string;
  readonly timestamp: Date;
  // null means the value is within normal range
  readonly alert: ObdAlert | null;
}

export interface ObdAlert {
  readonly severity: AlertSeverity;
  readonly message: string;
}

// Snapshot of all currently monitored PIDs, keyed by PidId
export type ObdParameterSnapshot = Partial<Record<PidId, ObdParameter>>;
