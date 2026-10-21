// The lab's text base (2026-10-21): fragments of pages and manuals, searched by
// exact words (SQLite FTS5: "713", "F187", "P0420", "STCFCPA" are one token
// each) and by meaning (Qwen3-Embedding vectors, compared here), the two
// rankings fused (reciprocal rank). Everything is shared by the lab; a web
// page expires after 30 days, a manual never.
//
// Storage only: cutting, filtering and embedding are done before (docs.mjs).

import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const WEB_TTL_MS = 30 * 24 * 3600 * 1000;
const K_DEFAULT = 5;
const K_MAX = 8;
const POOL = 20; // candidates taken from each ranking
const RRF_K = 60;
const MIN_COSINE = 0.35; // below this a vector match is noise (unrelated text sat at ~0.2)

// Words that match everything and say nothing.
const STOP = new Set(
  'a al algo como con cual cuales cuando de del el ella en es esta este esto la las lo los me mi muy no o para por que se si sin su sus un una uno y ya the of to in is are and or for with how what which do does can'.split(' '),
);

export const hashOf = (text) => createHash('sha1').update(text).digest('hex');

// What is stored and later shown to the model: no control characters, no
// angle brackets or backticks (a stored page must not carry fake markers into
// every later answer). Square and curly brackets stay: command syntax uses them.
export function clean(text) {
  return String(text ?? '')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ')
    .replace(/[<>`]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .trim();
}

// "como leo el 0x713 del ABS" → "como" OR "leo" … quoted one by one, so nothing
// in the question is read as FTS syntax. "0x713" also adds "713".
export function ftsQuery(question) {
  const toks = [];
  for (const t of String(question ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (t.length < 2 || STOP.has(t)) continue;
    toks.push(t);
    if (/^0x[0-9a-f]+$/.test(t)) toks.push(t.slice(2));
  }
  return [...new Set(toks)].slice(0, 12).map((t) => `"${t}"`).join(' OR ');
}

// What the word index sees: the text, plus every "0x713" also as "713" (manuals
// write a hex code both ways and a question rarely says which).
const ftsText = (t) => {
  const bare = [...new Set((t.match(/\b0x[0-9a-fA-F]+\b/g) ?? []).map((h) => h.slice(2)))];
  return bare.length ? `${t} ${bare.join(' ')}` : t;
};

const toBlob = (v) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
const fromBlob = (b) => new Float32Array(b.slice().buffer); // slice(): aligned copy

export function docsStore(file, { now = () => Date.now() } = {}) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY,
      source TEXT NOT NULL,
      title TEXT,
      page INTEGER,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      hash TEXT NOT NULL,
      added_by TEXT,
      fetched_at INTEGER NOT NULL,
      expires_at INTEGER,
      emb BLOB
    );
    CREATE INDEX IF NOT EXISTS chunks_source ON chunks(source);
    CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(text, tokenize = 'unicode61 remove_diacritics 2');
  `);

  // id → { v, exp }: every stored vector, read on the first search after a write.
  let vectors = null;
  const loadVectors = () => {
    vectors = new Map();
    for (const r of db.prepare('SELECT id, emb, expires_at FROM chunks WHERE emb IS NOT NULL').all()) {
      vectors.set(r.id, { v: fromBlob(r.emb), exp: r.expires_at });
    }
    return vectors;
  };

  function tx(work) {
    db.exec('BEGIN');
    try {
      const r = work();
      db.exec('COMMIT');
      vectors = null;
      return r;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  const dropIds = (ids) => {
    const del = db.prepare('DELETE FROM chunks WHERE id = ?');
    const delFts = db.prepare('DELETE FROM fts WHERE rowid = ?');
    for (const id of ids) {
      del.run(id);
      delFts.run(id);
    }
  };

  return {
    // Vectors already computed for a source, by fragment hash: an unchanged
    // page is not embedded again.
    embeddingsFor(source) {
      const out = new Map();
      for (const r of db.prepare('SELECT hash, emb FROM chunks WHERE source = ? AND emb IS NOT NULL').all(source)) out.set(r.hash, fromBlob(r.emb));
      return out;
    },

    // All the fragments of a source in one go (a new reading replaces the old).
    // chunks: [{ page?, text, emb? }].
    replaceSource({ source, title = null, kind = 'ref', addedBy = null, chunks }) {
      const t = now();
      const expires = kind === 'web' ? t + WEB_TTL_MS : null;
      return tx(() => {
        dropIds(db.prepare('SELECT id FROM chunks WHERE source = ?').all(source).map((r) => r.id));
        const ins = db.prepare('INSERT INTO chunks (source, title, page, kind, text, hash, added_by, fetched_at, expires_at, emb) VALUES (?,?,?,?,?,?,?,?,?,?)');
        const insFts = db.prepare('INSERT INTO fts (rowid, text) VALUES (?, ?)');
        for (const c of chunks) {
          const r = ins.run(source, title, c.page ?? null, kind, c.text, hashOf(c.text), addedBy, t, expires, c.emb ? toBlob(c.emb) : null);
          insFts.run(Number(r.lastInsertRowid), ftsText(c.text));
        }
        return chunks.length;
      });
    },

    // Exact words + meaning, fused. `qvec` null (no embedding service) → words only.
    search(question, qvec, k = K_DEFAULT) {
      const limit = Math.max(1, Math.min(Number(k) || K_DEFAULT, K_MAX));
      const t = now();
      const rank = new Map(); // id → fused score
      const add = (ids) => ids.forEach((id, i) => rank.set(id, (rank.get(id) ?? 0) + 1 / (RRF_K + i)));

      const match = ftsQuery(question);
      if (match) {
        add(
          db
            .prepare('SELECT c.id FROM fts JOIN chunks c ON c.id = fts.rowid WHERE fts MATCH ? AND (c.expires_at IS NULL OR c.expires_at > ?) ORDER BY bm25(fts) LIMIT ?')
            .all(match, t, POOL)
            .map((r) => r.id),
        );
      }
      if (qvec) {
        const scored = [];
        for (const [id, { v, exp }] of vectors ?? loadVectors()) {
          if (exp != null && exp <= t) continue;
          let dot = 0;
          for (let i = 0; i < v.length; i++) dot += v[i] * qvec[i];
          if (dot >= MIN_COSINE) scored.push([id, dot]);
        }
        add(scored.sort((a, b) => b[1] - a[1]).slice(0, POOL).map(([id]) => id));
      }

      const top = [...rank.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
      if (top.length === 0) return [];
      const rows = db.prepare(`SELECT id, source, title, page, text, fetched_at FROM chunks WHERE id IN (${top.map(() => '?').join(',')})`).all(...top.map(([id]) => id));
      const byId = new Map(rows.map((r) => [r.id, r]));
      return top.map(([id, score]) => {
        const r = byId.get(id);
        return { text: r.text, source: r.source, title: r.title, page: r.page, fetchedAt: new Date(r.fetched_at).toISOString().slice(0, 10), score: Number(score.toFixed(4)) };
      });
    },

    // Who added a source (null if it is not there).
    addedByOf(source) {
      return db.prepare('SELECT added_by AS by FROM chunks WHERE source = ? LIMIT 1').get(source)?.by ?? null;
    },

    list() {
      return db
        .prepare('SELECT source, title, kind, added_by AS addedBy, COUNT(*) AS chunks, MAX(fetched_at) AS fetched FROM chunks GROUP BY source ORDER BY fetched DESC LIMIT 200')
        .all()
        .map((r) => ({ ...r, fetched: new Date(r.fetched).toISOString().slice(0, 10) }));
    },

    // `by` set: only what that person added. null: anything (the admin CLI).
    remove(source, by = null) {
      return tx(() => {
        const ids = db.prepare('SELECT id FROM chunks WHERE source = ? AND (? IS NULL OR added_by = ?)').all(source, by, by).map((r) => r.id);
        dropIds(ids);
        return ids.length;
      });
    },

    // Expired fragments leave the file (searches already skip them).
    purge() {
      return tx(() => {
        const ids = db.prepare('SELECT id FROM chunks WHERE expires_at IS NOT NULL AND expires_at <= ?').all(now()).map((r) => r.id);
        dropIds(ids);
        return ids.length;
      });
    },

    // Fragments stored without a vector (the embedding service was down).
    missingEmbeddings(limit = 200) {
      return db.prepare('SELECT id, text FROM chunks WHERE emb IS NULL LIMIT ?').all(limit);
    },
    setEmbedding(id, vec) {
      db.prepare('UPDATE chunks SET emb = ? WHERE id = ?').run(toBlob(vec), id);
      vectors = null;
    },

    count() {
      const r = db.prepare('SELECT COUNT(*) AS n, COUNT(emb) AS withVec FROM chunks').get();
      return { chunks: r.n, withVectors: r.withVec };
    },
    close: () => db.close(),
  };
}
