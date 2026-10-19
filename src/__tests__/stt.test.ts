import { RealtimeSttSession, type SocketLike, type SttEvent } from '@/data/stt/realtime-stt';
import { bytesToBase64, pcm16Bytes, resample, rms, SilenceDetector, toMono } from '@/domain/voice/pcm';

describe('pcm', () => {
  it('resamples 48 kHz to 16 kHz and mixes to mono', () => {
    const tone = Int16Array.from({ length: 480 }, (_, i) => Math.round(1000 * Math.sin(i / 10)));
    expect(resample(tone, 48_000).length).toBe(160);
    expect(resample(tone, 16_000)).toBe(tone);
    expect(Array.from(toMono(Int16Array.from([100, 300, -100, -300]), 2))).toEqual([200, -200]);
  });

  it('PCM16 little-endian, base64 like Node', () => {
    const s = Int16Array.from([1, -2, 32767, -32768, 258]);
    const bytes = pcm16Bytes(s);
    expect(Array.from(bytes.slice(0, 4))).toEqual([1, 0, 0xfe, 0xff]);
    expect(Array.from(bytes)).toEqual([1, 0, 0xfe, 0xff, 0xff, 0x7f, 0x00, 0x80, 0x02, 0x01]);
    expect(bytesToBase64(bytes.slice(0, 0))).toBe('');
    expect(bytesToBase64(bytes.slice(0, 1))).toBe('AQ==');
    expect(bytesToBase64(bytes.slice(0, 2))).toBe('AQA=');
    expect(bytesToBase64(bytes.slice(0, 3))).toBe('AQD+');
    expect(bytesToBase64(bytes.slice(0, 10))).toBe('AQD+//9/AIACAQ==');
  });

  it('a phrase ends after the silence that follows speech', () => {
    const d = new SilenceDetector({ speechLevel: 0.05, endSilenceMs: 1000, noSpeechMs: 3000, maxMs: 10_000 });
    expect(d.push(0.01, 500)).toBe('waiting');
    expect(d.push(0.2, 500)).toBe('speaking');
    expect(d.push(0.01, 500)).toBe('speaking');
    expect(d.push(0.01, 500)).toBe('ended');
    const silent = new SilenceDetector({ speechLevel: 0.05, endSilenceMs: 1000, noSpeechMs: 3000, maxMs: 10_000 });
    expect(silent.push(0.01, 3000)).toBe('no_speech');
    expect(rms(Int16Array.from([16384, -16384]))).toBeCloseTo(0.5, 3);
  });
});

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onclose: (() => void) | null = null;
  headers: Record<string, string> = {};
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  server(obj: object) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
}

describe('realtime STT session', () => {
  function make() {
    const sock = new FakeSocket();
    const events: SttEvent[] = [];
    const s = new RealtimeSttSession('wss://x/tools/v1/stt', 'sk-1', (e) => events.push(e), (_u, h) => ((sock.headers = h), sock));
    return { s, sock, events };
  }

  it('audio before the socket opens is sent in order; partials, then the final text', async () => {
    const { s, sock, events } = make();
    expect(sock.headers).toEqual({ Authorization: 'Bearer sk-1' });
    s.sendAudio('AAA=');
    sock.open();
    s.sendAudio('BBB=');
    sock.server({ type: 'ready' });
    sock.server({ type: 'transcription.delta', delta: '¿Cuánto ' });
    sock.server({ type: 'transcription.delta', delta: 'falta?' });
    const final = s.finish();
    sock.server({ type: 'transcription.done', text: '¿Cuánto falta?' });
    await expect(final).resolves.toBe('¿Cuánto falta?');
    expect(sock.sent.map((m) => JSON.parse(m).type)).toEqual(['input_audio_buffer.append', 'input_audio_buffer.append', 'input_audio_buffer.commit']);
    expect(JSON.parse(sock.sent[2]!)).toEqual({ type: 'input_audio_buffer.commit', final: true });
    expect(events).toEqual([{ type: 'ready' }, { type: 'partial', text: '¿Cuánto' }, { type: 'partial', text: '¿Cuánto falta?' }]);
  });

  it('a server error reaches the screen and the final promise', async () => {
    const { s, sock, events } = make();
    sock.open();
    sock.server({ type: 'error', error: 'stt_unavailable' });
    expect(events).toEqual([{ type: 'error', error: 'stt_unavailable' }]);
    await expect(s.finish()).rejects.toThrow('stt_unavailable');
  });

  it('no final event: the partial text is the answer after the timeout', async () => {
    jest.useFakeTimers();
    try {
      const { s, sock } = make();
      sock.open();
      sock.server({ type: 'transcription.delta', delta: 'hola' });
      const final = s.finish();
      jest.advanceTimersByTime(5_000);
      await expect(final).resolves.toBe('hola');
    } finally {
      jest.useRealTimers();
    }
  });
});
