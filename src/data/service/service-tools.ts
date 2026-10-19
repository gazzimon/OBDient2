// log_service and read_service_log over the ServiceLog. The VIN is added when
// the adapter already read it; the car's name comes from the user.

import type { ToolCall, ToolOutcome } from '@/domain/assistant/tools';
import type { ServiceLog } from '@/domain/service/service-log';

export class ServiceTools {
  constructor(
    private readonly deps: {
      readonly log: ServiceLog;
      readonly vin: () => string | null;
      readonly now?: () => number;
      readonly newId?: () => string;
    },
  ) {}

  execute(call: Extract<ToolCall, { name: 'log_service' | 'read_service_log' }>): ToolOutcome {
    const now = this.deps.now ?? Date.now;
    if (call.name === 'log_service') {
      const at = now();
      const e = this.deps.log.add({
        id: this.deps.newId?.() ?? `s-${at.toString(36)}`,
        at,
        car: call.car,
        vin: this.deps.vin(),
        item: call.item,
        km: call.km,
        note: call.note,
      });
      return {
        ok: true,
        data: { saved: { car: e.car, vin: e.vin, item: e.item, km: e.km, date: day(e.at), note: e.note } },
        summary: `Anotado: ${e.item} (${e.car})`,
      };
    }
    const entries = this.deps.log.list(call.car).slice(0, 30);
    return {
      ok: true,
      data: {
        cars: this.deps.log.cars(),
        entries: entries.map((e) => ({ car: e.car, item: e.item, km: e.km, date: day(e.at), note: e.note })),
      },
      summary: entries.length ? `${entries.length} trabajos en el registro` : 'Registro de service vacío',
    };
  }
}

// "2026-10-19", in Argentina's time.
function day(at: number): string {
  return new Date(at - 3 * 3_600_000).toISOString().slice(0, 10);
}
