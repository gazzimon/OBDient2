// What a module scan found, and how far it looked (2026-10-29). A scan never
// proves it saw every module: it saw the ones that answered on the buses and
// addresses this adapter could try. So the report keeps the coverage next to
// the findings — which buses were tried, which addresses stayed silent, whether
// the make's own addresses were there — and the screen shows that instead of
// a model's summary of it.
//
// The report is folded from the scan's progress events, the same ones the chat
// shows: what the screen draws live and what is saved at the end cannot drift
// apart. Kept on the phone (works offline, ADR-0001), a few per car; the VIN
// stays local, the lab's record is built from the report without it (ADR-0011).

import { redactText } from '@/domain/privacy/redact';
import type { Bus, ScanPath, ScanProgressEvent, ScanTarget } from './module-scan';

// scanned: its addresses were tried · unavailable: this adapter cannot switch to
// it · not-tested: this adapter or path does not try it (or the scan stopped first).
export type BusStatus = 'scanned' | 'unavailable' | 'not-tested';

export const BUSES: readonly Bus[] = ['HS', 'MS', 'SW'];

export interface BusCoverage {
  readonly bus: Bus;
  readonly status: BusStatus;
  // Addresses tried on this bus, and the ones nothing answered at (usually no
  // module lives there; that is not a failure).
  readonly probed: number;
  readonly silent: readonly string[];
}

export interface ScannedModule extends ScanTarget {
  readonly bus: Bus;
  // `label` is a guess from the address; the module's own answer is the identity.
  // Null until identified, and when it gave none (F187 and F190 both refused).
  readonly partNumber: string | null;
  readonly identitySource: 'F187' | 'F190' | null;
  readonly identified: boolean;
}

// The make's own addresses (ABS, airbag, body…): OBD's generic ones only reach
// engine and gearbox, so without these the scan is the generic one.
//   loaded: the lab had some · none: it had none for this make · failed: it could
//   not be asked (offline) · no-make: the make was not known (no VIN, none given).
export type MakeAddresses = 'loaded' | 'none' | 'failed' | 'no-make';

// While the scan runs.
export interface ScanState {
  readonly buses: readonly BusCoverage[];
  readonly modules: readonly ScannedModule[];
  // The bus being swept and how far; null between buses and when done.
  readonly current: { readonly bus: Bus; readonly completed: number; readonly total: number } | null;
  readonly warning: string | null;
  readonly finished: boolean;
}

export interface ModuleScanReport {
  readonly version: 1;
  readonly at: number;
  readonly vin: string | null;
  readonly make: string | null;
  readonly model: string | null;
  readonly protocol: string;
  readonly adapter: string;
  readonly path: ScanPath;
  readonly makeAddresses: { readonly status: MakeAddresses; readonly count: number };
  // Known addresses left out: the other ID width than the car's, or past the cap.
  readonly skipped: { readonly otherWidth: number; readonly overLimit: number };
  readonly warning: string | null;
  readonly buses: readonly BusCoverage[];
  readonly modules: readonly ScannedModule[];
}

export function initialScanState(): ScanState {
  return { buses: BUSES.map((bus) => ({ bus, status: 'not-tested', probed: 0, silent: [] })), modules: [], current: null, warning: null, finished: false };
}

export function applyScanEvent(state: ScanState, event: ScanProgressEvent): ScanState {
  const bus = (b: Bus, f: (c: BusCoverage) => BusCoverage) => state.buses.map((c) => (c.bus === b ? f(c) : c));
  switch (event.type) {
    case 'scan-started':
      return state;
    case 'lookup-warning':
      return { ...state, warning: event.message };
    case 'bus-skipped':
      return { ...state, buses: bus(event.bus, (c) => ({ ...c, status: event.status })) };
    case 'bus-started':
      return { ...state, buses: bus(event.bus, (c) => ({ ...c, status: 'scanned' })), current: { bus: event.bus, completed: 0, total: event.totalTargets } };
    case 'target-checked':
      return {
        ...state,
        buses: bus(event.bus, (c) => ({ ...c, probed: c.probed + 1, silent: event.responded ? c.silent : [...c.silent, event.targetId] })),
        current: { bus: event.bus, completed: event.completed, total: event.total },
      };
    case 'module-found': {
      const { id, reqHeader, rxHeader, label } = event.module;
      if (state.modules.some((m) => m.bus === event.bus && m.id === id)) return state;
      return { ...state, modules: [...state.modules, { id, reqHeader, rxHeader, label, bus: event.bus, partNumber: null, identitySource: null, identified: false }] };
    }
    case 'module-identified':
      return { ...state, modules: state.modules.map((m) => (m.bus === event.bus && m.id === event.moduleId ? { ...m, identitySource: event.source, identified: event.source != null } : m)) };
    case 'bus-finished':
      return { ...state, current: null };
    case 'scan-finished':
      return { ...state, current: null, finished: true };
  }
}

// The part numbers are not in the progress events (the chat keeps those, and an
// F190 answer is a VIN): the scan hands them over here, keyed "<bus>:<id>".
export function finishReport(
  state: ScanState,
  meta: Omit<ModuleScanReport, 'version' | 'buses' | 'modules' | 'warning'>,
  partNumbers: ReadonlyMap<string, string>,
): ModuleScanReport {
  return {
    version: 1,
    ...meta,
    warning: state.warning,
    buses: state.buses,
    modules: state.modules.map((m) => {
      const partNumber = partNumbers.get(`${m.bus}:${m.id}`) ?? null;
      return { ...m, partNumber, identified: partNumber != null };
    }),
  };
}

// What the lab keeps of a scan: what the car is and which modules answer where,
// never which car — no VIN, and a part number that is one (F190) masked.
// Null without a make: the lab keys its facts by make.
export function knowledgeRecord(report: ModuleScanReport): Record<string, unknown> | null {
  if (!report.make) return null;
  return {
    make: report.make,
    ...(report.model ? { model: report.model } : {}),
    protocol: report.protocol,
    modules: report.modules.map((m) => ({ id: m.id, bus: m.bus, reqHeader: m.reqHeader, rxHeader: m.rxHeader, label: m.label, partNumber: m.partNumber == null ? null : redactText(m.partNumber) })),
  };
}

// ── Kept on the phone ────────────────────────────────────────────────────────

export interface ModuleScanStorage {
  load(): ModuleScanReport[];
  save(reports: readonly ModuleScanReport[]): void;
}

// Enough to compare a scan with the ones before; a car without VIN is one more car.
export const MAX_REPORTS_PER_CAR = 5;
export const MAX_REPORTS = 40;

export class ModuleScanLog {
  constructor(private readonly storage: ModuleScanStorage) {}

  add(report: ModuleScanReport): void {
    const all = this.storage.load().filter((r) => r.version === 1);
    const same = all.filter((r) => r.vin === report.vin).slice(0, MAX_REPORTS_PER_CAR - 1);
    const others = all.filter((r) => r.vin !== report.vin);
    this.storage.save([report, ...same, ...others].sort((a, b) => b.at - a.at).slice(0, MAX_REPORTS));
  }

  // Newest first.
  forVin(vin: string | null): ModuleScanReport[] {
    return this.storage.load().filter((r) => r.version === 1 && r.vin === vin);
  }

  latest(): ModuleScanReport | null {
    return this.storage.load().find((r) => r.version === 1) ?? null;
  }

  clear(): void {
    this.storage.save([]);
  }
}
