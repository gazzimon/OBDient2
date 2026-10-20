import { capWords, chunkAt, subtitleChunks } from '@/domain/voice/subtitles';

const n = (count: number) => Array.from({ length: count }, (_, i) => `w${i}`).join(' ');

describe('capWords', () => {
  it('leaves short answers alone', () => {
    expect(capWords('La batería está bien.')).toBe('La batería está bien.');
  });

  it('ends at the last full sentence within the limit', () => {
    const text = `${n(30)}. ${n(20)}. ${n(30)}.`;
    expect(capWords(text, 60)).toBe(`${n(30)}. ${n(20)}.`);
  });

  it('cuts one long sentence at a word, with an ellipsis', () => {
    expect(capWords(`${n(70)}.`, 60)).toBe(`${n(60)}…`);
  });
});

describe('subtitleChunks', () => {
  it('splits by sentence and keeps pieces short and even', () => {
    expect(subtitleChunks('Tenés dos códigos. Uno es del sensor de oxígeno del banco uno.', 8)).toEqual([
      'Tenés dos códigos.',
      'Uno es del sensor de',
      'oxígeno del banco uno.',
    ]);
  });
});

describe('chunkAt', () => {
  it('follows the voice by words per second', () => {
    const chunks = ['uno dos tres cuatro', 'cinco seis'];
    expect(chunkAt(chunks, 0, 2)).toBe(0);
    expect(chunkAt(chunks, 1900, 2)).toBe(0);
    expect(chunkAt(chunks, 2100, 2)).toBe(1);
    expect(chunkAt(chunks, 60_000, 2)).toBe(1);
  });
});
