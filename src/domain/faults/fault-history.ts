// Fault history on the phone (ADR-0007 §5, M2.5): what codes each car had,
// when they appeared and went away, the freeze frames, and every clear.
//
// It keeps changes, not every read: reading the same codes again only moves
// "last seen" and the distance forward, so asking the assistant ten times a
// day does not bury the one day a code appeared. Keyed by VIN; null when the
// car did not give one. Synced to the account once login exists (ADR-0008).

import type { DtcKind } from '@/domain/assistant/tools';

export interface FaultCode {
  readonly code: string;
  // CAN ID or legacy address; null when read without headers (while moving).
  readonly ecu: string | null;
  readonly owner: 'standard' | 'manufacturer' | 'reserved' | 'unspecified';
}

interface Base {
  readonly at: number; // first seen, epoch ms
  readonly vin: string | null;
}

export type FaultEvent =
  | (Base & {
      readonly type: 'codes';
      readonly kind: DtcKind;
      readonly codes: readonly FaultCode[];
      readonly lastSeenAt: number;
      // Distance since codes were cleared, as the car reported it (0131).
      readonly distSinceClearKm: number | null;
    })
  | (Base & {
      readonly type: 'freeze_frame';
      readonly dtc: FaultCode;
      readonly values: Readonly<Record<string, { value: number; unit: string }>>;
    })
  | (Base & {
      readonly type: 'cleared';
      readonly ecus: readonly (string | null)[];
      readonly distSinceClearBeforeKm: number | null;
      // Stored codes on record just before the clear.
      readonly codesBefore: readonly FaultCode[];
    });

// Distributes the Omit over the union, so each event type keeps its fields.
type WithoutAuto<T> = T extends unknown ? Omit<T, 'at' | 'lastSeenAt'> : never;
export type FaultEventInput = WithoutAuto<FaultEvent>;

// Where the history lives: one JSON document (MMKV on the phone).
export interface FaultHistoryStorage {
  load(): string | null;
  save(json: string): void;
}

export const MAX_EVENTS = 500;

export class FaultHistory {
  private events: FaultEvent[];

  constructor(
    private readonly storage: FaultHistoryStorage,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.events = parse(storage.load());
  }

  record(input: FaultEventInput): void {
    const at = this.now();
    switch (input.type) {
      case 'codes': {
        const i = this.lastIndex((e) => e.type === 'codes' && e.vin === input.vin && e.kind === input.kind);
        const prev = i >= 0 ? (this.events[i] as Extract<FaultEvent, { type: 'codes' }>) : null;
        if (prev && sameCodes(prev.codes, input.codes)) {
          this.events[i] = { ...prev, lastSeenAt: at, distSinceClearKm: input.distSinceClearKm ?? prev.distSinceClearKm };
        } else {
          this.events.push({ ...input, at, lastSeenAt: at });
        }
        break;
      }
      case 'freeze_frame': {
        const prev = this.last((e) => e.type === 'freeze_frame' && e.vin === input.vin);
        if (prev?.type === 'freeze_frame' && prev.dtc.code === input.dtc.code && sameValues(prev.values, input.values)) return;
        this.events.push({ ...input, at });
        break;
      }
      case 'cleared': {
        const stored = this.last((e) => e.type === 'codes' && e.vin === input.vin && e.kind === 'stored');
        const codesBefore = input.codesBefore.length ? input.codesBefore : stored?.type === 'codes' ? stored.codes : [];
        this.events.push({ ...input, codesBefore, at });
        break;
      }
    }
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    this.storage.save(JSON.stringify(this.events));
  }

  // Newest first; one car, or all of them.
  list(vin?: string | null): readonly FaultEvent[] {
    const mine = vin === undefined ? this.events : this.events.filter((e) => e.vin === vin);
    return [...mine].reverse();
  }

  // For the clear confirmation: when this car's codes were last erased.
  lastClear(vin: string | null): Extract<FaultEvent, { type: 'cleared' }> | null {
    const e = this.last((x) => x.type === 'cleared' && x.vin === vin);
    return e?.type === 'cleared' ? e : null;
  }

  private last(match: (e: FaultEvent) => boolean): FaultEvent | undefined {
    const i = this.lastIndex(match);
    return i >= 0 ? this.events[i] : undefined;
  }

  private lastIndex(match: (e: FaultEvent) => boolean): number {
    for (let i = this.events.length - 1; i >= 0; i--) if (match(this.events[i]!)) return i;
    return -1;
  }
}

// Same codes regardless of order. The ECU is ignored: the same code read
// while moving (no headers) and parked (with headers) is the same fault.
function sameCodes(a: readonly FaultCode[], b: readonly FaultCode[]): boolean {
  const key = (l: readonly FaultCode[]) => [...new Set(l.map((c) => c.code))].sort().join(',');
  return key(a) === key(b);
}

function sameValues(a: Readonly<Record<string, { value: number }>>, b: Readonly<Record<string, { value: number }>>): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.join() === kb.join() && ka.every((k) => a[k]!.value === b[k]!.value);
}

function parse(json: string | null): FaultEvent[] {
  if (!json) return [];
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? (v as FaultEvent[]) : [];
  } catch {
    return []; // a corrupt store must not take the assistant down with it
  }
}
