// What the app does with a message when the assistant cannot be reached (M4):
// a phrase it knows gets its tool and a fixed answer; anything else becomes a
// note with a snapshot of the car. No model, no network.

import type { PidId } from '@/core/constants/pids';
import type { VehicleToolsPort } from '@/domain/ports/vehicle-tools.port';
import { INTENT_CALL, routePhrase, type PhraseIntent } from './phrase-router';
import { intentAnswer, makeNote, NOTE_PIDS, snapshotCodes, snapshotValues, type CarSnapshot, type OfflineNote } from './offline';
import type { AssistantContext } from './prompt';
import type { ToolCall, ToolOutcome } from './tools';

// A read that does not answer in this time is left out of the note.
export const OFFLINE_READ_MS = 8_000;

const CAR_INTENTS: ReadonlySet<PhraseIntent> = new Set(['codes', 'battery', 'readiness', 'freeze_frame', 'vehicle_info']);

export type OfflineReply =
  | { readonly kind: 'answer'; readonly intent: PhraseIntent; readonly text: string }
  | { readonly kind: 'note'; readonly note: OfflineNote };

export class OfflineAssistant {
  constructor(private readonly tools: VehicleToolsPort) {}

  async handle(
    input: { readonly id: string; readonly at: number; readonly text: string; readonly photos: number },
    ctx: AssistantContext,
  ): Promise<OfflineReply> {
    const intent = input.photos === 0 ? routePhrase(input.text) : null;
    if (intent) {
      if (CAR_INTENTS.has(intent) && !ctx.connected) {
        return { kind: 'answer', intent, text: 'El adaptador no está conectado: conectalo desde la pestaña Vehículo.' };
      }
      return { kind: 'answer', intent, text: intentAnswer(intent, await this.run(INTENT_CALL[intent])) };
    }
    const text = input.photos ? `${input.text.trim()} (${input.photos === 1 ? 'adjuntó una foto' : `adjuntó ${input.photos} fotos`}, sin conexión no se pudo ver)`.trim() : input.text;
    return { kind: 'note', note: makeNote(input.id, input.at, text, ctx.moving, ctx.connected ? await this.snapshot() : null) };
  }

  // Codes and a few live values, what the car was saying when the driver wrote.
  private async snapshot(): Promise<CarSnapshot> {
    const supported = new Set<PidId>([...this.tools.supportedPids(), 'VOLTAGE']);
    const pids = NOTE_PIDS.filter((p) => supported.has(p));
    const codes = snapshotCodes(await this.run({ name: 'read_dtcs', kind: 'stored' }));
    const values = pids.length ? snapshotValues(await this.run({ name: 'read_pids', pids })) : null;
    return { codes, values };
  }

  private async run(call: ToolCall): Promise<ToolOutcome> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<ToolOutcome>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ ok: false, error: 'timeout', message: 'El auto no respondió a tiempo.' });
      }, OFFLINE_READ_MS);
    });
    try {
      return await Promise.race([this.tools.execute(call, controller.signal), late]);
    } catch {
      return { ok: false, error: 'timeout', message: 'El auto no respondió a tiempo.' };
    } finally {
      clearTimeout(timer);
    }
  }
}
