// Microphone audio for the speech server (M6): PCM16 mono at 16 kHz, as
// Voxtral Realtime expects it, and the silence that ends a phrase.

export const STT_RATE = 16_000;

// Linear resampling of int16 samples (the phone may not deliver 16 kHz).
export function resample(input: Int16Array, fromRate: number, toRate = STT_RATE): Int16Array {
  if (fromRate === toRate || input.length === 0) return input;
  const outLength = Math.floor((input.length * toRate) / fromRate);
  const out = new Int16Array(outLength);
  const step = fromRate / toRate;
  for (let i = 0; i < outLength; i++) {
    const x = i * step;
    const j = Math.floor(x);
    const a = input[j]!;
    const b = input[Math.min(j + 1, input.length - 1)]!;
    out[i] = Math.round(a + (b - a) * (x - j));
  }
  return out;
}

// Interleaved channels → mono (average).
export function toMono(input: Int16Array, channels: number): Int16Array {
  if (channels <= 1) return input;
  const out = new Int16Array(Math.floor(input.length / channels));
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += input[i * channels + c]!;
    out[i] = Math.round(sum / channels);
  }
  return out;
}

// Loudness of a chunk, 0..1.
export function rms(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / samples.length) / 32768;
}

export interface SilenceOptions {
  // Louder than this is voice. The car's noise floor sits well below normal speech.
  readonly speechLevel: number;
  // Quiet this long after speaking ends the phrase.
  readonly endSilenceMs: number;
  // Nothing said in this long: give up.
  readonly noSpeechMs: number;
  // A phrase is never longer than this.
  readonly maxMs: number;
}

export const SILENCE: SilenceOptions = { speechLevel: 0.035, endSilenceMs: 1_200, noSpeechMs: 6_000, maxMs: 20_000 };

export type PhraseState = 'waiting' | 'speaking' | 'ended' | 'no_speech';

// Fed chunk by chunk; says when the phrase is over.
export class SilenceDetector {
  private elapsed = 0;
  private quiet = 0;
  private spoke = false;

  constructor(private readonly o: SilenceOptions = SILENCE) {}

  push(level: number, durationMs: number): PhraseState {
    this.elapsed += durationMs;
    if (level >= this.o.speechLevel) {
      this.spoke = true;
      this.quiet = 0;
    } else {
      this.quiet += durationMs;
    }
    if (this.elapsed >= this.o.maxMs) return this.spoke ? 'ended' : 'no_speech';
    if (!this.spoke) return this.elapsed >= this.o.noSpeechMs ? 'no_speech' : 'waiting';
    return this.quiet >= this.o.endSilenceMs ? 'ended' : 'speaking';
  }
}

// Bytes → base64 (Hermes has btoa, but not for binary strings of this size in one go).
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + ALPHABET[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + '==';
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + '=';
  }
  return out;
}

// PCM16 little-endian bytes of the samples.
export function pcm16Bytes(samples: Int16Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i]!;
    out[i * 2] = v & 0xff;
    out[i * 2 + 1] = (v >> 8) & 0xff;
  }
  return out;
}
