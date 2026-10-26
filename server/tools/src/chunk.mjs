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
      const tail = overlap > 0 ? cur.slice(-overlap) : ''; // slice(-0) is the whole string
      const sp = tail.indexOf(' ');
      cur = (sp >= 0 ? tail.slice(sp + 1) : tail).trim();
    }
    cur = cur ? `${cur} ${piece}` : piece;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

export const chunkText = (text, { size = CHUNK, overlap = OVERLAP } = {}) => packPieces(splitPieces(text, size), { size, overlap });

// ── Structured pages (page-text.mjs) ────────────────────────────────────────
// A web page arrives as headings ("# Title"), ``` code blocks, "a | b" table rows,
// "- item" lists and paragraphs. They are cut by those blocks, never through
// them: a table row, a command in a code block or a list stays with its
// neighbours, and every fragment says which section of the page it is from.
//
//   parseBlocks: the text → [{ type, text, level? }]
//   packBlocks:  blocks (after the filter judged each) → [{ text, section }]

const BLOCK = 1000; // prose fragment, characters (~300 tokens)
const BLOCK_BIG = 1800; // a code block or a table is allowed to be larger, or goes alone
const TAIL = 160; // the last sentence of a fragment opens the next one, if shorter than this
const SCRAP = 60; // a last fragment shorter than this joins the one before

export function parseBlocks(text) {
  const lines = String(text ?? '').split('\n');
  const blocks = [];
  let para = [];
  const flush = () => {
    if (para.length) blocks.push({ type: 'para', text: para.join(' ').replace(/\s+/g, ' ').trim() });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flush();
      const code = [line];
      while (++i < lines.length) {
        code.push(lines[i]);
        if (/^```\s*$/.test(lines[i])) break;
      }
      if (!/^```\s*$/.test(code[code.length - 1]) || code.length === 1) code.push('```');
      blocks.push({ type: 'code', text: code.join('\n') });
    } else if (/^#{1,6} \S/.test(line)) {
      flush();
      const level = line.match(/^#+/)[0].length;
      blocks.push({ type: 'heading', level, text: line.trim() });
    } else if (/^- /.test(line)) {
      flush();
      const items = [line];
      while (i + 1 < lines.length && /^- /.test(lines[i + 1])) items.push(lines[++i]);
      blocks.push({ type: 'list', text: items.join('\n') });
    } else if (/ \| /.test(line) && i + 1 < lines.length && / \| /.test(lines[i + 1])) {
      flush();
      const rows = [line];
      while (i + 1 < lines.length && / \| /.test(lines[i + 1])) rows.push(lines[++i]);
      blocks.push({ type: 'table', text: rows.join('\n') });
    } else if (line.trim() === '') {
      flush();
    } else {
      para.push(line.trim());
    }
  }
  flush();
  return blocks.filter((b) => b.text);
}

// Lines grouped up to `size`; a table repeats its first row in each group, a
// code block closes and reopens its fence.
function splitLines(block, size) {
  const raw = block.text.split('\n');
  const fenced = block.type === 'code';
  const body = fenced ? raw.slice(1, raw[raw.length - 1] === '```' ? -1 : undefined) : raw;
  const head = block.type === 'table' ? body[0] : null;
  const wrap = (ls) => (fenced ? `\`\`\`\n${ls.join('\n')}\n\`\`\`` : ls.join('\n'));
  const groups = [];
  let cur = [];
  let len = 0;
  for (const l of body) {
    if (cur.length && len + l.length + 1 > size) {
      groups.push(wrap(cur));
      cur = head && l !== head ? [head] : [];
      len = cur.reduce((n, x) => n + x.length + 1, 0);
    }
    cur.push(l.length > size ? l.slice(0, size) : l);
    len += Math.min(l.length, size) + 1;
  }
  if (cur.length) groups.push(wrap(cur));
  return groups;
}

// The last sentence of a prose fragment, when short: it opens the next fragment,
// so an answer on the boundary is whole in one of them.
function tailSentence(text) {
  const parts = text.split(/(?<=[.!?:;])\s+/);
  const last = parts[parts.length - 1];
  return parts.length > 1 && last.length <= TAIL ? last : '';
}

export function packBlocks(blocks, { size = BLOCK, big = BLOCK_BIG } = {}) {
  const out = [];
  const path = []; // [{ level, text }]
  let section = '';
  // `body` counts the blocks of the page in it: a heading or the sentence carried
  // over from the last fragment do not make a fragment on their own.
  let cur = null; // { parts, len, body, prose }
  const open = (carry = '') => {
    cur = { parts: carry ? [carry] : [], len: carry.length, body: 0, prose: true };
  };
  const close = () => {
    if (cur && cur.body > 0) {
      const text = cur.parts.join('\n\n').trim();
      const prev = out[out.length - 1];
      // A few words left over after a code block or a table join the fragment
      // before them (same section) instead of standing alone, or being lost.
      if (text.length < SCRAP && prev && prev.section === section) prev.text += `\n\n${text}`;
      else out.push({ text, section });
    }
    cur = null;
  };
  open();

  for (const b of blocks) {
    if (b.type === 'heading') {
      close();
      while (path.length && path[path.length - 1].level >= b.level) path.pop();
      path.push({ level: b.level, text: b.text.replace(/^#+ /, '') });
      section = path.map((h) => h.text).join(' > ');
      open();
      cur.parts.push(b.text);
      cur.len = b.text.length;
      continue;
    }
    const structured = b.type === 'code' || b.type === 'table' || b.type === 'list';
    const limit = structured ? big : size;
    // A paragraph longer than a fragment is cut on sentences and re-packed, so it
    // is not left as a string of one-sentence pieces.
    const units = b.text.length <= limit ? [b.text] : structured ? splitLines(b, limit) : packPieces(splitPieces(b.text, size), { size, overlap: 0 });
    for (const u of units) {
      const isBig = structured && u.length > size;
      if (cur.body > 0 && (cur.len + u.length + 2 > (structured ? big : size) || isBig)) {
        const wasProse = cur.prose;
        const prev = cur.parts.join('\n\n');
        close();
        open(wasProse && !structured && !isBig ? tailSentence(prev) : '');
      }
      cur.parts.push(u);
      cur.len += u.length + 2;
      cur.body += 1;
      if (structured) cur.prose = false;
    }
  }
  close();
  return out;
}
