// One live connection to the OBD adapter: link → protocol → identity →
// supported PIDs → telemetry. Everything below the BLE binding is testable
// with a fake transport; this file only wires the pieces.

import { MAX_QUERYABLE_PID_NUMBER, SUPPORTED_PID_QUERIES, filterSupportedPids, parseSupportedPidsMask } from '@/core/utils/supportedPids';
import { CommandTimeoutError, NoDataError } from '@/core/errors/obd.errors';
import { isCan } from '@/data/adapters/elm-protocol';
import { ProtocolManager, type CommandPort } from '@/data/adapters/protocol-manager';
import { TransportCommandPort } from '@/data/adapters/transport-command-port';
import type { ByteTransport } from '@/data/adapters/transport';
import type { OBDProtocol } from '@/domain/entities/vehicle';
import type { PidId } from '@/core/constants/pids';
import { applyFastTiming, identifyAdapter, type AdapterIdentity } from './stn';
import { SECONDARY_PIDS, TelemetryPoller, type TelemetryListener } from './telemetry-poller';

export interface SessionInfo {
  readonly protocol: OBDProtocol;
  readonly identity: AdapterIdentity;
  readonly supportedPids: readonly PidId[];
}

export class ObdSession {
  private port: TransportCommandPort | null = null;
  private poller: TelemetryPoller | null = null;
  private info: SessionInfo | null = null;

  constructor(private readonly transport: ByteTransport) {}

  async open(deviceId: string): Promise<SessionInfo> {
    await this.transport.connect(deviceId);
    const port = new TransportCommandPort(this.transport);
    this.port = port;
    try {
      const { protocol } = await new ProtocolManager(port).initialize();
      const identity = await identifyAdapter(port);
      await applyFastTiming(port, identity);
      const supportedPids = await discoverPids(port);
      this.info = { protocol, identity, supportedPids };
      return this.info;
    } catch (err) {
      await this.close();
      throw err;
    }
  }

  startTelemetry(listener: TelemetryListener): void {
    if (!this.port || !this.info) throw new Error('Session not open');
    this.poller?.stop();
    const supported = new Set(this.info.supportedPids);
    this.poller = new TelemetryPoller(this.port, listener, {
      can: isCan(this.info.protocol),
      // VOLTAGE is an adapter command, always available.
      secondary: SECONDARY_PIDS.filter((p) => p === 'VOLTAGE' || supported.size === 0 || supported.has(p)),
    });
    this.poller.start();
  }

  speedRateHz(): number {
    return this.poller?.speedRateHz() ?? 0;
  }

  async close(): Promise<void> {
    this.poller?.stop();
    this.poller = null;
    this.port?.dispose();
    this.port = null;
    this.info = null;
    if (this.transport.isConnected()) await this.transport.disconnect().catch(() => undefined);
  }
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
