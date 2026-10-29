// Runs a DID probe on the link (docs/plans/herramienta-did-probe.md): addresses
// one module, asks it for each DID, and gives back what each answer means.
// What may be sent and how an answer is read live in domain/obd/did-probe.ts;
// this only does the talking, the way obd_command does (header, answer filter,
// FlowControl where the adapter's default misses it), and puts the adapter back
// how the telemetry needs it.

import { parseDtcs } from '@/core/utils/obdDiagnostics';
import { readMessages } from '@/core/utils/obdFrames';
import type { CommandPort } from '@/data/adapters/protocol-manager';
import { AdapterResetError, ConnectionLostError } from '@/core/errors/obd.errors';
import {
  classifyReply,
  didData,
  didRequest,
  isIdentificationDid,
  isProbeCommand,
  moduleVerdict,
  nextCursor,
  ProbeGuard,
  startCheck,
  type ProbeResult,
  type StopReason,
  type Verdict,
  type DidProbeProgressEvent,
} from '@/domain/obd/did-probe';
import { FUNCTIONAL_11, FUNCTIONAL_29, needsFlowPair } from '@/domain/obd/module-scan';
import { findValue, type ValueMatch } from '@/domain/obd/value-search';
import { quiet } from './stn';

export interface ProbeTarget {
  readonly reqHeader: string;
  readonly rxHeader: string;
}

export interface ProbeLink {
  readonly bit29: boolean;
  readonly stn: boolean;
  readonly can: boolean;
}

export type ProbeRun =
  | { readonly blocked: string }
  | {
      readonly blocked: null;
      readonly results: readonly ProbeResult[];
      // 3E 00 got an answer (a 7E, or any 7F: a refusal is an answer too).
      readonly alive: boolean;
      readonly verdict: Verdict;
      readonly stopped: StopReason | null;
      readonly cursor: string | null;
      readonly volts: number | null;
      readonly codesBefore: readonly string[] | null;
      readonly codesAfter: readonly string[] | null;
      // With `find`: the DIDs whose whole value holds that number.
      readonly matches: readonly ValueMatch[];
    };

const DID_TIMEOUT_MS = 1500;
const ALIVE_TIMEOUT_MS = 1200;
const PENDING_RETRY_MS = 500;
const VOLTS_EVERY = 16;

// Every request goes through the same gate as the policy: defence in depth.
async function send(port: CommandPort, command: string, timeoutMs: number): Promise<string | null> {
  if (!isProbeCommand(command)) throw new Error(`did_probe: not allowed: ${command}`);
  return quiet(port, command, timeoutMs);
}

// "12.4V" from ATRV or STVR; null when the adapter does not say.
async function readVolts(port: CommandPort, stn: boolean): Promise<number | null> {
  const raw = await quiet(port, stn ? 'STVR' : 'ATRV').catch((err) => {
    if (err instanceof ConnectionLostError || err instanceof AdapterResetError) throw err;
    return null;
  });
  const m = raw ? /(\d{1,2}(?:\.\d+)?)\s*V/i.exec(raw) : null;
  return m ? Number(m[1]) : null;
}

// The stored codes by function (the engine's answer), for the before/after look.
async function readCodes(port: CommandPort, link: ProbeLink): Promise<string[] | null> {
  const raw = await send(port, '03', 3000).catch((err) => {
    if (err instanceof ConnectionLostError || err instanceof AdapterResetError) throw err;
    return null;
  });
  if (raw == null) return null;
  try {
    return parseDtcs(readMessages(raw, { headers: true, can: link.can }), 0x03, link.can).codes.map((c) => c.code);
  } catch {
    return null;
  }
}

// The user stopped the probe before any DID was read (once the sweep is on, a
// stop returns what was read instead); the adapter is put back before this leaves.
export class DidProbeCancelled extends Error {}

export async function runDidProbe(
  port: CommandPort,
  target: ProbeTarget,
  dids: readonly string[],
  link: ProbeLink,
  find: number | null = null,
  now: () => number = () => Date.now(),
  onProgress?: (event: DidProbeProgressEvent) => void,
  signal?: AbortSignal,
): Promise<ProbeRun> {
  const checkCancelled = () => {
    if (signal?.aborted) throw new DidProbeCancelled();
  };
  const functional = link.bit29 ? FUNCTIONAL_29 : FUNCTIONAL_11;
  let elmFlow = false;
  // Set once the module's header is on: only then is there something to put back.
  let touched = false;
  await quiet(port, 'ATH1');
  try {
    checkCancelled();
    const volts = await readVolts(port, link.stn);
    checkCancelled();
    const refused = startCheck(volts);
    if (refused) return { blocked: refused };

    // Codes by function first, while the header is still the functional one.
    const codesBefore = await readCodes(port, link);
    checkCancelled();

    touched = true;
    await send(port, `ATSH ${target.reqHeader}`, 2000);
    // Only this module's answer, and its FlowControl where the default misses it.
    await send(port, `ATCRA ${target.rxHeader}`, 2000);
    const pair = { id: target.reqHeader, reqHeader: target.reqHeader, rxHeader: target.rxHeader, label: '' };
    if (link.stn) {
      await send(port, 'STCFCPC', 2000);
      if (needsFlowPair(pair)) await send(port, `STCFCPA ${target.reqHeader}, ${target.rxHeader}`, 2000);
    } else if (needsFlowPair(pair)) {
      await send(port, `ATFCSH ${target.reqHeader}`, 2000);
      await send(port, 'ATFCSD 30 00 00', 2000);
      elmFlow = (await send(port, 'ATFCSM 1', 2000)) != null;
    }

    const read = async (command: string, timeoutMs: number) => {
      const raw = await send(port, command, timeoutMs);
      return raw == null ? [] : readMessages(raw, { headers: true, can: link.can });
    };

    // "Are you there": a 7E or any 7F counts, since a refusal is an answer too.
    checkCancelled();
    const alive = (await read('3E00', ALIVE_TIMEOUT_MS)).some((m) => (m.ecu == null || m.ecu.toUpperCase() === target.rxHeader.toUpperCase()) && (m.bytes[0] === 0x7e || m.bytes[0] === 0x7f));

    const guard = new ProbeGuard(now);
    const results: ProbeResult[] = [];
    const matches: ValueMatch[] = [];
    let stopped: StopReason | null = null;
    let lastVolts = volts;
    for (const did of dids) {
      // A stop like the others: what was read stays, with the cursor to go on.
      if (signal?.aborted) {
        stopped = 'cancelled';
        break;
      }
      let messages = await read(didRequest(did), DID_TIMEOUT_MS);
      let result = classifyReply(did, messages, target.rxHeader);
      if (result.outcome === 'pending' && !signal?.aborted) {
        // Still working: one more look.
        await new Promise((r) => setTimeout(r, PENDING_RETRY_MS));
        messages = await read(didRequest(did), DID_TIMEOUT_MS);
        result = classifyReply(did, messages, target.rxHeader);
      }
      results.push(result);
      onProgress?.({
        type: 'did-probe-progress',
        reqHeader: target.reqHeader,
        completed: results.length,
        total: dids.length,
        did,
        outcome: result.outcome,
      });
      // The whole value, not the sample the model sees; never an identification DID.
      if (find != null && result.outcome === 'supported' && !isIdentificationDid(did)) {
        const data = didData(did, messages, target.rxHeader);
        if (data) matches.push(...findValue(did, data, find));
      }
      if (results.length % VOLTS_EVERY === 0) lastVolts = (await readVolts(port, link.stn)) ?? lastVolts;
      stopped = guard.record(result, lastVolts);
      if (stopped) break;
    }

    // Back to how the telemetry needs the adapter, then the codes again —
    // unless the user is waiting for the stop (no before/after look then).
    await restore(port, link, elmFlow, functional);
    touched = false;
    const codesAfter = signal?.aborted ? null : await readCodes(port, link);
    return {
      blocked: null,
      results,
      alive,
      verdict: moduleVerdict(results, alive),
      stopped,
      cursor: stopped ? nextCursor(dids, results.length) : null,
      volts: lastVolts,
      codesBefore,
      codesAfter,
      matches,
    };
  } finally {
    if (touched) await restore(port, link, elmFlow, functional).catch(() => undefined);
    await quiet(port, 'ATH0').catch(() => undefined);
  }
}

async function restore(port: CommandPort, link: ProbeLink, elmFlow: boolean, functional: string): Promise<void> {
  if (link.stn) await quiet(port, 'STCFCPC').catch(() => undefined);
  else if (elmFlow) await quiet(port, 'ATFCSM 0').catch(() => undefined);
  await quiet(port, 'ATCRA').catch(() => undefined);
  await quiet(port, `ATSH ${functional}`).catch(() => undefined);
}
