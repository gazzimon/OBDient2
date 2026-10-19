// Live speech to text (M6): the phone's WebSocket at /tools/v1/stt, relayed to
// Voxtral Mini 4B Realtime (vLLM /v1/realtime on the Z440's GPU1).
//
// The phone speaks a small subset of the protocol, and only that passes:
//   → { type: 'input_audio_buffer.append', audio: <base64 PCM16 16 kHz mono> }
//   → { type: 'input_audio_buffer.commit', final: true }      (end of the phrase)
//   ← { type: 'ready' }                                       (start sending audio)
//   ← { type: 'transcription.delta', delta }  · { type: 'transcription.done', text }
//   ← { type: 'error', error }
// The session handshake with vLLM (session.update with the model, the first
// commit) happens here, and vLLM's key never leaves the server. Audio that
// arrives before vLLM is ready waits in order.
//
// Limits: the account's key (checked like every tool), 2 sessions per key at
// once, 90 s per session, 64 KB per message. Nothing is logged but counts.

import { WebSocket, WebSocketServer } from 'ws';

const MAX_SESSION_MS = 90_000;
const MAX_MESSAGE = 64 * 1024;
const MAX_PER_KEY = 2;
const MAX_QUEUED = 400; // ~1 min of 100 ms chunks while vLLM gets ready

export function attachStt(server, { upstreamUrl, upstreamKey, model, isValidKey, log = () => {}, WebSocketImpl = WebSocket }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE });
  const open = new Map(); // key prefix → sessions

  server.on('upgrade', async (req, socket, head) => {
    const url = new URL(req.url, 'http://local');
    if (url.pathname !== '/tools/v1/stt') {
      socket.destroy();
      return;
    }
    const auth = String(req.headers.authorization ?? '');
    const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const who = key.slice(0, 24);
    let ok = false;
    try {
      ok = !!key && (await isValidKey(key));
    } catch {
      ok = false;
    }
    if (!ok) return refuse(socket, 401);
    if ((open.get(who) ?? 0) >= MAX_PER_KEY) return refuse(socket, 429);
    wss.handleUpgrade(req, socket, head, (client) => session(client, who));
  });

  function session(client, who) {
    open.set(who, (open.get(who) ?? 0) + 1);
    const started = Date.now();
    let ready = false;
    let closed = false;
    const queue = [];
    const upstream = new WebSocketImpl(upstreamUrl, { headers: upstreamKey ? { Authorization: `Bearer ${upstreamKey}` } : {} });

    const send = (ws, obj) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
    };
    const close = (why) => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      open.set(who, Math.max(0, (open.get(who) ?? 1) - 1));
      if (why) send(client, { type: 'error', error: why });
      try {
        client.close();
      } catch {}
      try {
        upstream.close();
      } catch {}
      log(`stt session ${why ? `ended: ${why}` : 'done'} after ${Date.now() - started} ms`);
    };
    const timer = setTimeout(() => close('session_too_long'), MAX_SESSION_MS);

    upstream.on('message', (raw) => {
      let m;
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (m.type === 'session.created') {
        send(upstream, { type: 'session.update', model });
        send(upstream, { type: 'input_audio_buffer.commit' });
        ready = true;
        for (const q of queue.splice(0)) upstream.send(q);
        send(client, { type: 'ready' });
      } else if (m.type === 'transcription.delta') {
        send(client, { type: 'transcription.delta', delta: String(m.delta ?? '') });
      } else if (m.type === 'transcription.done') {
        send(client, { type: 'transcription.done', text: String(m.text ?? '') });
        close(null);
      } else if (m.type === 'error') {
        close('upstream_error');
      }
    });
    upstream.on('error', () => close('stt_unavailable'));
    upstream.on('close', () => close(closed ? null : 'stt_closed'));

    client.on('message', (raw) => {
      let m;
      try {
        m = JSON.parse(String(raw));
      } catch {
        return close('bad_message');
      }
      let out;
      if (m.type === 'input_audio_buffer.append' && typeof m.audio === 'string') out = { type: m.type, audio: m.audio };
      else if (m.type === 'input_audio_buffer.commit' && m.final === true) out = { type: m.type, final: true };
      else return close('bad_message');
      const text = JSON.stringify(out);
      if (ready) upstream.send(text);
      else if (queue.length < MAX_QUEUED) queue.push(text);
      else close('not_ready');
    });
    client.on('close', () => close(null));
    client.on('error', () => close(null));
  }

  return wss;
}

function refuse(socket, status) {
  const text = status === 401 ? 'Unauthorized' : 'Too Many Requests';
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}
