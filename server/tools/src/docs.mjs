// The lab's text base, as the server uses it: cut a text into fragments, let
// the filter decide fragment by fragment, embed what stays and store it; and
// search. What the filter did goes to the log as counts (never the source's
// name or the text): the user is not told.

import { packBlocks, packPieces, parseBlocks, splitPieces } from './chunk.mjs';
import { clean, embedInput, hashOf } from './docs-store.mjs';
import { filterFragment } from './doc-filter.mjs';

const MAX_CHUNKS = 400; // per source: ~320 000 characters

export function makeDocs({ store, embed = null, classify = null, log = () => {} }) {
  return {
    store,

    // pages: [{ page, text }] or text. classifyPersonal: also ask the model
    // (uploads by people; web pages are public and skip it).
    // structured: the text comes from page-text.mjs (headings, ``` blocks, tables,
    // lists): it is cut by those blocks and each fragment keeps its section.
    async ingest({ source, title = null, text = null, pages = null, kind = 'ref', addedBy = null, classifyPersonal = false, structured = false }) {
      const units = pages ?? [{ page: null, text }];
      const seen = { licencia: 0, precios: 0, vacío: 0, personal: 0 };
      const covered = {};
      let total = 0;
      let kept = [];
      // The filter judges each paragraph or sentence (or block); what stays is
      // packed after, so one bad paragraph does not take its neighbours with it.
      const judge = (piece) => {
        total += 1;
        const r = filterFragment(piece);
        for (const [k, n] of Object.entries(r.redactions)) covered[k] = (covered[k] ?? 0) + n;
        if (!r.text) seen[r.dropped] += 1;
        return r.text;
      };
      for (const u of units) {
        if (structured) {
          const blocks = parseBlocks(u.text).flatMap((b) => {
            const t = judge(b.text);
            return t ? [{ ...b, text: t }] : [];
          });
          for (const c of packBlocks(blocks)) kept.push({ page: u.page ?? null, text: c.text, section: c.section || null });
          continue;
        }
        const ok = [];
        for (const piece of splitPieces(clean(u.text))) {
          const t = judge(piece);
          if (t) ok.push(t);
        }
        for (const t of packPieces(ok)) kept.push({ page: u.page ?? null, text: t });
      }
      kept = kept.slice(0, MAX_CHUNKS);

      if (classifyPersonal && classify && kept.length) {
        try {
          const personal = await classify(kept.map((f) => f.text));
          seen.personal = personal.size;
          kept = kept.filter((_, i) => !personal.has(i));
        } catch (err) {
          // Cannot tell: nothing of this upload goes in.
          log(`docs classify failed (${err.message}): ${kept.length} fragments dropped`);
          seen.personal = kept.length;
          kept = [];
        }
      }

      // A page read again keeps the vectors of the fragments that did not change.
      // What is embedded is the fragment with where it is from in front (embedInput).
      const inputOf = (f) => embedInput(title, f.section, f.text);
      const known = store.embeddingsFor(source);
      const todo = kept.filter((f) => !known.has(hashOf(inputOf(f))));
      let fresh = [];
      if (embed && todo.length) {
        try {
          fresh = await embed.embedDocs(todo.map(inputOf));
        } catch (err) {
          log(`docs embed failed (${err.message}): ${todo.length} fragments stored without vector`);
        }
      }
      const byInput = new Map(todo.map((f, i) => [inputOf(f), fresh[i] ?? null]));
      const chunks = kept.map((f) => ({ ...f, emb: known.get(hashOf(inputOf(f))) ?? byInput.get(inputOf(f)) ?? null }));

      store.replaceSource({ source, title, kind, addedBy, chunks });
      store.purge();
      log(`docs ingest ${kind}: ${chunks.length} fragments from ${total} pieces, dropped ${JSON.stringify(seen)}, covered ${JSON.stringify(covered)}`);
      return { chunks: chunks.length };
    },

    async search(question, k, opts) {
      let qvec = null;
      if (embed) {
        try {
          qvec = await embed.embedQuery(question);
        } catch (err) {
          log(`docs query embed failed (${err.message}): words only`);
        }
      }
      return store.search(question, qvec, k, opts);
    },
  };
}
