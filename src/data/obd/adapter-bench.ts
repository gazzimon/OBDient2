// Adapter bench: what chip this really is and how fast it really answers.
//
// Vendor quotes and manuals describe a family; only the device knows which
// member it is. The bench asks every identity command (unsupported ones just
// answer "?") and times the speed request in each style, so the choice made
// by the poller can be checked against numbers, and shared as plain text.

import { PID_DEFINITIONS } from '@/core/constants/pids';
import { AdapterResetError, ConnectionLostError } from '@/core/errors/obd.errors';
import { parsePidResponse } from '@/core/utils/obdParser';
import type { CommandPort } from '@/data/adapters/protocol-manager';
import { quiet } from './stn';
import { requestFor, type RequestStyle } from './telemetry-poller';

// Label → command. Device ID set from FRPM §8.4, plus protocol, voltage and
// PowerSave config (§8.11 — tells us whether the dongle sleeps when parked).
export const IDENTITY_COMMANDS: readonly [string, string][] = [
  ['ELM id', 'ATI'],
  ['Descripción', 'AT@1'],
  ['Firmware', 'STI'],
  ['Firmware ext.', 'STIX'],
  ['Hardware', 'STDI'],
  ['Fabricante', 'STMFR'],
  ['Serie', 'STSN'],
  ['Protocolo', 'STPRS'],
  ['Voltaje', 'STVR'],
  ['Energía', 'STSLCS'],
];

export interface StyleResult {
  readonly style: RequestStyle;
  readonly ok: number;
  readonly total: number;
  // Successful speed readings per second, over the whole run.
  readonly hz: number;
  readonly meanMs: number;
}

export interface BenchReport {
  readonly identity: readonly { label: string; command: string; value: string | null }[];
  readonly styles: readonly StyleResult[];
}

export async function runAdapterBench(
  port: CommandPort,
  styles: readonly RequestStyle[],
  samples = 20,
  now: () => number = () => Date.now(),
): Promise<BenchReport> {
  const identity: BenchReport['identity'][number][] = [];
  for (const [label, command] of IDENTITY_COMMANDS) {
    identity.push({ label, command, value: await quiet(port, command) });
  }

  const results: StyleResult[] = [];
  for (const style of styles) {
    let ok = 0;
    const start = now();
    for (let i = 0; i < samples; i++) {
      try {
        parsePidResponse('SPEED', await port.send(requestFor(style, PID_DEFINITIONS.SPEED.command), 1000));
        ok++;
      } catch (err) {
        if (err instanceof ConnectionLostError || err instanceof AdapterResetError) throw err;
      }
    }
    const elapsed = Math.max(1, now() - start);
    results.push({ style, ok, total: samples, hz: (ok * 1000) / elapsed, meanMs: elapsed / samples });
  }
  return { identity, styles: results };
}

// Plain-text report, for the screen and for sharing.
export function formatBench(report: BenchReport): string {
  const lines = ['== Identidad =='];
  for (const { label, command, value } of report.identity) {
    lines.push(`${label} (${command}): ${value ?? '—'}`);
  }
  lines.push('', '== Velocidad (PID 0D) ==');
  for (const r of report.styles) {
    lines.push(`${r.style.padEnd(5)} ${r.hz.toFixed(1)} Hz · ${r.meanMs.toFixed(0)} ms/pet · ${r.ok}/${r.total} ok`);
  }
  return lines.join('\n');
}
