// Live telemetry loop for navigation.
//
// Speed is what the AR and the ego estimator need, so it is asked every cycle;
// the dashboard PIDs share the remaining slots round-robin. The ELM327 is
// strictly one-command-at-a-time, so the loop rate is set by the adapter's
// round-trip, not by a timer: ~5–10 Hz for speed on a BLE STN adapter.
//
// On CAN, appending the expected response count ("010D1") lets the adapter
// return as soon as the first ECU answers instead of waiting out its timeout —
// the single biggest speed-up available. If the adapter rejects it, the
// poller falls back to plain commands for the rest of the session.

import { PID_DEFINITIONS, type PidId } from '@/core/constants/pids';
import { ConnectionLostError } from '@/core/errors/obd.errors';
import { parsePidResponse } from '@/core/utils/obdParser';
import type { CommandPort } from '@/data/adapters/protocol-manager';
import type { ObdAlert, ObdParameter } from '@/domain/entities/obd-parameter';

export interface TelemetryListener {
  onSpeed(kmh: number, tMs: number): void;
  onParameter(param: ObdParameter): void;
  onStopped(reason: 'stopped' | 'connection-lost'): void;
}

export interface PollerOptions {
  // True on CAN protocols: enables the "+1 response" shortcut.
  readonly can: boolean;
  // Secondary PIDs, already filtered to what the car supports.
  readonly secondary: readonly PidId[];
  readonly now?: () => number;
}

export const SECONDARY_PIDS: readonly PidId[] = ['RPM', 'TPS', 'COOLANT_TEMP', 'VOLTAGE', 'ENGINE_LOAD'];

const SPEED_TIMEOUT_MS = 1000;

export class TelemetryPoller {
  private running = false;
  private quickResponses: boolean;
  private nextSecondary = 0;
  private speedTimes: number[] = [];
  private readonly now: () => number;

  constructor(
    private readonly port: CommandPort,
    private readonly listener: TelemetryListener,
    private readonly options: PollerOptions,
  ) {
    this.quickResponses = options.can;
    this.now = options.now ?? (() => Date.now());
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop(): void {
    this.running = false;
  }

  get isRunning(): boolean {
    return this.running;
  }

  // Speed samples per second over the last 3 s — shown in the UI so the
  // adapter's real performance is visible, not assumed.
  speedRateHz(): number {
    const t = this.now();
    const recent = this.speedTimes.filter((s) => t - s <= 3000);
    return recent.length / 3;
  }

  // One cycle: speed, then one secondary PID. Exposed for tests.
  async cycle(): Promise<void> {
    await this.readSpeed();
    const pid = this.options.secondary[this.nextSecondary % Math.max(1, this.options.secondary.length)];
    this.nextSecondary++;
    if (pid) await this.readParameter(pid);
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        await this.cycle();
      } catch (err) {
        if (err instanceof ConnectionLostError) {
          this.running = false;
          this.listener.onStopped('connection-lost');
          return;
        }
        // NO DATA / timeouts on one PID must not stop navigation telemetry.
        await delay(50);
      }
    }
    this.listener.onStopped('stopped');
  }

  private async readSpeed(): Promise<void> {
    const base = PID_DEFINITIONS.SPEED.command;
    let raw: string;
    try {
      raw = await this.port.send(this.quickResponses ? `${base}1` : base, SPEED_TIMEOUT_MS);
      parsePidResponse('SPEED', raw);
    } catch (err) {
      if (err instanceof ConnectionLostError || !this.quickResponses) throw err;
      // The adapter did not understand the response-count suffix.
      this.quickResponses = false;
      raw = await this.port.send(base, SPEED_TIMEOUT_MS);
    }
    const t = this.now();
    const kmh = parsePidResponse('SPEED', raw);
    this.speedTimes.push(t);
    if (this.speedTimes.length > 64) this.speedTimes.splice(0, this.speedTimes.length - 64);
    this.listener.onSpeed(kmh, t);
    this.listener.onParameter(toParameter('SPEED', kmh, t));
  }

  private async readParameter(pid: PidId): Promise<void> {
    const def = PID_DEFINITIONS[pid];
    const single = def.expectedResponseBytes != null && this.quickResponses;
    const raw = await this.port.send(single ? `${def.command}1` : def.command);
    this.listener.onParameter(toParameter(pid, parsePidResponse(pid, raw), this.now()));
  }
}

export function toParameter(pid: PidId, value: number, tMs: number): ObdParameter {
  const def = PID_DEFINITIONS[pid];
  let alert: ObdAlert | null = null;
  for (const a of def.alerts) {
    const hit = a.condition === 'above' ? value > a.value : value < a.value;
    if (!hit) continue;
    alert = { severity: a.severity, message: `${def.name} ${a.condition === 'above' ? '>' : '<'} ${a.value} ${def.unit}` };
    if (a.severity === 'critical') break;
  }
  return { pid, name: def.name, value, unit: def.unit, timestamp: new Date(tMs), alert };
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
