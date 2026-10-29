// One live connection to the OBD adapter: link → protocol → identity →
// settings → supported PIDs → telemetry. Everything below the BLE binding is
// testable with a fake transport; this file only wires the pieces — and puts
// them back together when the adapter reboots on its own (LV RESET).

import {
  MAX_QUERYABLE_PID_NUMBER,
  SUPPORTED_PID_QUERIES,
  filterSupportedPids,
  firstUnansweredRange,
  mergeSupportedPidRanges,
  parseSupportedPidsByEcu,
  pidNumberFor,
  type EcuSupportedPids,
  type EcuSupportedPidsMask,
  type PidDiscoveryStatus,
} from '@/core/utils/supportedPids';
import { CommandTimeoutError, NoDataError } from '@/core/errors/obd.errors';
import { isCan } from '@/data/adapters/elm-protocol';
import { ProtocolManager, type CommandPort } from '@/data/adapters/protocol-manager';
import { TransportCommandPort } from '@/data/adapters/transport-command-port';
import type { ByteTransport, Unsubscribe } from '@/data/adapters/transport';
import type { OBDProtocol } from '@/domain/entities/vehicle';
import type { PidId } from '@/core/constants/pids';
import { runAdapterBench, type BenchReport } from './adapter-bench';
import { runM7Bench, type M7Report } from './m7-bench';
import { runDiagnosticCapture, type CaptureReport } from './diagnostic-capture';
import { applyFastSettings, identifyAdapter, quiet, type AdapterIdentity } from './stn';
import { SECONDARY_PIDS, TelemetryPoller, stylesFor, type RequestStyle, type TelemetryListener } from './telemetry-poller';

export interface SessionInfo {
  readonly protocol: OBDProtocol;
  readonly identity: AdapterIdentity;
  // The telemetry PIDs this car answers (subset of SECONDARY_PIDS).
  readonly supportedPids: readonly PidId[];
  // Every mode-01 PID number the car announced (0100, 0120, …).
  readonly supportedPidNumbers: readonly number[];
  // The bitmap union loses ECU attribution; retain each ECU's own declaration.
  readonly supportedPidNumbersByEcu: readonly EcuSupportedPids[];
  // Empty numbers with `known` means valid bitmaps said no supported PIDs;
  // `unknown` means the discovery request did not produce a usable bitmap.
  readonly pidDiscoveryStatus: PidDiscoveryStatus;
}

const LOW_POWER_GRACE_MS = 150;
const SETTLE_MS = 300;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class ObdSession {
  private port: TransportCommandPort | null = null;
  private poller: TelemetryPoller | null = null;
  private listener: TelemetryListener | null = null;
  private info: SessionInfo | null = null;
  private offReset: Unsubscribe | null = null;
  private recovering: Promise<void> | null = null;
  private resetCount = 0;
  private capturing = false;
  // Exclusive work (bench, capture, diagnostic reads) runs one at a time.
  private lock: Promise<unknown> = Promise.resolve();

  constructor(private readonly transport: ByteTransport) {}

  async open(deviceId: string): Promise<SessionInfo> {
    await this.transport.connect(deviceId);
    const port = new TransportCommandPort(this.transport);
    this.port = port;
    try {
      this.info = await configure(port);
      this.offReset = port.onAdapterReset(() => void this.recover());
      return this.info;
    } catch (err) {
      await this.close();
      throw err;
    }
  }

  startTelemetry(listener: TelemetryListener): void {
    if (!this.port || !this.info) throw new Error('Session not open');
    this.listener = listener;
    this.poller?.stop();
    this.poller = new TelemetryPoller(this.port, listener, {
      styles: requestStyles(this.info),
      secondary: secondaryPids(this.info),
    });
    this.poller.start();
  }

  speedRateHz(): number {
    return this.poller?.speedRateHz() ?? 0;
  }

  requestStyle(): RequestStyle | null {
    return this.poller?.style ?? null;
  }

  // How many times the adapter rebooted itself this session (brown-outs).
  get adapterResets(): number {
    return this.resetCount;
  }

  get sessionInfo(): SessionInfo | null {
    return this.info;
  }

  // A request that shares the link with the telemetry (queued between its
  // requests). For quick reads that do not change the adapter's settings.
  send(command: string, timeoutMs?: number): Promise<string> {
    if (!this.port) return Promise.reject(new Error('Session not open'));
    return this.port.send(command, timeoutMs);
  }

  // Pauses telemetry, runs `work` alone on the link, resumes. For anything
  // that changes the adapter's settings (headers) or needs the bus to itself.
  // Navigation keeps GPS speed meanwhile.
  exclusive<T>(work: (port: TransportCommandPort, info: SessionInfo) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const port = this.port;
      const info = this.info;
      if (!port || !info) throw new Error('Session not open');
      this.poller?.stop();
      try {
        await settle(port);
        return await work(port, info);
      } finally {
        if (this.listener && this.port === port) this.startTelemetry(this.listener);
      }
    };
    const result = this.lock.then(run, run);
    this.lock = result.catch(() => undefined);
    return result;
  }

  // Pauses telemetry, measures, resumes.
  runBench(): Promise<BenchReport> {
    return this.exclusive((port, info) => runAdapterBench(port, stylesFor(info.identity.stn != null, isCan(info.protocol))));
  }

  // Pauses telemetry, sends the read-only diagnostic requests in several
  // configurations (headers, STN reassembly, fixed protocol), then configures
  // the adapter from scratch so none of them stays on, and resumes.
  runCapture(): Promise<CaptureReport> {
    return this.exclusive(async (port, info) => {
      this.capturing = true;
      try {
        return await runDiagnosticCapture(port, {
          adapter: info.identity.stn ?? (info.identity.elm || 'ELM327'),
          protocol: info.protocol,
          stn: info.identity.stn != null,
          can: isCan(info.protocol),
        });
      } finally {
        this.capturing = false;
        try {
          if (this.port === port) this.info = await configure(port);
        } catch {
          // The link is gone or still browned out: the session ends or recovers upstream.
        }
      }
    });
  }

  // M7.0: PIDs per request, today's loop and the diagnostic requests, timed.
  // Same care as the capture: STCSEGR is switched on and off inside, and the
  // adapter is configured from scratch after.
  runM7Bench(): Promise<M7Report> {
    return this.exclusive(async (port, info) => {
      this.capturing = true;
      try {
        const stn = info.identity.stn != null;
        const can = isCan(info.protocol);
        return await runM7Bench(port, {
          adapter: info.identity.stn ?? (info.identity.elm || 'ELM327'),
          protocol: info.protocol,
          stn,
          can,
          styles: stylesFor(stn, can),
          supported: info.supportedPids,
        });
      } finally {
        this.capturing = false;
        try {
          if (this.port === port) this.info = await configure(port);
        } catch {
          // The link is gone or still browned out: the session ends or recovers upstream.
        }
      }
    });
  }

  // Resolves once a recovery after an adapter reboot (LV RESET) has finished:
  // a tool that failed with AdapterResetError waits here, then retries.
  settled(): Promise<void> {
    return this.recovering ?? Promise.resolve();
  }

  async close(): Promise<void> {
    this.offReset?.();
    this.offReset = null;
    this.poller?.stop();
    this.poller = null;
    this.listener = null;
    this.port?.dispose();
    this.port = null;
    const plainElm = this.info != null && this.info.identity.stn == null;
    this.info = null;
    if (!this.transport.isConnected()) return;
    // A plain ELM327 never sleeps on its own (PP 0E/0F factory defaults) and,
    // left plugged in, drains the battery. ATLP puts it in standby; the next
    // connection wakes it (see ProtocolManager). STN chips sleep by themselves
    // and reject ATLP in their native mode. Fire and forget: the reply is "OK"
    // without a prompt. The pause lets a command still in flight finish, since
    // any byte interrupts the adapter.
    if (plainElm) {
      await delay(LOW_POWER_GRACE_MS);
      await this.transport.write('ATLP\r').catch(() => undefined);
    }
    await this.transport.disconnect().catch(() => undefined);
  }

  // The adapter rebooted: protocol, echo, timing — all back to defaults.
  // Configure it again and resume telemetry where it was.
  private recover(): Promise<void> {
    if (this.recovering) return this.recovering;
    this.resetCount++;
    // The capture reconfigures the adapter when it ends.
    if (this.capturing) return Promise.resolve();
    this.recovering = (async () => {
      const port = this.port;
      if (!port) return;
      this.poller?.stop();
      try {
        this.info = await configure(port);
        if (this.listener && this.port === port) this.startTelemetry(this.listener);
      } catch {
        // Still browned out (engine cranking): the next LV RESET or command
        // failure brings us back here; a dead link ends the session upstream.
      }
    })().finally(() => {
      this.recovering = null;
    });
    return this.recovering;
  }
}

// After stopping the telemetry a request may still be in flight, and a late
// answer would land in the next command (seen on the B35: "411130" before
// ATH0's OK). Let it finish and soak up any leftover with a no-op.
async function settle(port: CommandPort): Promise<void> {
  await delay(SETTLE_MS);
  await port.send('ATE0').catch(() => undefined);
}

async function configure(port: CommandPort): Promise<SessionInfo> {
  const { protocol } = await new ProtocolManager(port).initialize();
  const identity = await identifyAdapter(port);
  await applyFastSettings(port, identity);
  const discovered = await discoverPidNumbers(port, isCan(protocol));
  const supportedPidNumbers = [...new Set(discovered.byEcu.flatMap((ecu) => ecu.numbers))].sort((a, b) => a - b);
  const supportedPids =
    discovered.status !== 'unknown'
      ? filterSupportedPids(SECONDARY_PIDS, new Set(supportedPidNumbers), true)
      : [];
  return {
    protocol,
    identity,
    supportedPids,
    supportedPidNumbers,
    supportedPidNumbersByEcu: discovered.byEcu,
    pidDiscoveryStatus: discovered.status,
  };
}

function requestStyles(info: SessionInfo): RequestStyle[] {
  return stylesFor(info.identity.stn != null, isCan(info.protocol));
}

// What the car announced, plus what discovery could not settle: everything when
// no bitmap came back, only the ranges past an unanswered one when partial.
function secondaryPids(info: SessionInfo): PidId[] {
  const supported = new Set(info.supportedPids);
  const unknownFrom = info.pidDiscoveryStatus === 'unknown' ? 0 : firstUnansweredRange(info.supportedPidNumbersByEcu);
  return SECONDARY_PIDS.filter((p) => {
    const n = pidNumberFor(p);
    // VOLTAGE is an adapter command, always available.
    if (n == null || supported.has(p)) return true;
    return unknownFrom != null && n > unknownFrom;
  });
}

interface PidDiscovery {
  readonly status: PidDiscoveryStatus;
  readonly byEcu: readonly EcuSupportedPids[];
}

// Reads each standard bitmap with response headers on so support is attributed
// to the ECU that announced it. Missing answers remain unknown, not unsupported.
async function discoverPidNumbers(port: CommandPort, can: boolean): Promise<PidDiscovery> {
  const ranges: EcuSupportedPidsMask[] = [];
  let headers = false;
  let complete = true;
  let expectedEcus: Set<string> | null = null;
  try {
    headers = (await quiet(port, 'ATH1')) != null;
    for (const { command, basePid } of SUPPORTED_PID_QUERIES) {
      if (basePid > MAX_QUERYABLE_PID_NUMBER) break;
      try {
        const masks = parseSupportedPidsByEcu(await port.send(command), basePid, { headers, can });
        if (masks.length === 0) {
          if (ranges.length > 0) complete = false;
          break;
        }
        if (expectedEcus) {
          const answered = new Set(masks.map((mask) => mask.ecu ?? '<unknown>'));
          if ([...expectedEcus].some((ecu) => !answered.has(ecu))) complete = false;
        }
        ranges.push(...masks);
        expectedEcus = new Set(masks.filter((mask) => mask.hasNextRange).map((mask) => mask.ecu ?? '<unknown>'));
        if (expectedEcus.size === 0) break;
      } catch (err) {
        if (err instanceof NoDataError || err instanceof CommandTimeoutError) {
          if (ranges.length > 0) complete = false;
          break;
        }
        throw err;
      }
    }
    // A next-range bit past the last query (0xE0) is not a missing answer:
    // there is nothing left to ask.
  } finally {
    // Always, and never over the first error: an ATH1 that took effect but
    // timed out would leave the telemetry parsing headers it does not expect.
    await quiet(port, 'ATH0').catch(() => undefined);
  }
  return {
    status: ranges.length === 0 ? 'unknown' : complete ? 'known' : 'partial',
    byEcu: mergeSupportedPidRanges(ranges),
  };
}
