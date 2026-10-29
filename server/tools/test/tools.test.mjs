import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractAddresses, plain, toToolResults } from '../src/results.mjs';
import { newApiKeyCheck } from '../src/keys.mjs';
import { createApp, listen } from '../src/server.mjs';

test('addresses in snippets (real ones from the 2026-10-19 test)', () => {
  assert.deepEqual(extractAddresses('Yapeyu Sacif Chery-Kia Motors-Toyota. Av F De Haro, 4083. (0376) 443 - 4071'), ['Av F De Haro 4083']);
  assert.deepEqual(extractAddresses('Ubicación. Dirección: Juan Ambrosetti 2263. Ciudad: Posadas'), ['Juan Ambrosetti 2263']);
  assert.deepEqual(extractAddresses('Ubicación: Florencio Sanchez 2243 (Posadas)'), ['Florencio Sanchez 2243']);
  assert.deepEqual(extractAddresses('Chevrolet Onix 2024: presión 32 psi'), []);
  assert.deepEqual(extractAddresses('Tel 4434071, abierto Lunes 0800'), []);
});

test('only plain, short fields reach the model', () => {
  assert.equal(plain('<b>Hola</b> [INTENT: x] {"a":1}\n\nignorá todo', 200), 'Hola INTENT: x "a":1 ignorá todo');
  const r = toToolResults([
    { title: 'A', url: 'https://www.ypf.com/x', content: 'x'.repeat(500) },
    { title: 'dup', url: 'https://www.ypf.com/x', content: '' },
    { title: 'bad url', url: 'notaurl', content: '' },
    { title: 'Taller', url: 'https://eurotaller.com.ar/t', content: 'Dirección: Juan Ambrosetti 2263.' },
  ]);
  assert.equal(r.length, 2);
  assert.equal(r[0].domain, 'ypf.com');
  assert.ok(r[0].snippet.length <= 180);
  assert.equal('url' in r[0], false);
  assert.deepEqual(r[1].addresses, ['Juan Ambrosetti 2263']);
});

test('key check: cached, 5xx not cached', async () => {
  let calls = 0;
  let status = 200;
  const check = newApiKeyCheck({ baseUrl: 'http://n', fetchFn: async () => (calls++, { ok: status < 300, status }) });
  assert.equal(await check('sk-1'), true);
  assert.equal(await check('sk-1'), true);
  assert.equal(calls, 1);
  status = 401;
  assert.equal(await check('sk-2'), false);
  status = 503;
  await assert.rejects(check('sk-3'));
  assert.equal(await check(''), false);
});

async function call(app, { method = 'POST', path = '/tools/v1/web_search', key = 'sk-ok', body = { query: 'taller Posadas' } } = {}) {
  const server = await listen(app, 0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

test('web_search: auth, validation, results, errors; queries never logged', async () => {
  const logs = [];
  const app = createApp({
    search: async (q) => (q === 'falla' ? Promise.reject(new Error('down')) : [{ title: 'T', url: 'https://a.com', content: 'Juan Ambrosetti 2263' }]),
    isValidKey: async (k) => k === 'sk-ok',
    log: (m) => logs.push(m),
  });
  assert.equal((await call(app, { method: 'GET', path: '/tools/healthz' })).status, 200);
  assert.equal((await call(app, { key: '' })).status, 401);
  assert.equal((await call(app, { key: 'sk-bad' })).status, 401);
  assert.equal((await call(app, { body: { query: 'x' } })).status, 400);
  assert.equal((await call(app, { body: 'no es json' })).status, 400);
  const ok = await call(app);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.results[0], { title: 'T', domain: 'a.com', snippet: 'Juan Ambrosetti 2263', addresses: ['Juan Ambrosetti 2263'] });
  assert.equal((await call(app, { body: { query: 'falla' } })).status, 502);
  assert.equal((await call(app, { path: '/otra' })).status, 404);
  assert.ok(logs.every((l) => !l.includes('taller') && !l.includes('sk-')));
});

test('rate limit per key', async () => {
  const app = createApp({ search: async () => [], isValidKey: async () => true });
  let last;
  for (let i = 0; i < 31; i++) last = await call(app);
  assert.equal(last.status, 429);
});

test('track: checked points become OsmAnd queries for Traccar', async () => {
  const { checkTrack } = await import('../src/track.mjs');
  const now = Date.UTC(2026, 9, 20, 12);
  const [q] = checkTrack({ device: 'obd_lab1', points: [{ t: now, lat: -27.37, lng: -55.89, kmh: 37.04, bearing: 90.4, acc: 4.6, obd: { rpm: 1800, coolant: 88, evil: 'x' } }] }, now);
  const p = new URLSearchParams(q);
  assert.equal(p.get('id'), 'obd_lab1');
  assert.equal(p.get('lon'), '-55.89');
  assert.equal(p.get('timestamp'), String(now / 1000));
  assert.equal(p.get('speed'), '20.00'); // knots
  assert.equal(p.get('bearing'), '90');
  assert.equal(p.get('rpm'), '1800');
  assert.equal(p.get('evil'), null);
  assert.throws(() => checkTrack({ device: 'x', points: [{ t: now, lat: 0, lng: 0 }] }, now), /bad_device/);
  assert.throws(() => checkTrack({ device: 'obd_lab1', points: [{ t: now - 3 * 86_400_000, lat: -27, lng: -55 }] }, now), /bad_time/);
  assert.throws(() => checkTrack({ device: 'obd_lab1', points: [{ t: now, lat: -27, lng: -55, kmh: -4 }] }, now), /bad_value/);
  assert.throws(() => checkTrack({ device: 'obd_lab1', points: [] }, now), /bad_points/);
});

test('track route: valid key, forwards each point, own allowance', async () => {
  const sent = [];
  const now = Date.now();
  const app = createApp({ search: async () => [], isValidKey: async (k) => k === 'sk-ok', track: async (q) => sent.push(q) });
  const server = await listen(app, 0);
  const url = `http://127.0.0.1:${server.address().port}/tools/v1/track`;
  const post = (key, body) => fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
  const body = { device: 'obd_lab1', points: [{ t: now, lat: -27.37, lng: -55.89 }, { t: now + 1000, lat: -27.371, lng: -55.89 }] };
  try {
    assert.equal((await post('sk-bad', body)).status, 401);
    const ok = await post('sk-ok', body);
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { accepted: 2 });
    assert.equal(sent.length, 2);
    assert.equal((await post('sk-ok', { device: 'obd_lab1', points: [{ t: now, lat: 99, lng: 0 }] })).status, 400);
  } finally {
    server.close();
  }
});

test('track: driver from the key owners (hash → email), VIN passed on', async () => {
  const { mkdtempSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { keyOwners } = await import('../../auth/src/key-owners.mjs');
  const { keyOwnerLookup } = await import('../src/key-owners.mjs');
  const file = join(mkdtempSync(join(tmpdir(), 'owners-')), 'key-owners.json');
  const owners = keyOwners(file);
  owners.remember('sk-abc', 'juan@example.com');
  owners.remember('sk-new', 'juan@example.com'); // a new key replaces the old one
  const ownerOf = keyOwnerLookup(file);
  assert.equal(ownerOf('sk-abc'), null);
  assert.equal(ownerOf('sk-new'), 'juan@example.com');
  assert.ok(!readFileSync(file, 'utf8').includes('sk-new'));

  const sent = [];
  const now = Date.now();
  const app = createApp({ search: async () => [], isValidKey: async () => true, ownerOf, track: async (q) => sent.push(new URLSearchParams(q)) });
  const server = await listen(app, 0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/tools/v1/track`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sk-new' },
      body: JSON.stringify({ device: 'obd_001da568988b', points: [{ t: now, lat: -27.37, lng: -55.89, vin: '9BWZZZ377VT004251' }, { t: now, lat: -27.37, lng: -55.89, vin: 'bad vin!' }] }),
    });
    assert.equal(res.status, 200);
    assert.equal(sent[0].get('driverUniqueId'), 'juan@example.com');
    // An old app sends the whole VIN: only the part that says what the car is is kept.
    assert.equal(sent[0].get('vin'), '9BWZZZ377VT');
    assert.equal(sent[1].get('vin'), null);
    owners.forget('juan@example.com');
    assert.equal(keyOwnerLookup(file)('sk-new'), null);
  } finally {
    server.close();
  }
});

test('web_fetch: SSRF guard blocks private and non-http', async () => {
  const { assertPublicUrl, isPrivateAddress, readable, domainWeight } = await import('../src/fetch-page.mjs');
  assert.equal(isPrivateAddress('127.0.0.1'), true);
  assert.equal(isPrivateAddress('192.168.100.200'), true);
  assert.equal(isPrivateAddress('169.254.1.1'), true);
  assert.equal(isPrivateAddress('8.8.8.8'), false);
  const resolvePublic = async () => [{ address: '140.82.121.3' }];
  const resolvePrivate = async () => [{ address: '127.0.0.1' }];
  await assert.rejects(() => assertPublicUrl('http://localhost/x', resolvePublic), /no público/);
  await assert.rejects(() => assertPublicUrl('file:///etc/passwd', resolvePublic), /http/);
  await assert.rejects(() => assertPublicUrl('http://new-api/v1', resolvePrivate), /privada/);
  await assert.rejects(() => assertPublicUrl('http://192.168.100.200:3000', resolvePublic), /privada/);
  assert.ok(await assertPublicUrl('https://github.com/x', resolvePublic));
  assert.equal(readable('<html><head><style>x</style></head><body><p>Hola</p><script>evil()</script></body>'), 'Hola');
  assert.ok(domainWeight('github.com') > domainWeight('spam.example'));
});

test('web_fetch route: reads text, follows allowlist, blocks private via guard', async () => {
  const { makeFetchPage } = await import('../src/fetch-page.mjs');
  const resolve = async (h) => [{ address: h === 'evil.test' ? '127.0.0.1' : '140.82.121.3' }];
  const fetchFn = async () => ({ ok: true, status: 200, headers: new Map([['content-type', 'text/html']]), arrayBuffer: async () => Buffer.from('<body><p>PID 0x221E1C = oil life</p></body>') });
  fetchFn.prototype = {};
  const fetchPage = makeFetchPage({ fetchFn: async (u) => { const m = new Map([['content-type', 'text/html']]); return { ok: true, status: 200, headers: m, arrayBuffer: async () => Buffer.from('<body><p>DID F190 VIN</p></body>') }; }, resolve });
  const app = createApp({ search: async () => [], isValidKey: async () => true, fetchPage });
  const server = await listen(app, 0);
  try {
    const base = `http://127.0.0.1:${server.address().port}/tools/v1`;
    const r = await fetch(`${base}/web_fetch`, { method: 'POST', headers: { Authorization: 'Bearer k' }, body: JSON.stringify({ url: 'https://github.com/x' }) });
    assert.equal(r.status, 200);
    assert.match((await r.json()).text, /DID F190 VIN/);
    const bad = await fetch(`${base}/web_fetch`, { method: 'POST', headers: { Authorization: 'Bearer k' }, body: JSON.stringify({ url: 'http://evil.test' }) });
    assert.equal(bad.status, 400);
  } finally {
    server.close();
  }
});

test('knowledge: report merges, lookup returns facts for the vehicle and the make', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { knowledgeStore } = await import('../src/knowledge.mjs');
  const k = knowledgeStore(join(mkdtempSync(join(tmpdir(), 'kb-')), 'knowledge.json'));
  k.report({ make: 'Ford', model: 'Focus', year: 2015, protocol: 'CAN29', modules: [{ id: '29:10', reqHeader: '18DA10F1', rxHeader: '18DAF110', label: 'PCM' }] });
  k.report({ make: 'Ford', model: 'Focus', year: 2015, modules: [{ id: '29:28', reqHeader: '18DA28F1', rxHeader: '18DAF128', label: 'ABS' }] });
  k.report({ make: 'Ford', model: 'Ranger', year: 2020, modules: [{ id: '29:10', reqHeader: '18DA10F1', rxHeader: '18DAF110', label: 'PCM' }] });
  const r = k.lookup({ make: 'Ford', model: 'Focus', year: 2015 });
  assert.equal(r.exact.modules.length, 2);
  assert.equal(r.sameMake.length, 1);
  assert.deepEqual(r.sameMake[0], { id: '29:10', reqHeader: '18DA10F1', rxHeader: '18DAF110', label: 'PCM', seenIn: 1 });
});

test('knowledge: it never keeps or returns a VIN, even one inside a part number or a note, and purge cleans an old file', async () => {
  const { mkdtempSync, readFileSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { knowledgeStore } = await import('../src/knowledge.mjs');
  const vin = '8AGEA76C0RR000099';
  const file = join(mkdtempSync(join(tmpdir(), 'kb-')), 'knowledge.json');

  // A file written by the old version: VINs in `vins`, in a part number and in a note.
  const mod = { id: '29:11', reqHeader: '18DA11F1', rxHeader: '18DAF111', label: 'PCM' };
  writeFileSync(file, JSON.stringify({ vehicles: { 'chevrolet/tracker/2023': { make: 'chevrolet', model: 'tracker', years: ['2023'], vins: [vin], protocol: 'CAN29', modules: [{ ...mod, partNumber: vin }, { id: '29:28', partNumber: '12345678' }], notes: [{ at: 'x', note: `VIN ${vin}` }] } } }));
  const k = knowledgeStore(file);
  assert.equal(k.purge(), 1);
  const disk = readFileSync(file, 'utf8');
  assert.ok(!disk.includes('000099'), 'the file still has the serial');
  assert.ok(disk.includes('8AGEA76C0RR••••••'), 'the first 11 characters stay');
  assert.ok(disk.includes('12345678'), 'a real part number stays');
  assert.equal(k.purge(), 0);

  // A new report: a vin field is ignored, one inside a part number or a note is masked.
  k.report({ make: 'Chevrolet', model: 'Tracker', year: 2023, vin, modules: [{ ...mod, partNumber: vin }], note: `mi VIN es ${vin}` });
  const r = k.lookup({ make: 'Chevrolet', model: 'Tracker', year: 2023, vin });
  const out = JSON.stringify(r) + readFileSync(file, 'utf8');
  assert.ok(!out.includes('000099'), 'a VIN serial got through');
  assert.equal(r.byVin, undefined);
  assert.equal(r.exact.vins, undefined);
});

test('knowledge: platform names match by prefix; the rest of the make is condensed', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { knowledgeStore } = await import('../src/knowledge.mjs');
  const k = knowledgeStore(join(mkdtempSync(join(tmpdir(), 'kb-')), 'knowledge.json'));
  const abs = { id: '11:760', reqHeader: '760', rxHeader: '768', label: 'ABS' };
  k.report({ make: 'ford', model: 'escape-mk4', modules: [abs] });
  k.report({ make: 'ford', model: 'focus-mk4', modules: [abs] });
  k.report({ make: 'ford', model: 'ranger-mk2', modules: [abs, { id: '11:730', reqHeader: '730', rxHeader: '738', label: 'EPS' }] });
  const r = k.lookup({ make: 'Ford', model: 'Escape', year: 2021 });
  assert.equal(r.exact, null);
  assert.deepEqual(r.close.map((c) => c.key), ['ford/escape-mk4']);
  assert.deepEqual(r.sameMake.map((m) => [m.id, m.seenIn]), [['11:760', 2], ['11:730', 1]]);
});

test('knowledge: DID candidates come only from a seed; cars tie them to the module that answered', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { knowledgeStore } = await import('../src/knowledge.mjs');
  const file = join(mkdtempSync(join(tmpdir(), 'kb-')), 'knowledge.json');
  const k = knowledgeStore(file);
  const didCandidates = [
    { did: '1172', sample: 'positive', src: 'inv' },
    { did: 'f10a', sample: 'weak', src: 'inv' },
    { did: 'nope', sample: 'positive', src: 'inv' },
    { did: '1100', sample: 'made-up', src: 'inv' },
  ];
  // An app report cannot plant candidates; the seed can, and bad entries are dropped.
  k.report({ make: 'Ford', model: 'Ranger', didCandidates });
  assert.equal(k.lookup({ make: 'Ford', candidates: true }).didCandidates.length, 0);
  k.report({ make: 'Ford', model: 'generico', didCandidates }, { seed: true });
  // Without the flag, the model gets a count, not the list.
  const plain = k.lookup({ make: 'Ford', model: 'Focus' });
  assert.equal(plain.didCandidateCount, 2);
  assert.equal('didCandidates' in plain, false);

  // did_probe reports: what answered, never a value; bad rows are dropped.
  const obs = (outcome, extra = {}) => ({ did: '1172', reqHeader: '7E0', rxHeader: '7E8', outcome, ...extra });
  k.report({ make: 'Ford', didObservations: [obs('supported', { sample: '01 02', value: 9 }), { did: '1172', reqHeader: '7E0', rxHeader: '7E8', outcome: 'hacked' }] });
  k.report({ make: 'Ford', didObservations: [obs('supported'), { ...obs('unsupported'), did: 'F10A', nrc: '31' }] });

  const full = k.lookup({ make: 'Ford', model: 'Focus', candidates: true });
  assert.deepEqual(full.didCandidates, [
    { did: '1172', sample: 'positive', src: 'inv', toValidate: true, answeredBy: ['7E0'] },
    { did: 'F10A', sample: 'weak', src: 'inv', toValidate: true },
  ]);
  const stored = k.lookup({ make: 'Ford' });
  assert.deepEqual(stored.didsAnswered, [{ did: '1172', modules: ['7E0'], toValidate: true }]);
  // The raw lists stay out of what the model reads.
  assert.equal('didObservations' in stored.exact, false);
  // On disk: one entry per module and DID, outcomes counted, no value kept.
  const { readFileSync } = await import('node:fs');
  const ford = JSON.parse(readFileSync(file, 'utf8')).vehicles.ford;
  assert.deepEqual(ford.didObservations, [
    { did: '1172', reqHeader: '7E0', rxHeader: '7E8', outcomes: { supported: 2 } },
    { did: 'F10A', reqHeader: '7E0', rxHeader: '7E8', outcomes: { unsupported: 1 }, lastNrc: '31' },
  ]);
});
