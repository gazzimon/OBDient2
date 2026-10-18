/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DtcBaseDescriber, lookup, type DtcBase } from '@/data/knowledge/dtc-base';

// The real generated base (scripts/build-dtc-base.py).
const base = JSON.parse(readFileSync(join(__dirname, '../../assets/dtc/obdex.dtcdb'), 'utf8')) as DtcBase & {
  meta: { counts: Record<string, number>; excluded: string[] };
};

describe('trouble-code base (OBDex, checked against J2012)', () => {
  it('describes common codes, checked against the standard', () => {
    expect(lookup(base, 'P0171')).toMatchObject({ title: 'System Too Lean Bank 1', reliability: 'checked' });
    const p0301 = lookup(base, 'P0301')!;
    expect(p0301.title).toBe('Cylinder 1 Misfire Detected');
    expect(p0301.causes[0]).toEqual({ likelihood: 'high', cause: expect.stringMatching(/coil/i) });
    expect(p0301.summary.length).toBeLessThan(600);
  });

  it('leaves out codes whose title contradicts SAE J2012', () => {
    for (const code of ['P2231', 'P2415', 'P2604', 'P3434', 'U0179']) {
      expect(base.meta.excluded).toContain(code);
      expect(lookup(base, code)).toBeNull();
    }
  });

  it('newer codes are unchecked, body/chassis ones not in the standard are low', () => {
    const newer = Object.entries(base.codes).find(([c, r]) => c.startsWith('P0D') && r[5] === 'u');
    expect(newer).toBeDefined();
    const body = Object.values(base.codes).find((r) => r[5] === 'l');
    expect(body).toBeDefined();
  });

  it('has no carmaker codes', () => {
    expect(Object.keys(base.codes).some((c) => /^(P1|B1|B2|C1|C2|U1|U2)/.test(c))).toBe(false);
    expect(lookup(base, 'P1101')).toBeNull();
  });

  it('loads once, and a failed load is retried', async () => {
    let calls = 0;
    const d = new DtcBaseDescriber(async () => {
      calls++;
      if (calls === 1) throw new Error('disk');
      return base;
    });
    expect(await d.describe('P0171')).toBeNull();
    expect((await d.describe('P0171'))?.title).toBe('System Too Lean Bank 1');
    await d.describe('P0420');
    expect(calls).toBe(2);
  });
});
