// The car's file for the assistant (2026-10-29): who the plugged-in car is and
// what the phone already knows about it, in a few lines. It goes with the
// user's message only when the conversation does not have it yet or it
// changed (another car, a new code), so a mechanic who moves from car to car
// never gets one car's past mixed with another's. The full history stays a
// tool call away (read_fault_history, read_service_log).

import type { FaultEvent } from '@/domain/faults/fault-history';
import { makeFromVin } from '@/domain/obd/vin-make';
import { maskVin } from '@/domain/privacy/redact';
import type { ServiceEntry } from '@/domain/service/service-log';
import type { ApiMessage } from '@/domain/ports/llm.port';
import { MIN_SESSIONS } from './baseline';

export interface CarBriefInput {
  readonly vin: string | null;
  // This car's fault history, newest first.
  readonly faults: readonly FaultEvent[];
  // This car's service entries, newest first.
  readonly services: readonly ServiceEntry[];
  // Connections the baseline learnt from.
  readonly baselineSessions: number;
  readonly now: number;
}

export const BRIEF_OPEN = '[auto conectado:';
// The car blocks inside a user message, to leave them out of summaries.
export const CAR_BLOCKS = /\n*\[(?:cambió el auto|auto conectado):[^\]]*\]/g;
const MAX_CODES = 4;
const MAX_SERVICES = 2;
// How far back in the conversation a brief still counts as "already said".
const RECENT_MESSAGES = 8;

const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789';

// Model year from the 10th character (30-year cycle: the most recent year that
// is not in the future). Not for European VINs (S–Z), which often leave it
// unused.
export function modelYear(vin: string | null, now: number): number | null {
  const v = (vin ?? '').trim().toUpperCase();
  if (v.length !== 17 || /^[S-Z]/.test(v)) return null;
  const i = YEAR_CODES.indexOf(v[9]!);
  if (i < 0) return null;
  const latest = new Date(now).getFullYear() + 1;
  let year = 1980 + i;
  while (year + 30 <= latest) year += 30;
  return year;
}

const MAKE_NAME: Readonly<Record<string, string>> = { citroen: 'Citroën' };

function makeName(make: string): string {
  return MAKE_NAME[make] ?? make.charAt(0).toUpperCase() + make.slice(1);
}

// "Chevrolet 2024" for the top bar; null when the VIN says nothing we know.
export function carLabel(vin: string | null, now: number): string | null {
  const make = makeFromVin(vin);
  const year = modelYear(vin, now);
  if (!make) return year ? `Auto ${year}` : null;
  return year ? `${makeName(make)} ${year}` : makeName(make);
}

function date(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function km(n: number): string {
  return `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} km`;
}

// User text inside the block: no brackets, one line, short.
function plain(s: string, max = 60): string {
  const t = s.replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function carBrief(input: CarBriefInput): string {
  const { vin, faults, services, baselineSessions, now } = input;
  if (!vin) return `${BRIEF_OPEN} el auto no informa el VIN; no hay historial de este auto]`;

  const make = makeFromVin(vin);
  const year = modelYear(vin, now);
  const who = [make ? makeName(make) : 'marca no identificada', year ? `año ${year} según el VIN` : null].filter(Boolean).join(', ');
  const learnt =
    baselineSessions >= MIN_SESSIONS
      ? `lo habitual aprendido en ${baselineSessions} conexiones`
      : `lo habitual todavía en aprendizaje (${baselineSessions} de ${MIN_SESSIONS} conexiones)`;
  const lines = [`${BRIEF_OPEN} ${who} (VIN ${maskVin(vin)}) · ${learnt}`];

  const codeEvents = faults.filter((e): e is Extract<FaultEvent, { type: 'codes' }> => e.type === 'codes');
  if (codeEvents.length === 0 && !faults.some((e) => e.type === 'cleared')) {
    lines.push('- sin códigos registrados en este teléfono');
  }
  const lastStored = codeEvents.find((e) => e.kind === 'stored');
  if (lastStored) {
    lines.push(
      lastStored.codes.length
        ? `- códigos guardados en la última lectura: ${lastStored.codes.map((c) => c.code).join(', ')} (${date(lastStored.lastSeenAt)})`
        : `- sin códigos guardados en la última lectura (${date(lastStored.lastSeenAt)})`,
    );
  }
  const lastPending = codeEvents.find((e) => e.kind === 'pending');
  if (lastPending?.codes.length) {
    lines.push(`- pendientes en la última lectura: ${lastPending.codes.map((c) => c.code).join(', ')} (${date(lastPending.lastSeenAt)})`);
  }

  // Each event is one appearance of that set of codes.
  const seen = new Map<string, number>();
  for (const e of codeEvents) for (const c of e.codes) seen.set(c.code, (seen.get(c.code) ?? 0) + 1);
  if (seen.size) {
    const top = [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_CODES);
    const more = seen.size > MAX_CODES ? ` y ${seen.size - MAX_CODES} más` : '';
    lines.push(`- códigos que tuvo: ${top.map(([code, n]) => (n > 1 ? `${code} ×${n}` : code)).join(', ')}${more}`);
  }

  const clear = faults.find((e): e is Extract<FaultEvent, { type: 'cleared' }> => e.type === 'cleared');
  if (clear) {
    const before = clear.distSinceClearBeforeKm != null ? `, ${km(clear.distSinceClearBeforeKm)} después del borrado anterior` : '';
    const had = clear.codesBefore.length ? `; tenía ${clear.codesBefore.map((c) => c.code).join(', ')}` : '';
    lines.push(`- último borrado de códigos: ${date(clear.at)}${before}${had}`);
  }

  if (services.length) {
    const items = services.slice(0, MAX_SERVICES).map((s) => `${plain(s.item)} ${date(s.at)}${s.km != null ? ` a ${km(s.km)}` : ''}`);
    lines.push(`- service: ${items.join('; ')}`);
  }

  return `${lines.join('\n')}]`;
}

function textOf(m: ApiMessage): string {
  if (m.role !== 'user') return '';
  if (typeof m.content === 'string') return m.content;
  return m.content.map((p) => (p.type === 'text' ? p.text : '')).join('\n');
}

function briefIn(text: string): string | null {
  const i = text.lastIndexOf(BRIEF_OPEN);
  if (i < 0) return null;
  const end = text.indexOf(']', i);
  return end < 0 ? null : text.slice(i, end + 1);
}

// What to add to this message: the brief when the recent conversation does not
// have it, with a warning when the one before was of another car.
export function briefToSend(brief: string, history: readonly ApiMessage[]): string | null {
  let previous: string | null = null;
  for (const m of history.slice(-RECENT_MESSAGES).reverse()) {
    previous = briefIn(textOf(m));
    if (previous) break;
  }
  if (previous === brief) return null;
  const car = (b: string) => /\(VIN ([^)]+)\)/.exec(b)?.[1] ?? null;
  if (previous && car(previous) !== car(brief)) {
    return `[cambió el auto: lo anterior de la conversación era de otro auto]\n${brief}`;
  }
  return brief;
}
