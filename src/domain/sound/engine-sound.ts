// Engine sound (2026-10-28): a few seconds of microphone audio at idle turned
// into a small fingerprint, compared with a reference the mechanic recorded
// when the engine was healthy. It is a comparison, not a diagnosis: it says
// what changed and where to look.
//
// - Only the fingerprint is kept, never the audio (privacy, and size).
// - Phone microphones cut below ~100 Hz, so the combustion pulses themselves
//   (25–60 Hz at idle) are not heard directly. Their rhythm is: the loudness
//   rises and falls with every firing. So the envelope (loudness every 5 ms)
//   is analysed too. A healthy four-stroke engine beats at the firing
//   frequency, rpm/60 × cylinders/2; a cylinder that misfires leaves a gap
//   that repeats once per cycle, every two turns, rpm/120: energy at that
//   frequency compared with the firing one is the misfire index.
// - The spectrum is split in bands and kept relative to the overall level,
//   so holding the phone a bit closer does not look like a change.
// - Roughness: how much the loudness varies frame to frame.

export const SOUND_RATE = 16_000;
const FRAME = 2048;
// Envelope: one loudness value every 5 ms (200 Hz).
const ENV_STEP = SOUND_RATE / 200;
const ENV_RATE = SOUND_RATE / ENV_STEP;
// Firing and cycle peaks are searched within ±6 % of the expected frequency.
const PEAK_TOLERANCE = 0.06;

export interface Band {
  readonly id: 'low' | 'low_mid' | 'high_mid' | 'high';
  readonly from: number;
  readonly to: number;
  readonly label: string;
}

export const BANDS: readonly Band[] = [
  { id: 'low', from: 60, to: 250, label: 'graves (escape, soportes, combustión)' },
  { id: 'low_mid', from: 250, to: 1000, label: 'medios bajos (ruidos mecánicos, golpeteo)' },
  { id: 'high_mid', from: 1000, to: 4000, label: 'medios altos (válvulas, inyectores, distribución)' },
  { id: 'high', from: 4000, to: 7800, label: 'agudos (correas, silbidos, rodamientos, pérdidas de vacío)' },
];

export interface SoundPrint {
  readonly at: number;
  readonly seconds: number;
  readonly rpm: number | null;
  readonly cylinders: number;
  readonly levelDb: number;
  // Each band's level relative to the whole, dB.
  readonly bands: Readonly<Record<Band['id'], number>>;
  // Frame-to-frame variation of the loudness (coefficient of variation).
  readonly roughness: number;
  // Envelope frequency of the firing actually found, Hz; null when no RPM and no clear peak.
  readonly firingHz: number | null;
  // Energy once per cycle relative to the firing (0 = none).
  readonly misfireIndex: number | null;
}

export function fingerprint(pcm: Int16Array, opts: { rpm: number | null; cylinders?: number; at: number; rate?: number }): SoundPrint {
  const rate = opts.rate ?? SOUND_RATE;
  const cylinders = opts.cylinders ?? 4;
  const x = Float32Array.from(pcm, (v) => v / 32768);
  const rms = Math.sqrt(x.reduce((s, v) => s + v * v, 0) / Math.max(1, x.length));
  const levelDb = 20 * Math.log10(Math.max(rms, 1e-9));

  // Mean power spectrum over Hann-windowed frames.
  const power = new Float64Array(FRAME / 2);
  let frames = 0;
  const win = hann(FRAME);
  for (let start = 0; start + FRAME <= x.length; start += FRAME) {
    const re = new Float64Array(FRAME);
    const im = new Float64Array(FRAME);
    for (let i = 0; i < FRAME; i++) re[i] = x[start + i]! * win[i]!;
    fft(re, im);
    for (let k = 0; k < FRAME / 2; k++) power[k]! += re[k]! * re[k]! + im[k]! * im[k]!;
    frames++;
  }
  const binHz = rate / FRAME;
  const bandPower = (from: number, to: number) => {
    let s = 0;
    for (let k = Math.ceil(from / binHz); k <= Math.min(FRAME / 2 - 1, Math.floor(to / binHz)); k++) s += power[k]!;
    return s / Math.max(1, frames);
  };
  const total = BANDS.reduce((s, b) => s + bandPower(b.from, b.to), 0);
  const bands = Object.fromEntries(BANDS.map((b) => [b.id, round1(10 * Math.log10(Math.max(bandPower(b.from, b.to), 1e-12) / Math.max(total, 1e-12)))])) as Record<Band['id'], number>;

  // Loudness envelope and its variation.
  const env = envelope(x, rate);
  const mean = env.reduce((s, v) => s + v, 0) / Math.max(1, env.length);
  const sd = Math.sqrt(env.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, env.length));
  const roughness = mean > 0 ? round3(sd / mean) : 0;

  // The envelope's spectrum: firing and cycle.
  const spec = envelopeSpectrum(env, mean);
  const expected = opts.rpm != null && opts.rpm > 0 ? (opts.rpm / 60) * (cylinders / 2) : null;
  const firing = expected != null ? peakNear(spec, expected) : strongest(spec, 12, 90);
  let misfireIndex: number | null = null;
  if (firing) {
    const cycleHz = firing.hz / (cylinders / 2);
    const cycle = peakNear(spec, cycleHz);
    misfireIndex = cycle && firing.amp > 0 ? round3(cycle.amp / firing.amp) : null;
  }
  return {
    at: opts.at,
    seconds: round1(pcm.length / rate),
    rpm: opts.rpm,
    cylinders,
    levelDb: round1(levelDb),
    bands,
    roughness,
    firingHz: firing ? round1(firing.hz) : null,
    misfireIndex,
  };
}

export interface SoundComparison {
  readonly verdict: 'similar' | 'changed';
  readonly findings: readonly string[];
  // Reasons the comparison is weaker than it could be.
  readonly caveats: readonly string[];
}

// A band this much louder or quieter (relative) than the reference is a change.
export const BAND_CHANGE_DB = 6;
const ROUGHNESS_RATIO = 1.6;
const MISFIRE_RATIO = 2;
const MISFIRE_MIN = 0.35;
const RPM_TOLERANCE = 0.15;

export function compare(reference: SoundPrint, now: SoundPrint): SoundComparison {
  const findings: string[] = [];
  const caveats: string[] = [];
  if (reference.rpm != null && now.rpm != null && Math.abs(now.rpm - reference.rpm) > RPM_TOLERANCE * reference.rpm) {
    caveats.push(`Las vueltas no son las mismas que en la referencia (${Math.round(now.rpm)} contra ${Math.round(reference.rpm)} rpm): repetí en ralentí y con el motor caliente.`);
  }
  if (now.rpm == null) caveats.push('Sin las rpm del auto: la frecuencia de encendido se estimó del sonido.');
  for (const b of BANDS) {
    const diff = now.bands[b.id] - reference.bands[b.id];
    if (diff >= BAND_CHANGE_DB) findings.push(`Más fuerte que en la referencia en los ${b.label}: +${round1(diff)} dB.`);
    else if (diff <= -BAND_CHANGE_DB) findings.push(`Más débil que en la referencia en los ${b.label}: ${round1(diff)} dB.`);
  }
  if (reference.roughness > 0 && now.roughness / reference.roughness >= ROUGHNESS_RATIO) {
    findings.push(`El motor suena más irregular que en la referencia (variación ${fmt(now.roughness)} contra ${fmt(reference.roughness)}).`);
  }
  if (now.misfireIndex != null && now.misfireIndex >= MISFIRE_MIN && now.misfireIndex >= MISFIRE_RATIO * Math.max(reference.misfireIndex ?? 0, 0.05)) {
    findings.push('Aparece un golpe que se repite cada dos vueltas: típico de un cilindro que falla (bujía, bobina, inyector). Conviene leer los códigos y contar fallas por cilindro.');
  }
  if (Math.abs(now.levelDb - reference.levelDb) >= 10) caveats.push('El volumen general es muy distinto: grabá a la misma distancia y en el mismo lugar que la referencia.');
  return { verdict: findings.length ? 'changed' : 'similar', findings, caveats };
}

// ── signal helpers ──────────────────────────────────────────────────────────

function envelope(x: Float32Array, rate: number): Float64Array {
  const step = Math.round((rate / SOUND_RATE) * ENV_STEP);
  const n = Math.floor(x.length / step);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < step; j++) s += x[i * step + j]! ** 2;
    out[i] = Math.sqrt(s / step);
  }
  return out;
}

interface Spectrum {
  readonly amp: Float64Array;
  readonly binHz: number;
}

function envelopeSpectrum(env: Float64Array, mean: number): Spectrum {
  let size = 1;
  while (size < env.length) size *= 2;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const win = hann(env.length);
  for (let i = 0; i < env.length; i++) re[i] = (env[i]! - mean) * win[i]!;
  fft(re, im);
  const amp = new Float64Array(size / 2);
  for (let k = 0; k < size / 2; k++) amp[k] = Math.hypot(re[k]!, im[k]!);
  return { amp, binHz: ENV_RATE / size };
}

function peakNear(s: Spectrum, hz: number): { hz: number; amp: number } | null {
  const from = Math.max(1, Math.floor((hz * (1 - PEAK_TOLERANCE)) / s.binHz));
  const to = Math.min(s.amp.length - 1, Math.ceil((hz * (1 + PEAK_TOLERANCE)) / s.binHz));
  if (from > to) return null;
  let best = from;
  for (let k = from; k <= to; k++) if (s.amp[k]! > s.amp[best]!) best = k;
  return { hz: best * s.binHz, amp: s.amp[best]! };
}

function strongest(s: Spectrum, fromHz: number, toHz: number): { hz: number; amp: number } | null {
  const from = Math.max(1, Math.floor(fromHz / s.binHz));
  const to = Math.min(s.amp.length - 1, Math.ceil(toHz / s.binHz));
  if (from > to) return null;
  let best = from;
  for (let k = from; k <= to; k++) if (s.amp[k]! > s.amp[best]!) best = k;
  return { hz: best * s.binHz, amp: s.amp[best]! };
}

function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, n - 1));
  return w;
}

// In-place iterative radix-2 FFT; the length must be a power of two.
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cRe = 1;
      let cIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const aRe = re[i + k]!;
        const aIm = im[i + k]!;
        const bRe = re[i + k + len / 2]! * cRe - im[i + k + len / 2]! * cIm;
        const bIm = re[i + k + len / 2]! * cIm + im[i + k + len / 2]! * cRe;
        re[i + k] = aRe + bRe;
        im[i + k] = aIm + bIm;
        re[i + k + len / 2] = aRe - bRe;
        im[i + k + len / 2] = aIm - bIm;
        const t = cRe * wRe - cIm * wIm;
        cIm = cRe * wIm + cIm * wRe;
        cRe = t;
      }
    }
  }
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function fmt(v: number): string {
  return String(round3(v)).replace('.', ',');
}
