import { AccelerationRun, crossing, kwToCv, summarize, type SpeedSample } from '@/domain/performance/acceleration';

// Constant acceleration from rest: 0→100 km/h in `seconds`, sampled every `dtMs`, whole km/h like the OBD.
function launch(seconds: number, dtMs = 40, t0 = 10_000): SpeedSample[] {
  const out: SpeedSample[] = [];
  const steps = Math.ceil((seconds * 1000) / dtMs) + 2;
  for (let i = 1; i <= steps; i++) out.push({ t: t0 + i * dtMs, kmh: Math.floor((100 * (i * dtMs)) / (seconds * 1000)) });
  return out;
}

function still(fromMs: number, toMs: number, dtMs = 40): SpeedSample[] {
  const out: SpeedSample[] = [];
  for (let t = fromMs; t <= toMs; t += dtMs) out.push({ t, kmh: 0 });
  return out;
}

describe('AccelerationRun', () => {
  it('arms after a still second, times 0–100 from the last still sample', () => {
    const run = new AccelerationRun(1200);
    for (const s of still(8_000, 10_000)) run.push(s);
    expect(run.current.kind).toBe('ready');
    let state = run.current;
    for (const s of launch(10)) state = run.push(s);
    expect(state.kind).toBe('done');
    if (state.kind !== 'done') return;
    // The clock starts at the last sample under 1 km/h (80 ms in): no reaction time.
    expect(state.result.t0to100s).toBeCloseTo(9.92, 2);
    expect(state.result.t0to60s).toBeCloseTo(5.92, 1);
    // ½·a·t² with a = 27.8/10 m/s² → ~139 m.
    expect(state.result.distanceM).toBeGreaterThan(130);
    expect(state.result.distanceM).toBeLessThan(150);
    expect(state.result.peakAccelG).toBeGreaterThan(0.25);
    expect(state.result.peakPowerKw).toBeGreaterThan(50);
  });

  it('does not start if the car was already moving', () => {
    const run = new AccelerationRun(1200);
    for (const s of launch(10).slice(5)) run.push(s);
    expect(run.current.kind).toBe('waiting_stop');
  });

  it('aborts when lifting off, on a data gap, or when too slow', () => {
    const lift = new AccelerationRun(null);
    for (const s of still(0, 1200)) lift.push(s);
    for (const s of launch(10, 40, 1200).slice(0, 100)) lift.push(s);
    expect(lift.push({ t: 99_000 / 20, kmh: 10 })).toEqual({ kind: 'aborted', reason: 'slowed_down' });

    const gap = new AccelerationRun(null);
    for (const s of still(0, 1200)) gap.push(s);
    gap.push({ t: 1240, kmh: 5 });
    expect(gap.push({ t: 4000, kmh: 30 })).toEqual({ kind: 'aborted', reason: 'data_gap' });

    const slow = new AccelerationRun(null);
    for (const s of still(0, 1200)) slow.push(s);
    let state = slow.current;
    for (let t = 1240, k = 1; t < 50_000; t += 500, k = Math.min(99, k + 1)) state = slow.push({ t, kmh: k });
    expect(state).toEqual({ kind: 'aborted', reason: 'too_long' });
  });

  it('without the mass there is no power figure', () => {
    const r = summarize([{ t: 0, kmh: 0 }, ...launch(8, 40, 0)], null);
    expect(r.peakPowerKw).toBeNull();
    expect(r.t0to100s).toBeCloseTo(8, 1);
  });
});

describe('helpers', () => {
  it('interpolates the crossing between samples', () => {
    expect(crossing([{ t: 0, kmh: 98 }, { t: 100, kmh: 102 }], 100)).toBe(50);
    expect(crossing([{ t: 0, kmh: 10 }], 100)).toBeNull();
  });

  it('kW to CV', () => {
    expect(kwToCv(74)).toBe(101);
  });
});
