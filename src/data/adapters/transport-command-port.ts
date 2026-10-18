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
// ERR94 (ELM327: fatal CAN error) also resets the chip to its defaults.
const LV_RESET = /\bLV RESET\b|\bERR94\b/;

// Other internal adapter errors ("ERRxx"): nothing usable came back.
const INTERNAL_ERROR = /^ERR[0-9A-F]{2}$/;

// "Response pending" (7F <mode> 78): the ECU is busy and will answer later.
// ELM327 v2.1+ and STN wait for the real answer themselves; older ELM327 and
// clones return to the prompt. J1979: wait up to 5 s, restarting on every new
// pending; then the request is sent again (the ECU answers at once if done).
const PENDING_WAIT_MS = 5000;
const MAX_PENDING_RESENDS = 2;
// One pending frame per whitespace token (ATS0), with an optional CAN ID (11 or
// 29 bit) and PCI byte when headers are on; the spaced form for ATS1.
const PENDING_TOKEN = /^(?:[0-9A-F]{3}|[0-9A-F]{8})?(?:03)?7F[0-9A-F]{2}78$/i;
const PENDING_SPACED = /(?:^|\s)(?:03 )?7F [0-9A-F]{2} 78(?=\s|$)/gi;

interface Pending {
  command: string;
  resolve: (response: string) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  timeoutMs: number;
  resends: number;
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
      const timer = this.timeout(command, timeoutMs, reject);
      this.pending = { command, resolve, reject, timer, timeoutMs, resends: 0 };
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
      const cleaned = clean(raw, pending.command);
      const response = withoutPending(cleaned);
      if (response === '' && cleaned !== '') {
        this.awaitPending(pending);
        continue;
      }
      const compact = response.toUpperCase().replace(/\s/g, '');
      if (NO_DATA.has(compact) || INTERNAL_ERROR.test(compact) || CORRUPT_MARKERS.some((m) => compact.includes(m))) {
        pending.reject(new NoDataError(pending.command));
      } else {
        pending.resolve(response);
      }
    }
  }

  private timeout(command: string, ms: number, reject: (reason: unknown) => void): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      this.pending = null;
      this.framer.reset(); // drop late bytes so they cannot answer the next command
      reject(new CommandTimeoutError(command, ms));
    }, ms);
  }

  // Only "response pending" came back and the adapter returned to the prompt.
  // Keep the command in flight: wait for more output, then ask again.
  private awaitPending(pending: Pending): void {
    this.pending = pending;
    pending.timer = setTimeout(() => {
      if (this.pending !== pending) return;
      if (pending.resends >= MAX_PENDING_RESENDS) {
        this.pending = null;
        this.framer.reset();
        pending.reject(new CommandTimeoutError(pending.command, PENDING_WAIT_MS));
        return;
      }
      pending.resends += 1;
      this.framer.reset();
      pending.timer = this.timeout(pending.command, pending.timeoutMs, pending.reject);
      this.transport.write(`${pending.command}\r`).catch((err: unknown) => {
        this.failPending(new ConnectionLostError(`Write failed: ${String(err)}`, err));
      });
    }, PENDING_WAIT_MS);
  }

  private failPending(error: unknown): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.reject(error);
  }
}

// Drops "response pending" frames; what remains is the real answer, if any.
function withoutPending(response: string): string {
  return response
    .replace(PENDING_SPACED, ' ')
    .split(' ')
    .filter((token) => token !== '' && !PENDING_TOKEN.test(token))
    .join(' ');
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
