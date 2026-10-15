import { PromptFramer } from '@/data/adapters/prompt-framer';

describe('PromptFramer', () => {
  it('returns a response completed in one chunk', () => {
    const f = new PromptFramer();
    expect(f.feed('41 0C 1A F8\r\r>')).toEqual(['41 0C 1A F8']);
  });

  it('reassembles a response split across BLE-sized chunks', () => {
    const f = new PromptFramer();
    expect(f.feed('49 02 01 57 30 4C ')).toEqual([]);
    expect(f.feed('30 30 30 34 33 4D\r')).toEqual([]);
    expect(f.pending()).toContain('49 02 01');
    expect(f.feed('\r>')).toEqual(['49 02 01 57 30 4C 30 30 30 34 33 4D']);
    expect(f.pending()).toBe('');
  });

  it('joins multi-line (multi-ECU / multi-frame) output with single spaces', () => {
    const f = new PromptFramer();
    expect(f.feed('7E8 10 14 49 02 01\r7E8 21 57 30 4C\r\r>')).toEqual([
      '7E8 10 14 49 02 01 7E8 21 57 30 4C',
    ]);
  });

  it('keeps a trailing partial response for the next feed', () => {
    const f = new PromptFramer();
    expect(f.feed('OK\r\r>41 00')).toEqual(['OK']);
    expect(f.feed(' BE 3F\r>')).toEqual(['41 00 BE 3F']);
  });

  it('can be reset', () => {
    const f = new PromptFramer();
    f.feed('garbage');
    f.reset();
    expect(f.pending()).toBe('');
  });
});
