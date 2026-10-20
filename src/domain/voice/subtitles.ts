// The assistant's spoken answer on the driving screen: short, and shown as
// film subtitles — one short piece at a time, large, in step with the voice.

// What a driver can take in by ear (decision 2026-10-20). The model is asked
// for it; this is the hard stop if it goes over.
export const SPOKEN_MAX_WORDS = 60;

// Up to this many words per subtitle: two large lines on a phone.
export const SUBTITLE_WORDS = 8;

// Spanish TTS at rate 1 says about this many words per second.
export const WORDS_PER_SECOND = 2.6;

const words = (s: string) => s.split(/\s+/).filter(Boolean);

// At most `max` words, ending at the last full sentence that fits; a single
// long sentence is cut at a word, with "…".
export function capWords(text: string, max = SPOKEN_MAX_WORDS): string {
  const all = words(text);
  if (all.length <= max) return all.join(' ');
  const head = all.slice(0, max).join(' ');
  const end = Math.max(head.lastIndexOf('. '), head.lastIndexOf('? '), head.lastIndexOf('! '));
  if (end > 0) return head.slice(0, end + 1);
  const last = head.slice(-1);
  return /[.!?]/.test(last) ? head : `${head.replace(/[,;:]$/, '')}…`;
}

// Sentences, and long ones split into pieces of at most `maxWords`, evenly.
export function subtitleChunks(text: string, maxWords = SUBTITLE_WORDS): string[] {
  const sentences = text.match(/[^.!?…]+[.!?…]*/g) ?? [];
  const out: string[] = [];
  for (const sentence of sentences) {
    const w = words(sentence);
    if (w.length === 0) continue;
    const pieces = Math.ceil(w.length / maxWords);
    const size = Math.ceil(w.length / pieces);
    for (let i = 0; i < w.length; i += size) out.push(w.slice(i, i + size).join(' '));
  }
  return out;
}

// Which piece is being said `elapsedMs` after the voice started.
export function chunkAt(chunks: readonly string[], elapsedMs: number, wps = WORDS_PER_SECOND): number {
  let spoken = (Math.max(0, elapsedMs) / 1000) * wps;
  for (let i = 0; i < chunks.length; i++) {
    spoken -= words(chunks[i]!).length;
    if (spoken < 0) return i;
  }
  return chunks.length - 1;
}
