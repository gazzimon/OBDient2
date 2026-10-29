import { compare, fft, fingerprint, SOUND_RATE } from '@/domain/sound/engine-sound';

// A synthetic engine: noise whose loudness pulses at every firing. With a
// misfiring cylinder, one firing in four is missing.
function engine(opts: { rpm: number; seconds?: number; misfire?: boolean; hiss?: boolean; seed?: number }): Int16Array {
  const seconds = opts.seconds ?? 6;
  const n = SOUND_RATE * seconds;
  const out = new Int16Array(n);
  const firingHz = (opts.rpm / 60) * 2; // four cylinders
  let seed = opts.seed ?? 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  // Low-passed noise: an engine's energy is mostly low, like a real recording.
  let low = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SOUND_RATE;
    const phase = t * firingHz;
    const firing = Math.floor(phase);
    const inPulse = phase - firing < 0.3;
    const missing = opts.misfire && firing % 4 === 0;
    const amp = inPulse && !missing ? 1 : 0.25;
    low = 0.9 * low + 0.1 * rand();
    let v = low * amp * 2;
    if (opts.hiss) v += 0.1 * Math.sin(2 * Math.PI * 6000 * t);
    out[i] = Math.round(v * 32767 * 0.5);
  }
  return out;
}

describe('fingerprint', () => {
  it('finds the firing rhythm from the RPM, and no misfire on a healthy engine', () => {
    const p = fingerprint(engine({ rpm: 900 }), { rpm: 900, at: 0 });
    expect(p.firingHz).toBeCloseTo(30, 0);
    expect(p.misfireIndex).not.toBeNull();
    expect(p.misfireIndex!).toBeLessThan(0.3);
    expect(p.seconds).toBe(6);
  });

  it('a missing firing shows as energy once per cycle', () => {
    const healthy = fingerprint(engine({ rpm: 900 }), { rpm: 900, at: 0 });
    const sick = fingerprint(engine({ rpm: 900, misfire: true }), { rpm: 900, at: 0 });
    expect(sick.misfireIndex!).toBeGreaterThan(healthy.misfireIndex! * 3);
  });

  it('without the RPM it estimates the firing from the sound', () => {
    expect(fingerprint(engine({ rpm: 1200 }), { rpm: null, at: 0 }).firingHz).toBeCloseTo(40, 0);
  });
});

describe('compare', () => {
  const ref = fingerprint(engine({ rpm: 900 }), { rpm: 900, at: 0 });

  it('the same engine again is similar', () => {
    const again = fingerprint(engine({ rpm: 900, seed: 99 }), { rpm: 880, at: 1 });
    expect(compare(ref, again)).toMatchObject({ verdict: 'similar', findings: [], caveats: [] });
  });

  it('a misfire and a new whistle are reported', () => {
    const now = fingerprint(engine({ rpm: 900, misfire: true, hiss: true }), { rpm: 900, at: 1 });
    const c = compare(ref, now);
    expect(c.verdict).toBe('changed');
    expect(c.findings.join(' ')).toMatch(/Más fuerte .* agudos/);
    expect(c.findings.join(' ')).toMatch(/cilindro que falla/);
  });

  it('warns when the RPM are not the reference ones', () => {
    const now = fingerprint(engine({ rpm: 1300 }), { rpm: 1300, at: 1 });
    expect(compare(ref, now).caveats.join(' ')).toMatch(/vueltas no son las mismas/);
  });
});

describe('fft', () => {
  it('a pure tone lands in its bin', () => {
    const n = 64;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * 5 * i) / n);
    fft(re, im);
    const mag = Array.from(re, (r, k) => Math.hypot(r, im[k]!));
    expect(mag.indexOf(Math.max(...mag.slice(0, n / 2)))).toBe(5);
  });
});
