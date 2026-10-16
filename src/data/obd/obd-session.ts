// One live connection to the OBD adapter: link → protocol → identity →
// settings → supported PIDs → telemetry. Everything below the BLE binding is
// testable with a fake transport; this file only wires the pieces — and puts
// them back together when the adapter reboots on its own (LV RESET).

import { MAX_QUERYABLE_PID_NUMBER, SUPPORTED_PID_QUERIES, filterSupportedPids, parseSupportedPidsMask } from '@/core/utils/supportedPids';
import { CommandTimeoutError, NoDataError } from '@/core/errors/obd.errors';
import { isCan } from '@/data/adapters/elm-protocol';
import { ProtocolManager, type CommandPort } from '@/data/adapters/protocol-manager';
import { TransportCommandPort } from '@/data/adapters/transport-command-port';
import type { ByteTransport, Unsubscribe } from '@/data/adapters/transport';
import type { OBDProtocol } from '@/domain/entities/vehicle';
import type { PidId } from '@/core/constants/pids';
import { runAdapterBench, type BenchReport } from './adapter-bench';
import { applyFastSettings, identifyAdapter, type AdapterIdentity } from './stn';
import { SECONDARY_PIDS, TelemetryPoller, stylesFor, type RequestStyle, type TelemetryListener } from './telemetry-poller';

export interface SessionInfo {
  readonly protocol: OBDProtocol;
  readonly identity: AdapterIdentity;
  readonly supportedPids: readonly PidId[];
}

export class ObdSession {
  private port: TransportCommandPort | null = null;
  private poller: TelemetryPoller | null = null;
  private listener: TelemetryListener | null = null;
  private info: SessionInfo | null = null;
  private offReset: Unsubscribe | null = null;
  private recovering: Promise<void> | null = null;
  private resetCount = 0;

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

  // Pauses telemetry, measures, resumes. Navigation keeps GPS speed meanwhile.
  async runBench(): Promise<BenchReport> {
    if (!this.port || !this.info) throw new Error('Session not open');
    this.poller?.stop();
    try {
      return await runAdapterBench(this.port, stylesFor(this.info.identity.stn != null, isCan(this.info.protocol)));
    } finally {
      if (this.listener) this.startTelemetry(this.listener);
    }
  }

  async close(): Promise<void> {
    this.offReset?.();
    this.offReset = null;
    this.poller?.stop();
    this.poller = null;
    this.listener = null;
    this.port?.dispose();
    this.port = null;
    this.info = null;
    if (this.transport.isConnected()) await this.transport.disconnect().catch(() => undefined);
  }

  // The adapter rebooted: protocol, echo, timing — all back to defaults.
  // Configure it again and resume telemetry where it was.
  private recover(): Promise<void> {
    if (this.recovering) return this.recovering;
    this.resetCount++;
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

async function configure(port: CommandPort): Promise<SessionInfo> {
  const { protocol } = await new ProtocolManager(port).initialize();
  const identity = await identifyAdapter(port);
  await applyFastSettings(port, identity);
  const supportedPids = await discoverPids(port);
  return { protocol, identity, supportedPids };
}

function requestStyles(info: SessionInfo): RequestStyle[] {
  return stylesFor(info.identity.stn != null, isCan(info.protocol));
}

function secondaryPids(info: SessionInfo): PidId[] {
  const supported = new Set(info.supportedPids);
  // VOLTAGE is an adapter command, always available.
  return SECONDARY_PIDS.filter((p) => p === 'VOLTAGE' || supported.size === 0 || supported.has(p));
}

// Reads the supported-PID bitmasks (0100, 0120, …). An empty result means
// "unknown" and the poller then tries everything.
async function discoverPids(port: CommandPort): Promise<PidId[]> {
  const numbers = new Set<number>();
  for (const { command, basePid } of SUPPORTED_PID_QUERIES) {
    if (basePid > MAX_QUERYABLE_PID_NUMBER) break;
    try {
      const mask = parseSupportedPidsMask(await port.send(command), basePid);
      for (const n of mask.supported) numbers.add(n);
      if (!mask.hasNextRange) break;
    } catch (err) {
      if (err instanceof NoDataError || err instanceof CommandTimeoutError) break;
      throw err;
    }
  }
  return numbers.size ? filterSupportedPids(SECONDARY_PIDS, numbers) : [];
}
