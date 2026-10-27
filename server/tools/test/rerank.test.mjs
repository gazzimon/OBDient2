import assert from 'node:assert/strict';
import test from 'node:test';
import { rerankClient, rerankHits } from '../src/rerank.mjs';

const hits = ['a', 'b', 'c', 'd'].map((t) => ({ title: t, text: `texto ${t}` }));

test('rerankClient: asks /score with the question and each fragment, returns the scores in order', async () => {
  let sent;
  const fetchFn = async (url, init) => {
    sent = { url, body: JSON.parse(init.body), auth: init.headers.Authorization };
    return { ok: true, json: async () => ({ data: [{ index: 1, score: 0.9 }, { index: 0, score: 0.1 }] }) };
  };
  const scores = await rerankClient({ url: 'http://z440:8004/', key: 'k', fetchFn })('odómetro', hits.slice(0, 2));
  assert.deepEqual(scores, [0.1, 0.9]);
  assert.equal(sent.url, 'http://z440:8004/score');
  assert.equal(sent.auth, 'Bearer k');
  assert.match(sent.body.text_1, /<Query>: odómetro/);
  assert.equal(sent.body.text_2.length, 2);
  assert.match(sent.body.text_2[0], /texto a/);
});

test('rerankClient: an HTTP error or a wrong count throws', async () => {
  await assert.rejects(rerankClient({ url: 'http://x', fetchFn: async () => ({ ok: false, status: 503 }) })('q', hits), /HTTP 503/);
  await assert.rejects(rerankClient({ url: 'http://x', fetchFn: async () => ({ ok: true, json: async () => ({ data: [{ index: 0, score: 1 }] }) }) })('q', hits), /wrong count/);
});

test('rerankHits: best score first, trimmed to keep; ties keep the search order', async () => {
  const out = await rerankHits(async () => [0.2, 0.9, 0.2, 0.5], 'q', hits, 3);
  assert.deepEqual(out.map((h) => h.title), ['b', 'd', 'a']);
});

test('rerankHits: no reranker, or one that fails, keeps the search order', async () => {
  assert.deepEqual((await rerankHits(null, 'q', hits, 2)).map((h) => h.title), ['a', 'b']);
  const logged = [];
  const failing = async () => {
    throw new Error('rerank HTTP 503');
  };
  assert.deepEqual((await rerankHits(failing, 'q', hits, 2, (m) => logged.push(m))).map((h) => h.title), ['a', 'b']);
  assert.match(logged[0], /reranker unavailable/);
});
