// Diagnostic capture: what this car and this adapter really answer to the
// requests the assistant's tools will make (M2.0).
//
// The parsers for codes, freeze frame, readiness and VIN (M2.1/M2.2) are
// written against these answers, not against examples from manuals. So the
// capture keeps each response exactly as the adapter framed it — headers,
// "response pending" frames and all — and records failures instead of
// stopping. Read-only: nothing here clears codes or writes to the car.

import { AdapterResetError, CommandTimeoutError, ConnectionLostError, NoDataError } from '@/core/errors/obd.errors';
import type { CommandPort } from '@/data/adapters/protocol-manager';
import type { Unsubscribe } from '@/data/adapters/transport';

export interface CapturePort extends CommandPort {
  onRaw(listener: (raw: string) => void): Unsubscribe;
}

export interface CaptureRound {
  readonly title: string;
  readonly only?: 'stn' | 'elm';
  readonly commands: readonly string[];
}

// The OBD requests, once without and once with headers (ATH1 shows which ECU
// answers: 18DAF110 engine, 18DAF118 gearbox on CAN 29 bit). Freeze frame is
// asked with and without the frame number, since ECUs differ.
const OBD_REQUESTS = [
  '0101', // monitor status and MIL
  '0131', // distance since codes cleared
  '03', // stored codes
  '07', // pending codes
  '0A', // permanent codes
  '0200', // freeze frame: supported PIDs
  '0202', // freeze frame: code that stored it
  '020200',
  '020C00', // freeze frame RPM, coolant, speed
  '020500',
  '020D00',
  '0900', // vehicle info: supported
  '0902', // VIN (several frames)
  'ATDP',
];

export const CAPTURE_ROUNDS: readonly CaptureRound[] = [
  { title: 'Sin encabezados (ATH0)', commands: ['ATH0', ...OBD_REQUESTS] },
  { title: 'Con encabezados (ATH1)', commands: ['ATH1', ...OBD_REQUESTS, 'ATH0'] },
  {
    title: 'Comandos STN',
    only: 'stn',
    commands: [
      'STPRS',
      'STVR',
      'STVR 2',
      'STDICES', // engine starts
      'STDITPO', // powered-on time
      'STSLLT', // why it last slept and woke
      'STCSEGR 1', // adapter reassembles multi-frame answers
      '0902',
      '03',
      'STCSEGR 0',
      'STP 34', // fixed protocol: CAN 29 bit / 500 k, no search
      '0100',
    ],
  },
  {
    title: 'ELM327: genuino o clon',
    only: 'elm',
    // A clone claiming v2.x answers "?" to these.
    commands: ['ATI', 'AT@1', 'ATAMC', 'ATCTM1'],
  },
];

// Mode 04 clears codes and freeze frame; 14 and 31 are their UDS cousins.
// The capture must never send them, whatever the rounds say.
export function isReadOnly(command: string): boolean {
  const c = command.replace(/\s/g, '').toUpperCase();
  return !/^(04|14|31|2E)/.test(c);
}

export type CaptureOutcome = 'ok' | 'no-data' | 'timeout' | 'reset' | 'lost';

export interface CaptureEntry {
  readonly command: string;
  readonly outcome: CaptureOutcome;
  // What the adapter printed, prompt by prompt (a pending answer prints twice).
  readonly raw: readonly string[];
  readonly ms: number;
}

export interface CaptureReport {
  readonly startedAt: number;
  readonly adapter: string;
  readonly protocol: string;
  readonly rounds: readonly { title: string; entries: readonly CaptureEntry[] }[];
  // Set when the link dropped or the adapter rebooted mid-capture.
  readonly interrupted: string | null;
}

const COMMAND_TIMEOUT_MS = 6000;

export async function runDiagnosticCapture(
  port: CapturePort,
  context: { adapter: string; protocol: string; stn: boolean },
  rounds: readonly CaptureRound[] = CAPTURE_ROUNDS,
  now: () => number = () => Date.now(),
): Promise<CaptureReport> {
  const startedAt = now();
  let interrupted: string | null = null;
  const out: { title: string; entries: CaptureEntry[] }[] = [];

  for (const round of rounds) {
    if (round.only === 'stn' && !context.stn) continue;
    if (round.only === 'elm' && context.stn) continue;
    const entries: CaptureEntry[] = [];
    out.push({ title: round.title, entries });
    for (const command of round.commands) {
      if (!isReadOnly(command)) continue;
      const raw: string[] = [];
      const off = port.onRaw((r) => raw.push(r));
      const start = now();
      let outcome: CaptureOutcome = 'ok';
      try {
        await port.send(command, COMMAND_TIMEOUT_MS);
      } catch (err) {
        outcome = outcomeOf(err);
      } finally {
        off();
      }
      entries.push({ command, outcome, raw, ms: now() - start });
      if (outcome === 'reset' || outcome === 'lost') {
        interrupted = outcome === 'reset' ? 'el adaptador se reinició' : 'se perdió la conexión';
        break;
      }
    }
    if (interrupted) break;
  }
  return { startedAt, adapter: context.adapter, protocol: context.protocol, rounds: out, interrupted };
}

function outcomeOf(err: unknown): CaptureOutcome {
  if (err instanceof NoDataError) return 'no-data';
  if (err instanceof CommandTimeoutError) return 'timeout';
  if (err instanceof AdapterResetError) return 'reset';
  if (err instanceof ConnectionLostError) return 'lost';
  return 'no-data';
}

const OUTCOME_LABEL: Record<CaptureOutcome, string> = {
  ok: '',
  'no-data': ' · sin dato',
  timeout: ' · sin respuesta',
  reset: ' · REINICIO',
  lost: ' · CONEXIÓN PERDIDA',
};

// Plain text to share: one block per command, raw answers indented.
export function formatCapture(report: CaptureReport): string {
  const lines = [
    `Captura de diagnóstico · ${new Date(report.startedAt).toISOString()}`,
    `Adaptador: ${report.adapter}`,
    `Protocolo: ${report.protocol}`,
  ];
  if (report.interrupted) lines.push(`INTERRUMPIDA: ${report.interrupted}`);
  for (const round of report.rounds) {
    lines.push('', `== ${round.title} ==`);
    for (const e of round.entries) {
      lines.push(`> ${e.command} (${e.ms} ms${OUTCOME_LABEL[e.outcome]})`);
      for (const r of e.raw) lines.push(`  ${r === '' ? '(vacío)' : r}`);
    }
  }
  return lines.join('\n');
}
