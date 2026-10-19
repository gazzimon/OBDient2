import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket, WebSocketServer } from 'ws';
import { createApp, listen } from '../src/server.mjs';
import { attachStt } from '../src/stt-proxy.mjs';

// A fake vLLM /v1/realtime: answers like Voxtral and records what it got.
async function fakeVllm() {
  const got = [];
  const auth = [];
  const wss = new WebSocketServer({ port: 0 });
  wss.on('connection', (ws, req) => {
    auth.push(req.headers.authorization);
    ws.send(JSON.stringify({ type: 'session.created', id: 's1' }));
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      got.push(m.type === 'input_audio_buffer.append' ? `append:${m.audio}` : `${m.type}${m.final ? ':final' : ''}${m.model ? `:${m.model}` : ''}`);
      if (m.type === 'input_audio_buffer.append') ws.send(JSON.stringify({ type: 'transcription.delta', delta: 'hola ' }));
      if (m.final) ws.send(JSON.stringify({ type: 'transcription.done', text: 'hola mundo' }));
    });
  });
  await new Promise((r) => wss.on('listening', r));
  return { url: `ws://127.0.0.1:${wss.address().port}/v1/realtime`, got, auth, close: () => wss.close() };
}

async function proxy(upstream) {
  const app = createApp({ search: async () => [], isValidKey: async () => true });
  const server = await listen(app, 0);
  attachStt(server, { upstreamUrl: upstream.url, upstreamKey: 'vllm-secret', model: 'voxtral-realtime', isValidKey: async (k) => k === 'sk-ok' });
  return { url: `ws://127.0.0.1:${server.address().port}/tools/v1/stt`, close: () => server.close() };
}

function connect(url, key) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { headers: key ? { Authorization: `Bearer ${key}` } : {} });
    const events = [];
    ws.on('message', (raw) => events.push(JSON.parse(String(raw))));
    ws.on('unexpected-response', (_req, res) => resolve({ status: res.statusCode }));
    ws.on('open', () => resolve({ ws, events }));
  });
}
const until = async (fn) => {
  for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 10));
};

test('relays a phrase: handshake here, audio in order, deltas and the final text back', async () => {
  const up = await fakeVllm();
  const px = await proxy(up);
  try {
    const { ws, events } = await connect(px.url, 'sk-ok');
    ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: 'AAA=' })); // may arrive before ready
    await until(() => events.some((e) => e.type === 'ready'));
    ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: 'BBB=' }));
    ws.send(JSON.stringify({ type: 'input_audio_buffer.commit', final: true }));
    await until(() => events.some((e) => e.type === 'transcription.done'));
    assert.deepEqual(up.got, ['session.update:voxtral-realtime', 'input_audio_buffer.commit', 'append:AAA=', 'append:BBB=', 'input_audio_buffer.commit:final']);
    assert.deepEqual(up.auth, ['Bearer vllm-secret']);
    assert.ok(events.some((e) => e.type === 'transcription.delta' && e.delta === 'hola '));
    assert.deepEqual(events.at(-1), { type: 'transcription.done', text: 'hola mundo' });
  } finally {
    px.close();
    up.close();
  }
});

test('refuses without a valid key, and anything but audio and the final commit', async () => {
  const up = await fakeVllm();
  const px = await proxy(up);
  try {
    assert.equal((await connect(px.url, 'sk-bad')).status, 401);
    assert.equal((await connect(px.url, null)).status, 401);
    const { ws, events } = await connect(px.url, 'sk-ok');
    await until(() => events.some((e) => e.type === 'ready'));
    ws.send(JSON.stringify({ type: 'session.update', model: 'otro' }));
    await until(() => events.some((e) => e.type === 'error'));
    assert.deepEqual(events.at(-1), { type: 'error', error: 'bad_message' });
    assert.ok(!up.got.includes('session.update:otro'));
  } finally {
    px.close();
    up.close();
  }
});

test('speech server down: the phone hears why', async () => {
  const px = await proxy({ url: 'ws://127.0.0.1:1/v1/realtime' });
  try {
    const { events } = await connect(px.url, 'sk-ok');
    await until(() => events.some((e) => e.type === 'error'));
    assert.deepEqual(events[0], { type: 'error', error: 'stt_unavailable' });
  } finally {
    px.close();
  }
});
