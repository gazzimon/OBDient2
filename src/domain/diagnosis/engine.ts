// Root causes with weighted evidence (2026-10-28): what is most likely wrong,
// from what the car says (codes, live values, its own baseline) and what the
// driver says (symptoms). Deterministic and offline: the assistant gets the
// ranking as one more fact, and without the server it is the answer itself.
//
// Each cause lists indicators; each indicator that holds adds its weight, a
// symptom the driver denies takes it away. The score alone favours causes
// with many indicators, so the ranking uses the share of the weight that
// could be checked: a cause whose only measurable indicator held ranks above
// one that matched one symptom out of six. What could not be checked (the PID
// was not read, the engine was cold) is listed as the next thing to measure.
//
// The structure follows the weighted-indicator idea seen in other scan tools;
// the causes, weights and texts are ours (root-causes.ts).

import type { PidId } from '@/core/constants/pids';
import type { BaselineMetric, Deviation } from '@/domain/vehicle/baseline';

export type Stat = 'mean' | 'min' | 'max' | 'range';
export type Op = '>' | '>=' | '<' | '<=';

export interface Condition {
  readonly pid: PidId;
  readonly stat: Stat;
  readonly op: Op;
  readonly value: number;
}

export type Indicator =
  // Any of these codes, stored or pending. A code ending in "*" is a prefix.
  | { readonly kind: 'dtc'; readonly codes: readonly string[]; readonly weight: number; readonly text: string }
  // A live value, measured over a few seconds, optionally only when `when` holds
  // (engine warm, at idle…). Without the PIDs it cannot be checked.
  | ({ readonly kind: 'sensor'; readonly weight: number; readonly text: string; readonly when?: readonly Condition[] } & Condition)
  // The sum of two means (short + long fuel trim).
  | { readonly kind: 'sensor_sum'; readonly pids: readonly [PidId, PidId]; readonly op: Op; readonly value: number; readonly weight: number; readonly text: string; readonly when?: readonly Condition[] }
  // A symptom id from symptoms.ts.
  | { readonly kind: 'symptom'; readonly symptom: string; readonly weight: number; readonly text: string }
  // This car's own history says the value is unusually high or low.
  | { readonly kind: 'baseline'; readonly metric: BaselineMetric; readonly direction: 'high' | 'low'; readonly weight: number; readonly text: string };

export type CarSystem =
  | 'motor'
  | 'combustible'
  | 'encendido'
  | 'admisión'
  | 'escape y emisiones'
  | 'refrigeración'
  | 'eléctrico'
  | 'transmisión'
  | 'frenos'
  | 'tren delantero y suspensión'
  | 'dirección'
  | 'climatización'
  | 'seguridad'
  | 'comunicación';

export interface RootCause {
  readonly id: string;
  readonly title: string;
  readonly system: CarSystem;
  // What to check or do, most useful first.
  readonly checks: readonly string[];
  // Driving on is risky: the answer says so first.
  readonly safety?: string;
  readonly indicators: readonly Indicator[];
}

export type Readings = Partial<Record<PidId, { readonly mean: number; readonly min: number; readonly max: number; readonly n: number }>>;

export interface DiagnosisInput {
  // Stored and pending codes.
  readonly codes: readonly string[];
  readonly readings: Readings;
  readonly symptoms: readonly string[];
  readonly denied: readonly string[];
  readonly deviations: readonly Deviation[];
  // Metrics this car has enough history for and this session measured: only
  // those can say "usual". The rest are skipped, not counted against.
  readonly comparable: readonly BaselineMetric[];
  // The OBD was read at all: without it, code and sensor indicators are
  // unknown, not absent.
  readonly carRead: boolean;
}

export interface Hypothesis {
  readonly id: string;
  readonly title: string;
  readonly system: CarSystem;
  // 0–100: the share of the checkable weight that held.
  readonly confidence: number;
  readonly score: number;
  readonly evidence: readonly string[];
  readonly against: readonly string[];
  // Indicators that could not be checked: what to measure or ask next.
  readonly toCheck: readonly string[];
  readonly checks: readonly string[];
  readonly safety: string | null;
}

// Below this score a cause is noise (one weak symptom).
export const MIN_SCORE = 25;
export const MAX_HYPOTHESES = 5;

// skip: not knowable here and not worth asking for (a baseline still too short).
type Verdict = 'yes' | 'no' | 'denied' | 'unknown' | 'skip';

export function diagnose(causes: readonly RootCause[], input: DiagnosisInput): Hypothesis[] {
  const out: Hypothesis[] = [];
  for (const cause of causes) {
    let score = 0;
    let checkable = 0;
    const evidence: string[] = [];
    const against: string[] = [];
    const toCheck: string[] = [];
    for (const ind of cause.indicators) {
      const v = verdict(ind, input);
      if (v === 'skip') continue;
      if (v === 'unknown') {
        toCheck.push(ind.text);
        continue;
      }
      checkable += ind.weight;
      if (v === 'yes') {
        score += ind.weight;
        evidence.push(ind.text);
      } else if (v === 'denied') {
        score -= ind.weight;
        against.push(`no: ${ind.text}`);
      }
    }
    if (score < MIN_SCORE || checkable === 0) continue;
    out.push({
      id: cause.id,
      title: cause.title,
      system: cause.system,
      confidence: Math.round((100 * score) / checkable),
      score,
      evidence,
      against,
      toCheck,
      checks: cause.checks,
      safety: cause.safety ?? null,
    });
  }
  // A safety cause with the same confidence goes first.
  return out
    .sort((a, b) => b.confidence - a.confidence || b.score - a.score || Number(!!b.safety) - Number(!!a.safety))
    .slice(0, MAX_HYPOTHESES);
}

function verdict(ind: Indicator, input: DiagnosisInput): Verdict {
  switch (ind.kind) {
    case 'dtc':
      if (!input.carRead) return 'unknown';
      return input.codes.some((c) => ind.codes.some((p) => matchesCode(c, p))) ? 'yes' : 'no';
    case 'symptom':
      if (input.symptoms.includes(ind.symptom)) return 'yes';
      if (input.denied.includes(ind.symptom)) return 'denied';
      // Not mentioned: neither for nor against, and not worth "measuring".
      return 'no';
    case 'baseline': {
      const d = input.deviations.find((x) => x.metric === ind.metric);
      if (d) return d.direction === ind.direction ? 'yes' : 'no';
      return input.comparable.includes(ind.metric) ? 'no' : 'skip';
    }
    case 'sensor': {
      const guard = conditions(ind.when, input.readings);
      if (guard !== 'yes') return guard === 'no' ? 'no' : 'unknown';
      const v = statOf(input.readings, ind.pid, ind.stat);
      return v == null ? 'unknown' : compare(v, ind.op, ind.value) ? 'yes' : 'no';
    }
    case 'sensor_sum': {
      const guard = conditions(ind.when, input.readings);
      if (guard !== 'yes') return guard === 'no' ? 'no' : 'unknown';
      const a = statOf(input.readings, ind.pids[0], 'mean');
      const b = statOf(input.readings, ind.pids[1], 'mean');
      return a == null || b == null ? 'unknown' : compare(a + b, ind.op, ind.value) ? 'yes' : 'no';
    }
  }
}

// All of them hold → yes; one fails → no (the indicator does not apply now);
// one cannot be read → unknown.
function conditions(when: readonly Condition[] | undefined, r: Readings): 'yes' | 'no' | 'unknown' {
  if (!when) return 'yes';
  let unknown = false;
  for (const c of when) {
    const v = statOf(r, c.pid, c.stat);
    if (v == null) unknown = true;
    else if (!compare(v, c.op, c.value)) return 'no';
  }
  return unknown ? 'unknown' : 'yes';
}

function statOf(r: Readings, pid: PidId, stat: Stat): number | null {
  const x = r[pid];
  if (!x || x.n === 0) return null;
  return stat === 'range' ? x.max - x.min : x[stat];
}

function compare(v: number, op: Op, ref: number): boolean {
  switch (op) {
    case '>':
      return v > ref;
    case '>=':
      return v >= ref;
    case '<':
      return v < ref;
    case '<=':
      return v <= ref;
  }
}

export function matchesCode(code: string, pattern: string): boolean {
  return pattern.endsWith('*') ? code.startsWith(pattern.slice(0, -1)) : code === pattern;
}

// The PIDs the causes read: what the diagnosis samples.
export function pidsUsed(causes: readonly RootCause[]): PidId[] {
  const set = new Set<PidId>();
  for (const c of causes) {
    for (const ind of c.indicators) {
      if (ind.kind === 'sensor') set.add(ind.pid);
      if (ind.kind === 'sensor_sum') ind.pids.forEach((p) => set.add(p));
      if (ind.kind === 'sensor' || ind.kind === 'sensor_sum') ind.when?.forEach((w) => set.add(w.pid));
    }
  }
  return [...set];
}

// The ranking as plain text, for the offline answer and the report.
export function hypothesesText(list: readonly Hypothesis[]): string {
  if (list.length === 0) return 'Con lo que hay no aparece una causa clara. Contame qué notás (ruidos, olores, testigos) o conectá el adaptador para medir.';
  const lines = list.map((h, i) => {
    const parts = [`${i + 1}. ${h.title} (${h.system}, ${h.confidence}%)`];
    if (h.safety) parts.push(`   ⚠ ${h.safety}`);
    if (h.evidence.length) parts.push(`   Por: ${h.evidence.join('; ')}.`);
    if (h.checks.length) parts.push(`   Revisar: ${h.checks[0]}.`);
    return parts.join('\n');
  });
  return ['Lo más probable, de más a menos:', ...lines, 'Es una orientación, no reemplaza la revisión de un mecánico.'].join('\n');
}
