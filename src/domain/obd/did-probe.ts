// Pure core of the lab's DID probe (docs/plans/herramienta-did-probe.md): which
// requests it may send, how each answer is read, when it must stop, and what the
// module's answers say about the link. Nothing here touches the adapter.
//
// The question it answers: when a `22 xxxx` gets no data, is the adapter or our
// software at fault, or does the DID simply not exist in that module? A `7F`
// from the module proves the path works; silence does not.

import type { EcuMessage } from '@/core/utils/obdFrames';
import { vinFromBytes } from '@/domain/privacy/redact';
import { classifyCommand } from './uds-safety';
import { didCatalogEntry, type DidCatalogEntry, type DidEvidence } from './did-catalog';

// ── What may be sent ────────────────────────────────────────────────────────
// Narrower than classifyCommand, which also lets 19, 23, 24 and 2A through: a
// probe reads one DID at a time (22), asks "are you there" (3E 00) and reads the
// stored codes (03) before and after, to see whether it left a trace. Adapter
// settings (AT/ST) pass the same check as the free command tool.

const DID = /^[0-9A-F]{4}$/;
const PROBE_FRAMES = [/^22[0-9A-F]{4}$/, /^3E00$/, /^03$/];

export const normalizeDid = (did: string): string | null => {
  const d = did.replace(/^0x/i, '').replace(/\s+/g, '').toUpperCase();
  return DID.test(d) ? d : null;
};

export function isProbeCommand(command: string): boolean {
  const c = command.replace(/\s+/g, '').toUpperCase();
  if (/^[0-9A-F]+$/.test(c)) return PROBE_FRAMES.some((re) => re.test(c));
  const verdict = classifyCommand(c);
  return verdict.ok && (verdict.kind === 'at' || verdict.kind === 'st');
}

export const didRequest = (did: string): string => `22${did}`;

// ── What to read ────────────────────────────────────────────────────────────

// ISO 14229-1 identification DIDs: any UDS module should answer these.
// F186 active session, F187 part number, F189 software version, F18C serial, F190 VIN.
export const CONTROL_DIDS: readonly string[] = ['F190', 'F187', 'F189', 'F18C', 'F186'];

export const DEFAULT_RANGE = { from: 'F100', to: 'F1FF' } as const;
export const MAX_DIDS_PER_CALL = 512;
export const MAX_LIST = 32;

// F180–F19F: VIN, part and serial numbers. Their values are never kept.
export const isIdentificationDid = (did: string): boolean => {
  const n = parseInt(did, 16);
  return n >= 0xf180 && n <= 0xf19f;
};

export type PlanResult = { readonly ok: true; readonly dids: readonly string[]; readonly outsideDefault: boolean } | { readonly ok: false; readonly message: string };

export function rangePlan(from: string, to: string): PlanResult {
  const a = normalizeDid(from);
  const b = normalizeDid(to);
  if (!a || !b) return { ok: false, message: 'El rango va de un DID a otro, de 4 dígitos hexadecimales (p. ej. F100 a F1FF).' };
  const lo = parseInt(a, 16);
  const hi = parseInt(b, 16);
  if (hi < lo) return { ok: false, message: 'El rango va al revés: el primer DID tiene que ser el menor.' };
  if (hi - lo + 1 > MAX_DIDS_PER_CALL) return { ok: false, message: `Un barrido lee hasta ${MAX_DIDS_PER_CALL} DIDs por vez; pedí un tramo más corto y seguí con el cursor.` };
  const dids = Array.from({ length: hi - lo + 1 }, (_, i) => (lo + i).toString(16).toUpperCase().padStart(4, '0'));
  return { ok: true, dids, outsideDefault: lo < parseInt(DEFAULT_RANGE.from, 16) || hi > parseInt(DEFAULT_RANGE.to, 16) };
}

export function listPlan(dids: readonly string[]): PlanResult {
  const seen = new Set<string>();
  for (const raw of dids) {
    const d = normalizeDid(raw);
    if (!d) return { ok: false, message: `«${raw}» no es un DID: son 4 dígitos hexadecimales (p. ej. F190).` };
    seen.add(d);
  }
  if (seen.size === 0) return { ok: false, message: 'La lista de DIDs está vacía.' };
  if (seen.size > MAX_LIST) return { ok: false, message: `Una lista lleva hasta ${MAX_LIST} DIDs; para más, un barrido por rango.` };
  return { ok: true, dids: [...seen], outsideDefault: [...seen].some((d) => parseInt(d, 16) < 0xf100 || parseInt(d, 16) > 0xf1ff) };
}

// ── How an answer is read ───────────────────────────────────────────────────

export type DidOutcome =
  | 'supported' // 62 HH HH …
  | 'unsupported' // 7F 22 31: the module answered, the DID is not there
  | 'locked' // 7F 22 33: it needs security access (never attempted)
  | 'needs_conditions' // 7F 22 22: not today (session, engine, speed)
  | 'service_refused' // 7F 22 11 / 12 / 7E / 7F: the module has no such service here
  | 'bad_request' // 7F 22 13: length or format
  | 'other_refusal' // any other 7F 22 NN
  | 'pending' // 7F 22 78: still working
  | 'incomplete' // frames missing: the adapter did not reassemble
  | 'mismatch' // it answered, but for another DID
  | 'silent'; // nobody answered

// What each outcome means, in the words the chat shows.
export const DID_OUTCOME_TEXT: Readonly<Record<DidOutcome, string>> = {
  supported: 'responde',
  unsupported: 'no existe',
  locked: 'bloqueado (pide acceso de seguridad)',
  needs_conditions: 'no disponible ahora',
  service_refused: 'servicio rechazado',
  bad_request: 'pedido inválido',
  other_refusal: 'rechazado',
  pending: 'sigue procesando',
  incomplete: 'respuesta incompleta',
  mismatch: 'respondió otro DID',
  silent: 'sin respuesta',
};

// Progress intentionally contains no DID value or raw response bytes.
export interface DidProbeProgressEvent {
  readonly type: 'did-probe-progress';
  readonly reqHeader: string;
  readonly completed: number;
  readonly total: number;
  readonly did: string;
  readonly outcome: DidOutcome;
}

export interface ProbeResult {
  readonly did: string;
  readonly outcome: DidOutcome;
  // What the DID is and how far that is known (did-catalog.ts): only what the
  // model needs, the rest of the entry (source, license, description) stays there.
  // A candidate has no name: it answered, its meaning is still unknown.
  readonly catalog?: {
    readonly name: string | null;
    readonly privacy: DidCatalogEntry['privacy'] | 'unknown';
    readonly evidence: DidEvidence;
  };
  readonly nrc?: string;
  // Data bytes of a supported DID.
  readonly length?: number;
  // First bytes of the value, never for identification DIDs and never a VIN.
  readonly sample?: string;
}

const NRC_OUTCOME: Readonly<Record<string, DidOutcome>> = {
  '31': 'unsupported',
  '33': 'locked',
  '22': 'needs_conditions',
  '11': 'service_refused',
  '12': 'service_refused',
  '7E': 'service_refused',
  '7F': 'service_refused',
  '13': 'bad_request',
  '78': 'pending',
};

const SAMPLE_BYTES = 8;
const hex2 = (b: number): string => b.toString(16).toUpperCase().padStart(2, '0');

// The value kept for later: a few bytes, except for identification DIDs (their
// values are the car's identity) and any value that is a VIN.
export function sampleOf(did: string, data: readonly number[]): string | undefined {
  if (isIdentificationDid(did) || data.length === 0) return undefined;
  if (vinFromBytes(data) != null || vinFromBytes(data.slice(-17)) != null) return undefined;
  return data.slice(0, SAMPLE_BYTES).map(hex2).join(' ');
}

// `messages` as the frame reader assembled them; `rx` filters by the module's
// answering ID when it is known (another module's answer is not this one's).
const mineOf = (messages: readonly EcuMessage[], rx: string | null) => (rx ? messages.filter((m) => m.ecu == null || m.ecu.toUpperCase() === rx.toUpperCase()) : messages);

function positiveOf(did: string, mine: readonly EcuMessage[]): EcuMessage | undefined {
  const hi = parseInt(did.slice(0, 2), 16);
  const lo = parseInt(did.slice(2), 16);
  return mine.find((m) => m.bytes[0] === 0x62 && m.bytes[1] === hi && m.bytes[2] === lo);
}

// The whole value of a supported DID (after 62 DID DID), or null: what a value
// search looks through, never handed to the model as such.
export function didData(did: string, messages: readonly EcuMessage[], rx: string | null = null): readonly number[] | null {
  const positive = positiveOf(did, mineOf(messages, rx));
  return positive?.complete ? positive.bytes.slice(3) : null;
}

export function classifyReply(did: string, messages: readonly EcuMessage[], rx: string | null = null): ProbeResult {
  const entry = didCatalogEntry(did);
  const catalog = entry ? { name: entry.name, privacy: entry.privacy, evidence: entry.evidence } : undefined;
  const result = (value: Omit<ProbeResult, 'catalog'>): ProbeResult => ({
    ...value,
    ...(catalog ? { catalog } : {}),
  });
  const mine = mineOf(messages, rx);
  if (mine.length === 0) return result({ did, outcome: 'silent' });

  const positive = positiveOf(did, mine);
  if (positive) {
    if (!positive.complete) return result({ did, outcome: 'incomplete' });
    const data = positive.bytes.slice(3);
    const sample = sampleOf(did, data);
    return result({ did, outcome: 'supported', length: data.length, ...(sample ? { sample } : {}) });
  }
  const refusal = mine.find((m) => m.bytes[0] === 0x7f && m.bytes[1] === 0x22 && m.bytes[2] !== undefined);
  if (refusal) {
    const nrc = hex2(refusal.bytes[2]!);
    return result({ did, outcome: NRC_OUTCOME[nrc] ?? 'other_refusal', nrc });
  }
  if (mine.some((m) => m.bytes[0] === 0x62)) return result({ did, outcome: 'mismatch' });
  // Something arrived that is neither: a cut multi-frame answer shows up here.
  return result({ did, outcome: mine.some((m) => !m.complete) ? 'incomplete' : 'silent' });
}

// ── Does the link work? ─────────────────────────────────────────────────────

export type Verdict = 'link_ok' | 'link_silent' | 'link_partial';

const ANSWERED = new Set<DidOutcome>(['supported', 'unsupported', 'locked', 'needs_conditions', 'service_refused', 'bad_request', 'other_refusal', 'pending']);

// `alive`: the TesterPresent (3E 00) got a 7E or a 7F; null when it was not sent.
// Any answer, positive or a refusal, proves the path adapter–bus–module works.
export function moduleVerdict(results: readonly ProbeResult[], alive: boolean | null = null): Verdict {
  const answered = alive === true || results.some((r) => ANSWERED.has(r.outcome));
  const cut = results.some((r) => r.outcome === 'incomplete');
  if (cut) return 'link_partial';
  return answered ? 'link_ok' : 'link_silent';
}

export function verdictText(verdict: Verdict, bit29: boolean): string {
  switch (verdict) {
    case 'link_ok':
      return 'El módulo contestó: el adaptador y el software funcionan. Si un DID no devuelve datos, es porque ese DID no existe, está bloqueado o pide otras condiciones.';
    case 'link_partial':
      return 'Contestan las respuestas cortas pero no las de varios cuadros: el adaptador no las reensambla. Repetir con STCSEGR 1, o con un B33-U.';
    case 'link_silent':
      return (
        'Nadie contestó, ni siquiera a los DIDs estándar: no es un problema del DID. Revisar el header ' +
        (bit29 ? '(en 29 bits el pedido es 18DA<módulo>F1; 18DAF1<módulo> es el de respuesta), ' : '(en 11 bits el pedido va a 7E0–7E7), ') +
        'el filtro de respuesta, el control de flujo, o que el módulo esté en CAN FD (un ELM o un STN no lo ven).'
      );
  }
}

// ── When to stop ────────────────────────────────────────────────────────────

export const MIN_START_VOLTS = 12.0;
export const ABORT_VOLTS = 11.5;
export const MAX_SILENT_IN_A_ROW = 10;
export const MAX_CALL_MS = 60_000;
export const MS_PER_DID = 60; // rough, for the time shown in the confirmation

export type StopReason = 'silent_streak' | 'time' | 'low_voltage' | 'cancelled';

export const STOP_TEXT: Readonly<Record<StopReason, string>> = {
  silent_streak: `se cortó: ${MAX_SILENT_IN_A_ROW} pedidos seguidos sin respuesta (el módulo puede estar saturado)`,
  time: 'se cortó por tiempo; seguí con el cursor',
  low_voltage: 'se cortó: la tensión de la batería bajó de 11,5 V',
  cancelled: 'el usuario lo detuvo; lo leído hasta ahí vale, seguí con el cursor',
};

export function startCheck(volts: number | null): string | null {
  if (volts == null) return null; // an adapter that cannot measure does not block it
  return volts >= MIN_START_VOLTS ? null : `La batería está en ${volts.toFixed(1)} V: hace falta al menos ${MIN_START_VOLTS.toFixed(1)} V (motor en marcha o cargador).`;
}

export class ProbeGuard {
  private silent = 0;
  private readonly started: number;

  constructor(private readonly now: () => number = () => Date.now()) {
    this.started = now();
  }

  // After each request: the reason to stop, or null to go on.
  record(result: ProbeResult, volts: number | null = null): StopReason | null {
    this.silent = result.outcome === 'silent' ? this.silent + 1 : 0;
    if (volts != null && volts < ABORT_VOLTS) return 'low_voltage';
    if (this.silent >= MAX_SILENT_IN_A_ROW) return 'silent_streak';
    if (this.now() - this.started >= MAX_CALL_MS) return 'time';
    return null;
  }
}

// What to tell the user before a sweep, and what to ask for the next chunk.
export function confirmationText(module: string, count: number): string {
  const seconds = Math.max(1, Math.round((count * MS_PER_DID) / 1000));
  return `Voy a leer ${count} DIDs del módulo ${module}, ~${seconds} s. Solo lectura: no escribe ni cambia nada. Con el auto detenido.`;
}

// The lab's candidates: how many comes with the lab's answer, after the user agrees.
export function candidatesConfirmationText(module: string): string {
  return `Voy a leer en el módulo ${module} los DIDs candidatos que el laboratorio tiene para esta marca (unos cientos como mucho; se corta solo si el módulo deja de contestar). Solo lectura: no escribe ni cambia nada. Con el auto detenido.`;
}

export const nextCursor = (dids: readonly string[], done: number): string | null => (done < dids.length ? dids[done]! : null);

// Codes that appeared while probing: some modules log a communication error.
export const newCodes = (before: readonly string[], after: readonly string[]): string[] => after.filter((c) => !before.includes(c));

export function summarize(results: readonly ProbeResult[]): Record<DidOutcome, number> {
  const out = { supported: 0, unsupported: 0, locked: 0, needs_conditions: 0, service_refused: 0, bad_request: 0, other_refusal: 0, pending: 0, incomplete: 0, mismatch: 0, silent: 0 };
  for (const r of results) out[r.outcome]++;
  return out;
}
