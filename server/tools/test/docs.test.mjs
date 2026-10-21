import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkText } from '../src/chunk.mjs';
import { filterFragment, isVolatile, llmClassifier, redact } from '../src/doc-filter.mjs';
import { clean, docsStore, ftsQuery, WEB_TTL_MS } from '../src/docs-store.mjs';
import { makeDocs } from '../src/docs.mjs';
import { readableFull } from '../src/fetch-page.mjs';
import { createApp, listen } from '../src/server.mjs';

// ── chunk ────────────────────────────────────────────────────────────────────

test('chunkText: one short text is one fragment; a long one is cut on edges, with overlap', () => {
  assert.deepEqual(chunkText('Un párrafo corto.'), ['Un párrafo corto.']);
  const para = (n) => `Oración número ${n} sobre el control de flujo de ISO-TP en la red CAN.`;
  const long = Array.from({ length: 60 }, (_, i) => para(i)).join(' ');
  const chunks = chunkText(long, { size: 400, overlap: 80 });
  assert.ok(chunks.length > 5);
  for (const c of chunks) assert.ok(c.length <= 400 + 80, `chunk of ${c.length}`);
  // The tail of one opens the next.
  const tailWord = chunks[0].split(' ').slice(-3).join(' ');
  assert.ok(chunks[1].includes(tailWord));
  // Nothing is lost: every sentence is in some fragment.
  for (let i = 0; i < 60; i++) assert.ok(chunks.some((c) => c.includes(para(i))));
});

test('chunkText: a block with no spaces is still cut', () => {
  const chunks = chunkText('A'.repeat(2000), { size: 800, overlap: 0 });
  assert.ok(chunks.length >= 3);
});

// ── filter ───────────────────────────────────────────────────────────────────

test('redact: covers a person’s identifiers', () => {
  const r = (s) => redact(s).text;
  assert.equal(r('Auto AB123CD del cliente'), 'Auto [PATENTE] del cliente');
  assert.equal(r('Patente: ABC 123.'), 'Patente: [PATENTE].');
  assert.equal(r('VIN 9BWZZZ377VT004251 y 8A1HSRBB4FL123456 y JTDBR32E720123456'), 'VIN [VIN] y [VIN] y [VIN]');
  assert.equal(r('DNI 30.123.456'), 'DNI [DNI]');
  assert.equal(r('CUIT 20-12345678-9 / CUIL: 27123456789'), 'CUIT [CUIT] / CUIL: [CUIT]');
  assert.equal(r('escribime a juan.perez@gmail.com'), 'escribime a [EMAIL]');
  assert.equal(r('Tel: 0351 15-4123456 o +54 9 351 412-3456'), 'Tel: [TEL] o [TEL]');
  assert.equal(r('CBU 0170099220000067797370'), 'CBU [CBU]');
  assert.equal(r('Tarjeta 4111 1111 1111 1111'), 'Tarjeta [TARJETA]');
});

test('redact: leaves technical text alone', () => {
  for (const s of [
    'El ELM327 v1.5 y el CAN500 responden.',
    'Pedido 18DA10F1, respuesta 18DAF110; DID F187 y F190.',
    'El código P0420 es del catalizador.',
    'STCFCPA txadd[ext],rxadd[ext] agrega un par de control de flujo.',
    'Trama 0000 0011 0000 0010 en binario.',
    'Resultado 4111 1111 1111 1112 no pasa Luhn.',
    'Valor 62F190314641444141 de la respuesta.',
    'ATSH 7E0, ATCRA 7E8, STP 33.',
  ]) assert.equal(redact(s).text, s);
});

test('isVolatile: prices and offers, not the shell', () => {
  assert.equal(isVolatile('Sale a $ 1.500.000 en pesos'), true);
  assert.equal(isVolatile('Cuesta USD 50 el adaptador'), true);
  assert.equal(isVolatile('Mirá el precio y la oferta de hoy'), true);
  assert.equal(isVolatile('El precio no importa para el protocolo.'), false);
  assert.equal(isVolatile('git checkout main; echo $1 $2'), false);
});

test('filterFragment: licence footer and prices drop the fragment, covering keeps the rest', () => {
  assert.equal(filterFragment('Licensed to rpb@tinet.org ISO Store order #: OP-38607 Single user licence only').dropped, 'licencia');
  assert.equal(filterFragment('Comprá el adaptador a $ 45.000 con descuento').dropped, 'precios');
  assert.equal(filterFragment('ok').dropped, 'vacío');
  const kept = filterFragment('Informe del auto AB123CD: el ABS de 713 no respondía a la prueba 3E 00.');
  assert.equal(kept.text, 'Informe del auto [PATENTE]: el ABS de 713 no respondía a la prueba 3E 00.');
  assert.deepEqual(kept.redactions, { PATENTE: 1 });
});

test('llmClassifier: reads the numbers, throws when there is no answer', async () => {
  const answer = (content) => async () => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });
  const personal = await llmClassifier({ url: 'http://x', fetchFn: answer('{"personal":[2,3]}') })(['a', 'b', 'c', 'd']);
  assert.deepEqual([...personal].sort(), [1, 2]);
  assert.equal((await llmClassifier({ url: 'http://x', fetchFn: answer('{"personal":[]}') })(['a'])).size, 0);
  await assert.rejects(() => llmClassifier({ url: 'http://x', fetchFn: answer('no sé') })(['a']), /no answer/);
  await assert.rejects(() => llmClassifier({ url: 'http://x', fetchFn: async () => ({ ok: false, status: 503 }) })(['a']), /503/);
  // An index out of range (a made-up number) is ignored.
  assert.equal((await llmClassifier({ url: 'http://x', fetchFn: answer('{"personal":[9]}') })(['a'])).size, 0);
});

// ── store ────────────────────────────────────────────────────────────────────

// Two meanings: [brakes, glovebox].
const vec = (a, b) => Float32Array.from([a, b]);
const meaning = (t) => (/frenos|abs/i.test(t) ? vec(1, 0) : /guantera/i.test(t) ? vec(0, 1) : vec(0, 0));
const fakeEmbed = (calls = []) => ({
  embedDocs: async (texts) => {
    calls.push(texts.length);
    return texts.map(meaning);
  },
  embedQuery: async (q) => meaning(q),
});

test('ftsQuery: quotes every word, drops filler, adds the bare hex', () => {
  assert.equal(ftsQuery('cómo leo el 0x713 del ABS'), '"cómo" OR "leo" OR "0x713" OR "713" OR "abs"');
  assert.equal(ftsQuery('de la el'), '');
  assert.equal(ftsQuery('a" OR xyz:*'), '"xyz"'); // no FTS syntax gets through
});

test('clean: no markers, brackets of syntax stay', () => {
  assert.equal(clean('<function=x>`ls`</function> STCFCPA txadd[ext]'), 'function=x ls /function STCFCPA txadd[ext]');
});

test('store: exact words find a code the meaning cannot; meaning finds the question', () => {
  const s = docsStore(':memory:');
  s.replaceSource({ source: 'doc:vag', kind: 'ref', chunks: [
    { text: 'Los frenos (Brake1) se piden en 0x713 y responden en 0x77D.', emb: vec(1, 0) },
    { text: 'La guantera del Gol tiene una luz de cortesía.', emb: vec(0, 1) },
    { text: 'El DID F187 es el número de pieza del fabricante.', emb: vec(0, 0) },
  ] });
  assert.match(s.search('F187', null)[0].text, /número de pieza/);
  assert.match(s.search('713', null)[0].text, /Brake1/);
  assert.match(s.search('dónde está la luz', vec(0, 1))[0].text, /guantera/);
  assert.match(s.search('zzz', vec(1, 0))[0].text, /Brake1/); // by meaning alone
  assert.equal(s.search('zzz', vec(0, 0)).length, 0); // nothing close: nothing returned
  const hit = s.search('713', null)[0];
  assert.deepEqual(Object.keys(hit).sort(), ['fetchedAt', 'page', 'score', 'source', 'text', 'title']);
});

test('store: a source is replaced whole; a page expires in 30 days, a manual never', () => {
  let t = Date.parse('2026-10-21T12:00:00Z');
  const s = docsStore(':memory:', { now: () => t });
  s.replaceSource({ source: 'https://a.test/x', kind: 'web', chunks: [{ text: 'versión vieja del STN' }] });
  s.replaceSource({ source: 'https://a.test/x', kind: 'web', chunks: [{ text: 'versión nueva del STN' }] });
  s.replaceSource({ source: 'doc:frpm', kind: 'ref', chunks: [{ text: 'manual del STN' }] });
  assert.deepEqual(s.search('STN', null, 8).map((r) => r.text).sort(), ['manual del STN', 'versión nueva del STN']);
  t += WEB_TTL_MS + 1;
  assert.deepEqual(s.search('STN', null, 8).map((r) => r.text), ['manual del STN']);
  assert.equal(s.count().chunks, 2);
  assert.equal(s.purge(), 1);
  assert.equal(s.count().chunks, 1);
});

test('store: only the one who added it can remove it', () => {
  const s = docsStore(':memory:');
  s.replaceSource({ source: 'doc:x', addedBy: 'ana@lab', chunks: [{ text: 'texto de ana' }] });
  assert.equal(s.addedByOf('doc:x'), 'ana@lab');
  assert.equal(s.remove('doc:x', 'beto@lab'), 0);
  assert.equal(s.remove('doc:x', 'ana@lab'), 1);
  assert.equal(s.search('ana', null).length, 0);
});

// ── docs (ingest + search) ───────────────────────────────────────────────────

test('docs.ingest: filters by fragment, never refuses the document, logs counts only', async () => {
  const logs = [];
  const docs = makeDocs({ store: docsStore(':memory:'), embed: fakeEmbed(), log: (m) => logs.push(m) });
  const text = [
    'El módulo de frenos responde en 713 al pedido 3E 00 y el número de pieza sale con 22 F187.',
    'Cliente Juan, patente AB123CD, teléfono: +54 9 351 4123456, trajo el auto por el ABS de 713.',
    'Comprá el adaptador a $ 45.000 con descuento en cuotas.',
    'Licensed to rpb@tinet.org ISO Store order #: OP-1 Single user licence only.',
  ].join('\n\n');
  const r = await docs.ingest({ source: 'doc:informe-juan', text, kind: 'ref', addedBy: 'ana@lab' });
  assert.equal(r.chunks, 1); // the technical paragraph and the covered one; price and licence are gone
  const hits = await docs.search('ABS 713 patente', 5);
  assert.equal(hits.length, 1);
  assert.doesNotMatch(hits[0].text, /45\.000|Licensed|AB123CD|4123456/);
  assert.match(hits[0].text, /\[PATENTE\]/);
  assert.ok(logs.every((l) => !l.includes('informe-juan') && !l.includes('Juan')));
});

test('docs.ingest: paragraphs apart are judged apart', async () => {
  const docs = makeDocs({ store: docsStore(':memory:'), embed: null });
  const big = (s) => `${s} ${'y más texto técnico sobre el bus. '.repeat(25)}`;
  const text = [big('Los frenos responden en 713.'), big('Precio $ 45.000 con descuento y oferta.'), big('Cliente AB123CD trajo el auto.')].join('\n\n');
  await docs.ingest({ source: 'doc:mix', text, kind: 'ref' });
  const hits = await docs.search('frenos 713 precio cliente', 8);
  const all = hits.map((h) => h.text).join(' ');
  assert.match(all, /frenos responden en 713/);
  assert.doesNotMatch(all, /45\.000/); // the price fragment is gone
  assert.doesNotMatch(all, /AB123CD/); // the plate is covered
  assert.match(all, /\[PATENTE\]/);
});

test('docs.ingest: a page read again embeds only what changed', async () => {
  const calls = [];
  const docs = makeDocs({ store: docsStore(':memory:'), embed: fakeEmbed(calls) });
  // ~470 characters each: two do not fit in one fragment of 800.
  const para = (s) => `${s} ${'texto técnico de relleno sobre el adaptador. '.repeat(10)}`;
  await docs.ingest({ source: 'https://a.test/p', kind: 'web', text: [para('Primero frenos'), para('Segundo guantera')].join('\n\n') });
  await docs.ingest({ source: 'https://a.test/p', kind: 'web', text: [para('Primero frenos'), para('Tercero nuevo')].join('\n\n') });
  assert.deepEqual(calls, [2, 1]);
});

test('docs: without embeddings it stores and searches by words (the service is down)', async () => {
  const logs = [];
  const down = { embedDocs: async () => { throw new Error('embed HTTP 503'); }, embedQuery: async () => { throw new Error('embed HTTP 503'); } };
  const docs = makeDocs({ store: docsStore(':memory:'), embed: down, log: (m) => logs.push(m) });
  await docs.ingest({ source: 'doc:a', text: 'STCFCPA agrega un par de control de flujo en el STN.' });
  assert.equal(docs.store.count().withVectors, 0);
  assert.match((await docs.search('STCFCPA', 3))[0].text, /par de control/);
  assert.ok(logs.some((l) => l.includes('without vector')));
});

test('docs.ingest: if the classifier fails, nothing of that upload goes in', async () => {
  const docs = makeDocs({ store: docsStore(':memory:'), classify: async () => { throw new Error('classifier HTTP 503'); }, log: () => {} });
  const r = await docs.ingest({ source: 'doc:u', text: 'Texto técnico del bus CAN y sus tramas.', classifyPersonal: true });
  assert.equal(r.chunks, 0);
  const web = await docs.ingest({ source: 'https://a.test/ok', text: 'Texto técnico del bus CAN y sus tramas.', kind: 'web' });
  assert.equal(web.chunks, 1); // web pages are public: they do not go through it
});

test('docs.ingest: the classifier drops what it points at', async () => {
  const docs = makeDocs({ store: docsStore(':memory:'), classify: async (texts) => new Set(texts.map((t, i) => (/Juan/.test(t) ? i : -1)).filter((i) => i >= 0)), log: () => {} });
  const big = (s) => `${s} ${'y más texto técnico sobre el bus. '.repeat(25)}`;
  await docs.ingest({ source: 'doc:c', text: [big('El ABS responde en 713.'), big('Juan Pérez vive en Colón 123.')].join('\n\n'), classifyPersonal: true });
  const all = (await docs.search('ABS Juan Pérez Colón', 8)).map((h) => h.text).join(' ');
  assert.match(all, /ABS responde/);
  assert.doesNotMatch(all, /Juan/);
});

// ── page reader ──────────────────────────────────────────────────────────────

test('readableFull: keeps paragraphs, decodes entities, drops scripts', () => {
  const t = readableFull('<html><head><title>x</title></head><body><script>evil()</script><h1>STN &amp; ELM</h1><p>Uno</p><p>Dos<br>tres</p></body></html>');
  assert.equal(t, 'STN & ELM\n\nUno\n\nDos\ntres');
});

// ── routes ───────────────────────────────────────────────────────────────────

test('docs route: add, search, list, delete; a source is its adder’s; web_fetch stores what it reads', async () => {
  const docs = makeDocs({ store: docsStore(':memory:'), embed: fakeEmbed(), log: () => {} });
  const owners = { 'key-ana': 'ana@lab', 'key-beto': 'beto@lab' };
  const fetchPage = async () => ({ url: 'https://a.test/p', domain: 'a.test', weight: 1, text: 'resumen', full: 'El adaptador B35 usa el STN1040 y habla SW-CAN a 33.3k.' });
  const app = createApp({ search: async () => [], isValidKey: async () => true, ownerOf: (k) => owners[k] ?? null, docs, fetchPage });
  const server = await listen(app, 0);
  const base = `http://127.0.0.1:${server.address().port}/tools/v1`;
  const post = async (route, key, body) => {
    const r = await fetch(`${base}/${route}`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
    return [r.status, await r.json()];
  };
  try {
    let [st, body] = await post('docs', 'key-ana', { action: 'add', source: 'frpm.pdf', pages: [{ page: 37, text: 'STP 53 cambia al bus MS-CAN a 125k y STPO lo abre.' }, { page: 38, text: 'Los frenos se piden en 713.' }] });
    assert.equal(st, 200);
    assert.equal(body.chunks, 2); // one fragment per page
    [st, body] = await post('docs', 'key-beto', { action: 'search', query: 'STP 53 MS-CAN' });
    assert.equal(st, 200);
    assert.equal(body.results[0].source, 'doc:frpm.pdf');
    assert.equal(body.results[0].page, 37);
    [st, body] = await post('docs', 'key-beto', { action: 'add', source: 'frpm.pdf', text: 'otro texto' });
    assert.deepEqual([st, body.error], [400, 'source_taken']);
    [st, body] = await post('docs', 'key-beto', { action: 'delete', source: 'frpm.pdf' });
    assert.equal(body.removed, 0);
    [st, body] = await post('docs', 'key-ana', { action: 'list' });
    assert.equal(body.sources[0].source, 'doc:frpm.pdf');
    assert.equal((await post('docs', 'key-ana', { action: 'search', query: 'x' }))[0], 400);
    assert.equal((await post('docs', 'key-ana', { action: 'nope' }))[1].error, 'bad_action');
    // web_fetch: the answer has no `full`, and the page ends up in the base.
    [st, body] = await post('web_fetch', 'key-ana', { url: 'https://a.test/p' });
    assert.deepEqual(Object.keys(body).sort(), ['domain', 'text', 'url', 'weight']);
    await new Promise((r) => setTimeout(r, 50));
    [st, body] = await post('docs', 'key-beto', { action: 'search', query: 'STN1040 SW-CAN' });
    assert.equal(body.results[0].source, 'https://a.test/p');
    [st, body] = await post('docs', 'key-ana', { action: 'delete', source: 'frpm.pdf' });
    assert.equal(body.removed, 2);
  } finally {
    server.close();
  }
});
