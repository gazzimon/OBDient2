// Diagnóstico's screens read the car with the assistant's own tools (2026-10-31):
// one implementation, the same answers in the chat and on screen, and the same
// policy (what pauses the telemetry is refused while moving or navigating, with
// the reason). Destructive calls ask with the same modal as the chat.
//
// The last results stay in memory for the grid's badges and for the chat's
// "Ver en Diagnóstico"; codes and module scans are kept on the phone by their
// own logs (fault history, ModuleScanLog).

import { create } from 'zustand';
import { container } from '@/data/container';
import { evaluatePolicy } from '@/domain/assistant/policy';
import type { ToolCall, ToolOutcome } from '@/domain/assistant/tools';
import type { VehicleToolProgressListener } from '@/domain/ports/vehicle-tools.port';
import { assistantContext } from '@/presentation/hooks/assistantContext';
import { screenConfirmation } from '@/store/confirmStore';

type Kept = 'read_readiness' | 'read_pids' | 'read_vehicle_info' | 'read_dtcs' | 'read_freeze_frame';

interface Reading {
  readonly outcome: ToolOutcome;
  readonly at: number;
}

// A code as read_dtcs describes it (the base on the phone), for its detail screen.
export interface DescribedDtc {
  readonly code: string;
  readonly ecu: string | null;
  readonly description: string | null;
  readonly causes?: readonly { readonly likelihood: 'high' | 'medium' | 'low'; readonly cause: string }[];
  readonly symptoms?: readonly string[];
}

interface CarReadsState {
  // The exclusive operation running (a scan, a clear), for "ocupado" on the grid.
  busy: string | null;
  last: Partial<Record<Kept, Reading>>;
  // Every code read this session, by code.
  codes: Readonly<Record<string, DescribedDtc>>;
}

export const useCarReads = create<CarReadsState>()(() => ({ busy: null, last: {}, codes: {} }));

// The tools that need the link alone for a while: one at a time.
const EXCLUSIVE: ReadonlySet<ToolCall['name']> = new Set(['scan_modules', 'did_probe', 'clear_dtcs', 'run_adapter_bench']);
const KEPT: ReadonlySet<ToolCall['name']> = new Set(['read_readiness', 'read_pids', 'read_vehicle_info', 'read_dtcs', 'read_freeze_frame']);

export async function readCar(call: ToolCall, signal: AbortSignal = new AbortController().signal, onProgress?: VehicleToolProgressListener): Promise<ToolOutcome> {
  const ctx = assistantContext();
  const decision = evaluatePolicy(call, { moving: ctx.moving, navigating: ctx.navigating, labMode: ctx.labMode, clearsThisConversation: 0 });
  if (decision.kind === 'deny') return { ok: false, error: decision.error, message: decision.message };
  if (decision.kind === 'confirm' && !(await screenConfirmation.confirm(call))) return { ok: false, error: 'cancelled', message: 'Cancelado.' };
  const exclusive = EXCLUSIVE.has(call.name);
  if (exclusive) {
    const busy = useCarReads.getState().busy;
    if (busy) return { ok: false, error: 'busy', message: `Ocupado: ${busy}. Esperá que termine.` };
    useCarReads.setState({ busy: BUSY_LABEL[call.name] ?? call.name });
  }
  try {
    const outcome = await container.vehicleTools.execute(call, signal, onProgress);
    if (KEPT.has(call.name)) useCarReads.setState((s) => ({ last: { ...s.last, [call.name]: { outcome, at: Date.now() } } }));
    if (call.name === 'read_dtcs' && outcome.ok) {
      const read = ((outcome.data as { codes?: DescribedDtc[] }).codes ?? []).map((c) => [c.code, c] as const);
      useCarReads.setState((s) => ({ codes: { ...s.codes, ...Object.fromEntries(read) } }));
    }
    // What a scan found goes to the lab as from the chat (Ajustes › Privacidad decides).
    if (outcome.ok && outcome.knowledge) container.reportKnowledge(outcome.knowledge);
    return outcome;
  } finally {
    if (exclusive) useCarReads.setState({ busy: null });
  }
}

const BUSY_LABEL: Partial<Record<ToolCall['name'], string>> = {
  scan_modules: 'escaneando módulos',
  did_probe: 'leyendo DIDs',
  clear_dtcs: 'borrando códigos',
  run_adapter_bench: 'probando el adaptador',
};
