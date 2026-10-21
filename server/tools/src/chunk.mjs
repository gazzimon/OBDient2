// Cuts a text into fragments for the lab's text base, in two steps so the
// filter can judge the small pieces before they are packed together (a price in
// one paragraph must not take its neighbours with it):
//   splitPieces: paragraphs, then sentences, then words — none longer than `size`.
//   packPieces:  glues pieces up to `size`, with a little overlap so an answer
//                that sits on a boundary is whole in one of the fragments.

const CHUNK = 800;
const OVERLAP = 100;

export function splitPieces(text, size = CHUNK) {
  const out = [];
  for (const para of String(text ?? '').split(/\n{2,}/)) {
    const p = para.replace(/[ \t]*\n[ \t]*/g, ' ').replace(/[ \t]+/g, ' ').trim();
    if (!p) continue;
    if (p.length <= size) {
      out.push(p);
      continue;
    }
    for (const s of p.split(/(?<=[.!?:;])\s+/)) {
      if (s.length <= size) {
        out.push(s);
        continue;
      }
      for (let i = 0; i < s.length; ) {
        let end = Math.min(i + size, s.length);
        if (end < s.length) {
          const sp = s.lastIndexOf(' ', end);
          if (sp > i + size / 2) end = sp;
        }
        out.push(s.slice(i, end).trim());
        i = end;
      }
    }
  }
  return out;
}

export function packPieces(pieces, { size = CHUNK, overlap = OVERLAP } = {}) {
  const chunks = [];
  let cur = '';
  for (const piece of pieces) {
    if (cur && cur.length + 1 + piece.length > size) {
      chunks.push(cur);
      // The tail of the last fragment opens the next one.
      const tail = cur.slice(-overlap);
      const sp = tail.indexOf(' ');
      cur = (sp >= 0 ? tail.slice(sp + 1) : tail).trim();
    }
    cur = cur ? `${cur} ${piece}` : piece;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

export const chunkText = (text, { size = CHUNK, overlap = OVERLAP } = {}) => packPieces(splitPieces(text, size), { size, overlap });
