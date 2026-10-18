// Trouble-code descriptions for the assistant: OBDex (CC0), checked against
// SAE J2012 at build time (scripts/build-dtc-base.py). Generic codes only;
// carmaker codes (P1xxx, B1xxx…) are not in it and stay undescribed.
//
// The base (~5 MB) ships as an asset and is read on first use, then kept.

import type { DtcDescriber, DtcInfo } from '@/data/obd/vehicle-tool-adapter';

// [title, summary, [[likelihood h|m|l, cause]], [symptoms], [difficulty, [min, max] €], confidence c|u|l]
type Row = [string, string, [string, string][], string[], [string | null, [number, number] | null], 'c' | 'u' | 'l'];

export interface DtcBase {
  readonly meta: { readonly source: string; readonly built: string };
  readonly codes: Readonly<Record<string, Row>>;
}

const LIKELIHOOD = { h: 'high', m: 'medium', l: 'low' } as const;
const RELIABILITY = { c: 'checked', u: 'unchecked', l: 'low' } as const;

export function lookup(base: DtcBase, code: string): DtcInfo | null {
  const row = base.codes[code];
  if (!row) return null;
  const [title, summary, causes, symptoms, [difficulty, cost], confidence] = row;
  return {
    title,
    summary,
    causes: causes.map(([l, cause]) => ({ likelihood: LIKELIHOOD[l as keyof typeof LIKELIHOOD] ?? 'medium', cause })),
    symptoms,
    repair: difficulty ? { difficulty, costEur: cost } : null,
    reliability: RELIABILITY[confidence],
  };
}

// Loads once; a failed load is retried on the next call.
export class DtcBaseDescriber implements DtcDescriber {
  private base: Promise<DtcBase> | null = null;

  constructor(private readonly load: () => Promise<DtcBase>) {}

  async describe(code: string): Promise<DtcInfo | null> {
    this.base ??= this.load().catch((err: unknown) => {
      this.base = null;
      throw err;
    });
    try {
      return lookup(await this.base, code);
    } catch {
      return null; // without the base the assistant still gets the code and its class
    }
  }
}
