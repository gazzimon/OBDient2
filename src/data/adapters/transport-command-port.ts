// CommandPort over any ByteTransport: one command in flight at a time,
// responses framed at the '>' prompt, echo stripped, errors typed.

import {
  AdapterResetError,
  CommandTimeoutError,
  ConnectionLostError,
  NoDataError,
} from '@/core/errors/obd.errors';
import { PromptFramer } from './prompt-framer';
import type { CommandPort } from './protocol-manager';
import { Listeners, type ByteTransport, type Unsubscribe } from './transport';

const DEFAULT_TIMEOUT_MS = 4000;

// Adapter replies that mean "nothing usable came back". Matched on the whole
// response (spaces removed), so "BUS INIT: OK" and real data never match.
// ELM327 set plus the STN additions (OBD Family Reference Manual §9).
const NO_DATA = new Set([
  'NODATA',
  'ERROR',
  'UNABLETOCONNECT',
  'BUSINIT',
  'CANERROR',
  'BUFFERFULL',
  'BUSBUSY',
  'BUSERROR',
  'DATAERROR',
  'FBERROR',
  'FCRXTIMEOUT',
  'OUTOFMEMORY',
  'STOPPED',
  'UARTRXOVERFLOW',
]);

// Appended after a frame that failed its CRC/checksum: the bytes before it
// cannot be trusted, so the whole response is a failure.
const CORRUPT_MARKERS = ['<DATAERROR', '<RXERROR'];

// Unsolicited PowerSave warnings (ELM327 low-power mode). Never part of an answer.
const ALERTS = /\b(?:ACT|LP) ALERT\b/g;

// Printed by the adapter after a brown-out reboot. See AdapterResetError.
const LV_RESET = /\bLV RESET\b/;

interface Pending {
  command: string;
  resolve: (response: string) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class TransportCommandPort implements CommandPort {
  private readonly framer = new PromptFramer();
  private pending: Pending | null = null;
  private queue: Promise<void> = Promise.resolve();
  private readonly unsubscribers: Unsubscribe[];
  private readonly resets = new Listeners<[]>();

  constructor(
    private readonly transport: ByteTransport,
    private readonly defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    this.unsubscribers = [
      transport.onData((chunk) => this.handleChunk(chunk)),
      transport.onDisconnect(() => this.failPending(new ConnectionLostError('Adapter link dropped'))),
    ];
  }

  send(command: string, timeoutMs = this.defaultTimeoutMs): Promise<string> {
    // The queue chain never rejects, so one failed command cannot starve the rest.
    const result = this.queue.then(() => this.execute(command, timeoutMs));
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  // Fires when the adapter reports it rebooted itself (LV RESET), whether or
  // not a command was in flight. The owner must re-initialise the session.
  onAdapterReset(listener: () => void): Unsubscribe {
    return this.resets.add(listener);
  }

  dispose(): void {
    for (const off of this.unsubscribers) off();
    this.resets.clear();
    this.failPending(new ConnectionLostError('Port disposed'));
  }

  private async execute(command: string, timeoutMs: number): Promise<string> {
    if (!this.transport.isConnected()) throw new ConnectionLostError('No adapter connected');
    this.framer.reset();

    // Arm the response handler BEFORE writing: fast adapters answer immediately.
    const response = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        this.framer.reset(); // drop late bytes so they cannot answer the next command
        reject(new CommandTimeoutError(command, timeoutMs));
      }, timeoutMs);
      this.pending = { command, resolve, reject, timer };
    });

    try {
      await this.transport.write(`${command}\r`);
    } catch (err) {
      this.failPending(new ConnectionLostError(`Write failed: ${String(err)}`, err));
    }
    return response;
  }

  private handleChunk(chunk: string): void {
    for (const raw of this.framer.feed(chunk)) {
      const pending = this.pending;
      const reset = LV_RESET.test(raw.toUpperCase());
      if (reset) this.resets.emit();
      if (!pending) continue; // unsolicited output (e.g. adapter banner) — ignore
      this.pending = null;
      clearTimeout(pending.timer);

      if (reset) {
        pending.reject(new AdapterResetError(pending.command));
        continue;
      }
      const response = clean(raw, pending.command);
      const compact = response.toUpperCase().replace(/\s/g, '');
      if (NO_DATA.has(compact) || CORRUPT_MARKERS.some((m) => compact.includes(m))) {
        pending.reject(new NoDataError(pending.command));
      } else {
        pending.resolve(response);
      }
    }
  }

  private failPending(error: unknown): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.reject(error);
  }
}

// Strips the command echo (before ATE0 takes effect) and the "SEARCHING..." banner.
function clean(raw: string, command: string): string {
  let text = raw;
  if (text.toUpperCase().startsWith(command.toUpperCase())) {
    text = text.slice(command.length);
  }
  return text
    .replace(ALERTS, ' ')
    .replace(/^\s*SEARCHING\.\.\.\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}
