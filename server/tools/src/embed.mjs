// Embeddings for the lab's text base: Qwen3-Embedding-0.6B on the Z440
// (docker-compose `embed`, vLLM, OpenAI-style /v1/embeddings). Vectors come
// back normalised, so a dot product is the cosine. Documents go in as they are;
// a query carries Qwen's instruction ("Instruct: …\nQuery:…").

const BATCH = 16;
const TIMEOUT_MS = 30_000;
const INSTRUCTION = 'Dada una consulta de diagnóstico automotriz u OBD, encontrá el fragmento que la responde';

function normalise(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return Float32Array.from(v, (x) => x / n);
}

export function embedClient({ url, key, model = 'qwen3-embedding-0.6b', fetchFn = fetch }) {
  async function call(input) {
    const res = await fetchFn(`${url.replace(/\/$/, '')}/v1/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model, input }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`embed HTTP ${res.status}`);
    const body = await res.json();
    const data = [...(body.data ?? [])].sort((a, b) => a.index - b.index);
    if (data.length !== input.length) throw new Error('embed: wrong count');
    return data.map((d) => normalise(d.embedding));
  }

  return {
    async embedDocs(texts) {
      const out = [];
      for (let i = 0; i < texts.length; i += BATCH) out.push(...(await call(texts.slice(i, i + BATCH))));
      return out;
    },
    async embedQuery(query) {
      return (await call([`Instruct: ${INSTRUCTION}\nQuery:${query}`]))[0];
    },
  };
}
