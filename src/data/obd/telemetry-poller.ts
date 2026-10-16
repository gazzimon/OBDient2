// Live telemetry loop for navigation.
//
// Speed is what the AR and the ego estimator need, so it is asked every cycle;
// the dashboard PIDs share the remaining slots round-robin. The adapter is
// strictly one-command-at-a-time, so the loop rate is set by its round-trip.
//
// The round-trip is dominated by the adapter waiting out its timeout (102 ms
// by default) for more ECUs to answer. Telling it how many replies to expect
// lets it return on the first one. Three ways to ask, fastest first:
//
//   'stpx'  – STPX d:010D, r:1, t:100   documented STN command (FRPM §8.6)
//   'count' – 010D1                      ELM327 ≥1.3 response-count suffix, CAN only
//   'plain' – 010D                       always works, slowest
//
// A style is dropped for the session only when the next one succeeds where it
// failed — twice. A genuine NO DATA fails every style and demotes nothing; one
// glitch on the bus does not cost the fast path forever.

import { PID_DEFINITIONS, type PidId } from '@/core/constants/pids';
import { AdapterResetError, ConnectionLostError } from '@/core/errors/obd.errors';
import { parsePidResponse } from '@/core/utils/obdParser';
import type { CommandPort } from '@/data/adapters/protocol-manager';
import type { ObdAlert, ObdParameter } from '@/domain/entities/obd-parameter';

export type RequestStyle = 'stpx' | 'count' | 'plain';

export interface TelemetryListener {
  onSpeed(kmh: number, tMs: number): void;
  onParameter(param: ObdParameter): void;
  onStopped(reason: 'stopped' | 'connection-lost'): void;
}

export interface PollerOptions {
  // Preferred request styles, fastest first. Must end with 'plain'.
  readonly styles: readonly RequestStyle[];
  // Secondary PIDs, already filtered to what the car supports.
  readonly secondary: readonly PidId[];
  readonly now?: () => number;
}

export const SECONDARY_PIDS: readonly PidId[] = ['RPM', 'TPS', 'COOLANT_TEMP', 'VOLTAGE', 'ENGINE_LOAD'];

// Styles worth trying for this adapter and bus.
export function stylesFor(stn: boolean, can: boolean): RequestStyle[] {
  return [...(stn ? (['stpx'] as const) : []), ...(can ? (['count'] as const) : []), 'plain'];
}

// The wire command for a mode-01 request in a given style.
export function requestFor(style: RequestStyle, command: string): string {
  switch (style) {
    case 'stpx':
      return `STPX d:${command}, r:1, t:100`;
    case 'count':
      return `${command}1`;
    case 'plain':
      return command;
  }
}

const SPEED_TIMEOUT_MS = 1000;
const STRIKES_TO_DEMOTE = 2;
// A secondary PID that keeps failing is dropped: every failed request costs
// a full round-trip in every style, time taken from the speed readings.
const SECONDARY_FAILURES_TO_DROP = 3;

export class TelemetryPoller {
  private running = false;
  private styleIndex = 0;
  private strikes = 0;
  private nextSecondary = 0;
  private readonly secondaryFailures = new Map<PidId, number>();
  private speedTimes: number[] = [];
  private readonly now: () => number;

  constructor(
    private readonly port: CommandPort,
    private readonly listener: TelemetryListener,
    private readonly options: PollerOptions,
  ) {
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

  // The style currently in use — shown in the UI next to the measured rate.
  get style(): RequestStyle {
    return this.options.styles[this.styleIndex] ?? 'plain';
  }

  // Speed samples per second over the last 3 s — shown in the UI so the
  // adapter's real performance is visible, not assumed.
  speedRateHz(): number {
    const t = this.now();
    const recent = this.speedTimes.filter((s) => t - s <= 3000);
    return recent.length / 3;
  }

  // One cycle: speed, then one secondary PID. Exposed for tests.
  // Only a speed failure (or a dead link / reset) fails the cycle: secondary
  // PIDs are dashboard extras and must never slow navigation down.
  async cycle(): Promise<void> {
    await this.readSpeed();
    const pid = this.nextSecondaryPid();
    if (!pid) return;
    try {
      await this.readParameter(pid);
      this.secondaryFailures.delete(pid);
    } catch (err) {
      if (err instanceof ConnectionLostError || err instanceof AdapterResetError) throw err;
      this.secondaryFailures.set(pid, (this.secondaryFailures.get(pid) ?? 0) + 1);
    }
  }

  private nextSecondaryPid(): PidId | undefined {
    const live = this.options.secondary.filter(
      (p) => (this.secondaryFailures.get(p) ?? 0) < SECONDARY_FAILURES_TO_DROP,
    );
    if (!live.length) return undefined;
    return live[this.nextSecondary++ % live.length];
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
        // NO DATA, timeouts, an adapter reset (the session re-initialises it):
        // none of them may stop navigation telemetry.
        await delay(err instanceof AdapterResetError ? 500 : 50);
      }
    }
    this.listener.onStopped('stopped');
  }

  private async readSpeed(): Promise<void> {
    const kmh = await this.request(PID_DEFINITIONS.SPEED.command, (raw) => parsePidResponse('SPEED', raw), SPEED_TIMEOUT_MS);
    const t = this.now();
    this.speedTimes.push(t);
    if (this.speedTimes.length > 64) this.speedTimes.splice(0, this.speedTimes.length - 64);
    this.listener.onSpeed(kmh, t);
    this.listener.onParameter(toParameter('SPEED', kmh, t));
  }

  private async readParameter(pid: PidId): Promise<void> {
    const def = PID_DEFINITIONS[pid];
    const parse = (raw: string) => parsePidResponse(pid, raw);
    // Adapter commands (ATRV) have no request styles.
    const value =
      def.expectedResponseBytes == null ? parse(await this.port.send(def.command)) : await this.request(def.command, parse);
    this.listener.onParameter(toParameter(pid, value, this.now()));
  }

  // Sends `command` in the current style, falling back through the slower
  // ones. A response that does not parse counts as a failure of that style.
  private async request<T>(command: string, parse: (raw: string) => T, timeoutMs?: number): Promise<T> {
    const styles = this.options.styles;
    let lastError: unknown = null;
    for (let i = this.styleIndex; i < styles.length; i++) {
      try {
        const value = parse(await this.port.send(requestFor(styles[i]!, command), timeoutMs));
        if (i > this.styleIndex) this.strike();
        else this.strikes = 0;
        return value;
      } catch (err) {
        if (err instanceof ConnectionLostError || err instanceof AdapterResetError) throw err;
        lastError = err;
      }
    }
    throw lastError;
  }

  // A slower style worked where the current one failed.
  private strike(): void {
    this.strikes++;
    if (this.strikes >= STRIKES_TO_DEMOTE && this.styleIndex < this.options.styles.length - 1) {
      this.styleIndex++;
      this.strikes = 0;
    }
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
