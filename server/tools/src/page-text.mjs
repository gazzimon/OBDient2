// The text of a web page with its structure kept (2026-10-25): what the lab's
// text base and the research tool cut into fragments and show the model.
//
// The old reader (fetch-page.mjs readable) flattened a page to one line and
// deleted every bracket, brace and backtick. For a page about DIDs and PIDs that
// is the payload: a table of identifiers, a code block, a list of commands. So
// here headings become "# Title" lines, <pre> becomes a ``` block with its line
// breaks, a table becomes one "a | b | c" row per line, and a list item becomes
// "- item". Markup, scripts and page furniture (menus, footers, forms) go.
//
// Third-party text: it is not trusted, and is never shown to the model without
// the delimiters of results.mjs untrusted(). Angle brackets are the only
// characters changed, so a page cannot carry a fake tag or tool-call marker.

const MAX_FULL = 60_000;

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', copy: '©', deg: '°', times: '×' };

export function decodeEntities(text) {
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 8 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

const DROP = /<(script|style|noscript|svg|head|nav|footer|header|form|aside|iframe|template|select|button)\b[\s\S]*?<\/\1>/gi;

// A tag, with attributes whose quoted values may contain ">".
const TAG = /<(\/?)([a-zA-Z][\w:-]*)(?:\s(?:[^>"']|"[^"]*"|'[^']*')*)?\/?>/g;

// The page's own content when it marks it (<main>, else <article>), so menus,
// "Jump to content" links and sidebars outside it do not become fragments.
function mainPart(s) {
  for (const tag of ['main', 'article']) {
    const open = s.indexOf(`<${tag}>`);
    const close = s.lastIndexOf(`</${tag}>`);
    if (open >= 0 && close > open) {
      const inner = s.slice(open + tag.length + 2, close);
      if (inner.replace(/<[^>]*>/g, '').trim().length > 500) return inner;
    }
  }
  return s;
}

// Inline text of a fragment of HTML: tags gone, entities decoded, one line.
const inline = (html) => decodeEntities(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

export function titleOf(html) {
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  const title = inline(t ?? '');
  return title ? title.slice(0, 160) : null;
}

// angle brackets of the page's own text (after decoding) become look-alikes.
const defang = (s) => s.replace(/</g, '‹').replace(/>/g, '›');
// Control characters, and the invisible format ones (zero-width, direction marks):
// a PDF wraps every word in U+202D…U+202C, which would split "STCFCPA" for the index.
const controls = (s) => s.replace(/[​-‏‪-‮⁠-⁤﻿]/g, '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ');

export function pageStructure(html, max = MAX_FULL) {
  const src = String(html);
  const title = titleOf(src);
  const keep = []; // code and tables, set aside so the whitespace pass cannot touch them
  const hold = (block) => `\n\n@@KEEP${keep.push(block) - 1}@@\n\n`;

  let s = src.replace(/<!--[\s\S]*?-->/g, ' ').replace(DROP, ' ');
  // Every tag without its attributes. An attribute can hold a ">" in quotes —
  // Wikipedia keeps the page's source in data-mw='{…&lt;ref>…}' — and a plain
  // /<[^>]*>/ ends the tag there and lets the rest of the attribute out as text.
  s = s.replace(TAG, (_, slash, name) => `<${slash}${name.toLowerCase()}>`);
  s = mainPart(s);
  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, inner) => {
    const code = decodeEntities(inner.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')).replace(/\r/g, '').replace(/^\n+|\s+$/g, '');
    return code.trim() ? hold(`\`\`\`\n${code}\n\`\`\``) : ' ';
  });
  s = s.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_, inner) => {
    const rows = [...inner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
      .map((r) => [...r[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => inline(c[1])).join(' | ').trim())
      .filter((r) => r.replace(/[|\s]/g, ''));
    return rows.length ? hold(rows.join('\n')) : ' ';
  });
  s = s
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, t) => `\n\n${'#'.repeat(Number(n))} ${inline(t)}\n\n`)
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/li>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|blockquote|ul|ol|dl|dd|dt|main|figure|tr)>/gi, '\n\n')
    .replace(/<[^>]*>/g, ' ');
  s = decodeEntities(s);
  s = controls(s)
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  s = s.replace(/@@KEEP(\d+)@@/g, (_, i) => keep[Number(i)] ?? '');
  s = defang(controls(s)).replace(/\n{3,}/g, '\n\n');
  if (s.length > max) {
    const cut = s.lastIndexOf('\n\n', max);
    s = s.slice(0, cut > max / 2 ? cut : max);
  }
  return { title, text: s };
}

// A plain-text file (README.md, a source file, a .dbc): already structured, only cleaned.
export function plainStructure(text, name = null, max = MAX_FULL) {
  const s = defang(controls(String(text))).replace(/\r/g, '').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  return { title: name, text: s.length > max ? s.slice(0, max) : s };
}
