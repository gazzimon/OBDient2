// CommandPort over any ByteTransport: one command in flight at a time,
// responses framed at the '>' prompt, echo stripped, errors typed.

import {
  CommandTimeoutError,
  ConnectionLostError,
  NoDataError,
} from '@/core/errors/obd.errors';
import { PromptFramer } from './prompt-framer';
import type { CommandPort } from './protocol-manager';
import type { ByteTransport, Unsubscribe } from './transport';

const DEFAULT_TIMEOUT_MS = 4000;

// Adapter replies that mean "nothing usable came back". Matched on the whole
// response (spaces removed), so "BUS INIT: OK" and real data never match.
const NO_DATA = new Set(['NODATA', 'ERROR', 'UNABLETOCONNECT', 'BUSINIT', 'CANERROR']);

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

  dispose(): void {
    for (const off of this.unsubscribers) off();
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
      if (!pending) continue; // unsolicited output (e.g. adapter banner) — ignore
      this.pending = null;
      clearTimeout(pending.timer);

      const response = clean(raw, pending.command);
      if (NO_DATA.has(response.toUpperCase().replace(/\s/g, ''))) {
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
  return text.replace(/^\s*SEARCHING\.\.\.\s*/i, '').trim();
}
