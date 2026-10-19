// One spoken phrase to obdient-tools' /tools/v1/stt (Voxtral Realtime behind
// it): audio goes in as it is captured, partial text comes back, and finish()
// gives the final text. Protocol in server/tools/src/stt-proxy.mjs.

export type SttEvent =
  | { readonly type: 'ready' }
  | { readonly type: 'partial'; readonly text: string }
  | { readonly type: 'error'; readonly error: string };

// What the session needs from a WebSocket (React Native's takes headers as a
// third argument; tests pass a fake).
export interface SocketLike {
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
  close(): void;
}
export type SocketFactory = (url: string, headers: Record<string, string>) => SocketLike;

const OPEN = 1;
// After the last audio, the final text arrives in well under a second.
const FINAL_TIMEOUT_MS = 4_000;

export class RealtimeSttSession {
  private socket: SocketLike;
  private text = '';
  private pending: string[] = [];
  private finalResolve: ((text: string) => void) | null = null;
  private finalReject: ((err: Error) => void) | null = null;
  private failed: string | null = null;
  private done = false;

  constructor(url: string, key: string, private readonly onEvent: (e: SttEvent) => void, connect: SocketFactory) {
    this.socket = connect(url, { Authorization: `Bearer ${key}` });
    this.socket.onopen = () => {
      for (const p of this.pending.splice(0)) this.socket.send(p);
    };
    this.socket.onmessage = (e) => this.receive(String(e.data));
    this.socket.onerror = () => this.fail('stt_unavailable');
    this.socket.onclose = () => {
      if (!this.done) this.fail('stt_closed');
    };
  }

  // Base64 PCM16, 16 kHz mono.
  sendAudio(base64: string): void {
    this.post({ type: 'input_audio_buffer.append', audio: base64 });
  }

  // End of the phrase: resolves with the final text.
  finish(): Promise<string> {
    if (this.failed) return Promise.reject(new Error(this.failed));
    if (this.done) return Promise.resolve(this.text.trim());
    this.post({ type: 'input_audio_buffer.commit', final: true });
    return new Promise((resolve, reject) => {
      this.finalResolve = resolve;
      this.finalReject = reject;
      setTimeout(() => {
        // No final event: what came as partials is the best there is.
        if (!this.done && this.text.trim()) this.complete(this.text);
        else if (!this.done) this.fail('stt_timeout');
      }, FINAL_TIMEOUT_MS);
    });
  }

  cancel(): void {
    this.done = true;
    try {
      this.socket.close();
    } catch {
      // already closed
    }
  }

  private post(obj: object): void {
    const msg = JSON.stringify(obj);
    if (this.socket.readyState === OPEN) this.socket.send(msg);
    else this.pending.push(msg);
  }

  private receive(raw: string): void {
    let m: { type?: string; delta?: string; text?: string; error?: string };
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (m.type === 'ready') this.onEvent({ type: 'ready' });
    else if (m.type === 'transcription.delta') {
      this.text += m.delta ?? '';
      this.onEvent({ type: 'partial', text: this.text.trim() });
    } else if (m.type === 'transcription.done') this.complete(m.text ?? this.text);
    else if (m.type === 'error') this.fail(m.error ?? 'stt_error');
  }

  private complete(text: string): void {
    this.done = true;
    this.text = text;
    this.finalResolve?.(text.trim());
    this.cancel();
  }

  private fail(error: string): void {
    if (this.done || this.failed) return;
    this.failed = error;
    this.onEvent({ type: 'error', error });
    this.finalReject?.(new Error(error));
    this.cancel();
  }
}

// React Native's WebSocket, with headers.
export const nativeSocket: SocketFactory = (url, headers) =>
  new (WebSocket as unknown as new (u: string, p: undefined, o: { headers: Record<string, string> }) => SocketLike)(url, undefined, { headers });
