// Orders fragments by how well they answer a question: Qwen3-Reranker-0.6B on the
// Z440 (docker-compose `rerank`, vLLM `--runner=pooling`, /score). It reads the
// question and each fragment together, so it orders better than the embeddings'
// cosine (2026-10-26, 10 questions: first answer at 0.94 of the ideal rank against
// 0.65), in ~80 ms. It does NOT tell an answer from a page on the same subject:
// the score is topical, so the judge (research.mjs) still decides.

const TIMEOUT_MS = 8_000;
const FRAGMENT_CHARS = 1_500;
const INSTRUCTION = 'Dada una consulta de diagnóstico automotriz u OBD, juzgá si el documento trae el dato que la responde';
// The model's own prompt format; the empty think block makes it answer yes/no at once.
const PREFIX =
  '<|im_start|>system\nJudge whether the Document meets the requirements based on the Query and the Instruct provided. Note that the answer can only be "yes" or "no".<|im_end|>\n<|im_start|>user\n';
const SUFFIX = '<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n';

export function rerankClient({ url, key, model = 'qwen3-reranker-0.6b', fetchFn = fetch, timeoutMs = TIMEOUT_MS }) {
  // → one score per hit, in the order of `hits`. Throws on any failure.
  return async function scoreHits(question, hits) {
    const res = await fetchFn(`${url.replace(/\/$/, '')}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({
        model,
        text_1: `${PREFIX}<Instruct>: ${INSTRUCTION}\n<Query>: ${question}\n`,
        text_2: hits.map((h) => `<Document>: ${[h.title, h.section].filter(Boolean).join(' — ')}\n${h.text.slice(0, FRAGMENT_CHARS)}${SUFFIX}`),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`rerank HTTP ${res.status}`);
    const data = [...((await res.json()).data ?? [])].sort((a, b) => a.index - b.index);
    if (data.length !== hits.length || data.some((d) => typeof d.score !== 'number')) throw new Error('rerank: wrong count');
    return data.map((d) => d.score);
  };
}

// The `keep` best fragments, best first. No reranker, or it fails: the order the
// search gave (words + meaning), which is what the judge saw before.
export async function rerankHits(rerank, question, hits, keep, log = () => {}) {
  if (!rerank || hits.length < 2) return hits.slice(0, keep);
  try {
    const scores = await rerank(question, hits);
    return hits
      .map((h, i) => ({ h, s: scores[i], i }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .slice(0, keep)
      .map((x) => x.h);
  } catch (err) {
    log(`research: reranker unavailable (${err.message}), keeping the search order`);
    return hits.slice(0, keep);
  }
}
