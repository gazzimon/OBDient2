import { DEFAULT_CAPTURE, captureDecision, initialCaptureState, packRows } from '@/domain/recording/frame-capture';

describe('frame capture bursts', () => {
  it('keeps 4 frames 100 ms apart every 2 s from a 30 fps stream', () => {
    const s = initialCaptureState();
    const kept: { t: number; burst: number; index: number }[] = [];
    for (let t = 1000; t < 5000; t += 33) {
      const k = captureDecision(s, t, DEFAULT_CAPTURE);
      if (k) kept.push({ t, ...k });
    }
    expect(kept).toHaveLength(8);
    const bursts = [...new Set(kept.map((k) => k.burst))];
    expect(bursts).toEqual([1000, 3013]);
    const first = kept.filter((k) => k.burst === 1000);
    expect(first.map((k) => k.index)).toEqual([0, 1, 2, 3]);
    for (let i = 1; i < first.length; i++) expect(first[i]!.t - first[i - 1]!.t).toBeGreaterThanOrEqual(100);
  });

  it('starts a new burst when a slow camera could not finish the last one', () => {
    const s = initialCaptureState();
    expect(captureDecision(s, 0, DEFAULT_CAPTURE)).toEqual({ burst: 0, index: 0 });
    expect(captureDecision(s, 2100, DEFAULT_CAPTURE)).toEqual({ burst: 2100, index: 0 });
  });
});

describe('packRows', () => {
  it('drops row padding', () => {
    // 2×2 RGB with 8-byte rows (2 bytes of padding).
    const src = new Uint8Array([1, 2, 3, 4, 5, 6, 0, 0, 7, 8, 9, 10, 11, 12, 0, 0]);
    expect([...new Uint8Array(packRows(src, 2, 2, 8, 3))]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('copies packed data as is', () => {
    const src = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const out = packRows(src, 1, 2, 3, 3);
    expect([...new Uint8Array(out)]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(out).not.toBe(src.buffer);
  });
});
