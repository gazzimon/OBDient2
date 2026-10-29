// The car as the assistant sees it: run a validated tool call against the OBD
// session. The data layer implements it on top of ObdSession (milestone M2).

import type { PidId } from '@/core/constants/pids';
import type { ToolCall, ToolOutcome } from '@/domain/assistant/tools';
import type { ScanProgressListener } from '@/domain/obd/module-scan';

export interface VehicleToolsPort {
  // What this car answers; drives the PID enum in the tool schemas.
  supportedPids(): readonly PidId[];
  // Never called with clear_dtcs before the user confirmed it (agent loop).
  execute(call: ToolCall, signal: AbortSignal, onProgress?: ScanProgressListener): Promise<ToolOutcome>;
}

// The on-screen confirmation for destructive calls (the clear-codes modal).
export interface ConfirmationPort {
  confirm(call: ToolCall): Promise<boolean>;
}
