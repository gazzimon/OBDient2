import { runTurn, type TurnResult } from '@/domain/assistant/agent-loop';
import {
  addUserMessage,
  applyEvent,
  failTurn,
  finishTurn,
  MAX_CONVERSATIONS,
  newConversation,
  PHOTO_MARKER,
  upsertConversation,
} from '@/domain/assistant/conversation';
import type { AssistantContext } from '@/domain/assistant/prompt';
import type { LlmPort, LlmResult } from '@/domain/ports/llm.port';
import type { VehicleToolsPort } from '@/domain/ports/vehicle-tools.port';
import { AssistantService, type AccountCredentials } from '@/data/assistant/assistant-service';
import { LlmHttpError } from '@/data/llm/openai-chat-client';
import { CHAT_STORE_VERSION, useChatStore } from '@/store/chatStore';

const CTX: AssistantContext = { connected: true, protocol: 'CAN 29/500', supportedPids: 4, moving: false, speedKmh: 0, navigating: false };
const say = (content: string): LlmResult => ({ content, toolCalls: [], finishReason: 'stop' });
const car: VehicleToolsPort = {
  supportedPids: () => ['RPM'],
  execute: async () => ({ ok: true, data: { VOLTAGE: 12.6 }, summary: 'Batería 12,6 V' }),
};
const confirmation = { confirm: async () => true };

function result(partial: Partial<TurnResult>): TurnResult {
  return { messages: [], text: '', cancelled: false, modelCalls: 1, invalidCalls: 0, clears: 0, dropped: [], ...partial };
}

describe('conversation', () => {
  it('a turn on screen: user message, streamed answer, tool rows, saved API messages', () => {
    let c = newConversation('c1', 0);
    c = addUserMessage(c, 'u1', '¿Cómo está la batería?', 0, 1);
    expect(c.title).toBe('¿Cómo está la batería?');
    c = applyEvent(c, { type: 'tool_start', id: 't1', call: { name: 'read_pids', pids: ['VOLTAGE'] } }, 2, 'a1');
    c = applyEvent(c, { type: 'tool_end', id: 't1', call: { name: 'read_pids', pids: ['VOLTAGE'] }, outcome: { ok: true, data: {}, summary: 'VOLTAGE 12,6 V' } }, 3, 'a1');
    c = applyEvent(c, { type: 'text', delta: 'La batería ' }, 4, 'a1');
    c = applyEvent(c, { type: 'text', delta: 'está bien.' }, 5, 'a1');
    const api = [
      { role: 'user' as const, content: '¿Cómo está la batería?\n\n[estado]' },
      { role: 'assistant' as const, content: 'La batería está bien.' },
    ];
    c = finishTurn(c, result({ messages: api, text: 'La batería está bien.' }), 'a1', 1, 6);
    expect(c.items.map((i) => i.kind)).toEqual(['user', 'tool', 'assistant']);
    expect(c.items[1]).toMatchObject({ status: 'ok', detail: 'VOLTAGE 12,6 V' });
    expect(c.items[2]).toMatchObject({ text: 'La batería está bien.', cancelled: false });
    expect(c.api).toEqual(api);
    expect(c.stats).toEqual([{ at: 1, ms: 5, modelCalls: 1, invalidCalls: 0, tools: ['read_pids'] }]);
  });

  it('photos go to the model once and are saved as a marker', () => {
    let c = addUserMessage(newConversation('c1', 0), 'u1', '', 1, 1);
    expect(c.title).toBe('Foto');
    c = finishTurn(
      c,
      result({
        messages: [
          { role: 'user', content: [{ type: 'text', text: '¿Qué es esta luz?' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } }] },
          { role: 'assistant', content: 'Es el testigo de presión de aceite.' },
        ],
        text: 'Es el testigo de presión de aceite.',
      }),
      'a1',
      1,
      2,
    );
    expect(c.api[0]).toEqual({ role: 'user', content: `¿Qué es esta luz?\n${PHOTO_MARKER}` });
    expect(JSON.stringify(c.api)).not.toContain('base64');
  });

  it('a stopped turn closes running tools; a failed one keeps the text to retry', () => {
    let c = addUserMessage(newConversation('c1', 0), 'u1', 'Medí 20 s', 0, 1);
    c = applyEvent(c, { type: 'tool_start', id: 't1', call: { name: 'sample_pids', pids: ['RPM'], seconds: 20 } }, 2, 'a1');
    const stopped = finishTurn(c, result({ cancelled: true }), 'a1', 1, 3);
    expect(stopped.items.find((i) => i.kind === 'tool')).toMatchObject({ status: 'failed', detail: 'Cancelado.' });
    expect(stopped.items[stopped.items.length - 1]).toMatchObject({ kind: 'assistant', cancelled: true });

    const failed = failTurn(c, 'e1', 'Sin conexión.', 'Medí 20 s', 3);
    expect(failed.items[failed.items.length - 1]).toEqual({ kind: 'error', id: 'e1', at: 3, text: 'Sin conexión.', retryText: 'Medí 20 s' });
    expect(failed.api).toEqual([]);
  });

  it('keeps at most 20 conversations, newest first, and drops empty ones', () => {
    let list = [] as ReturnType<typeof upsertConversation>;
    for (let i = 0; i < 25; i++) list = upsertConversation(list, addUserMessage(newConversation(`c${i}`, i), `u${i}`, 'hola', 0, i));
    expect(list).toHaveLength(MAX_CONVERSATIONS);
    expect(list[0]!.id).toBe('c24');
    list = upsertConversation(list, newConversation('empty', 99));
    list = upsertConversation(list, addUserMessage(newConversation('next', 100), 'u', 'hola', 0, 100));
    expect(list.map((c) => c.id)).not.toContain('empty');
  });
});

describe('runTurn with photos', () => {
  it('sends the photos with the text, as API content parts', async () => {
    const seen: unknown[] = [];
    const llm: LlmPort = {
      complete: async (req) => {
        seen.push(req.messages[req.messages.length - 1]);
        return say('Es el testigo de aceite.');
      },
    };
    await runTurn({ history: [], text: '¿Qué es?', images: ['data:image/jpeg;base64,AAAA'], context: CTX, llm, vehicle: car, confirmation });
    expect(seen[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } }],
    });
  });
});

describe('AssistantService', () => {
  const creds = { baseUrl: 'https://x/llm/v1', apiKey: 'sk-old', model: 'obdient-chat' };
  const input = (onEvent = jest.fn()) => ({
    conversationId: 'c1',
    history: [],
    clearsSoFar: 0,
    text: 'hola',
    context: CTX,
    confirmation,
    signal: new AbortController().signal,
    onEvent,
  });

  function account(renewed: typeof creds | null = { ...creds, apiKey: 'sk-new' }): AccountCredentials & { renewals: number } {
    const a = { renewals: 0, llmCredentials: () => creds as typeof creds | null, renewLlmKey: async () => (a.renewals++, renewed) };
    return a;
  }

  it('without an account it does not call the model', async () => {
    const makeLlm = jest.fn();
    const s = new AssistantService({ account: { llmCredentials: () => null, renewLlmKey: async () => null }, vehicle: car, makeLlm });
    expect(await s.send(input())).toEqual({ ok: false, error: 'no_account' });
    expect(makeLlm).not.toHaveBeenCalled();
  });

  it('a 401 before anything was shown renews the key and retries once', async () => {
    const acc = account();
    const keys: string[] = [];
    const s = new AssistantService({
      account: acc,
      vehicle: car,
      makeLlm: (c) => ({
        complete: async () => {
          keys.push(c.apiKey);
          if (c.apiKey === 'sk-old') throw new LlmHttpError(401, 'invalid token');
          return say('hola');
        },
      }),
    });
    const r = await s.send(input());
    expect(r).toMatchObject({ ok: true, result: { text: 'hola' } });
    expect(keys).toEqual(['sk-old', 'sk-new']);
    expect(acc.renewals).toBe(1);
  });

  it('no renewal possible → unauthorized; errors are sorted for the screen', async () => {
    const failing = (err: unknown) =>
      new AssistantService({ account: account(null), vehicle: car, makeLlm: () => ({ complete: async () => { throw err; } }) });
    expect(await failing(new LlmHttpError(401, '')).send(input())).toEqual({ ok: false, error: 'unauthorized' });
    expect(await failing(new LlmHttpError(429, '')).send(input())).toEqual({ ok: false, error: 'rate_limited' });
    expect(await failing(new LlmHttpError(403, '')).send(input())).toEqual({ ok: false, error: 'disabled' });
    expect(await failing(new LlmHttpError(0, '')).send(input())).toEqual({ ok: false, error: 'timeout' });
    expect(await failing(new LlmHttpError(502, '')).send(input())).toMatchObject({ ok: false, error: 'server' });
    expect(await failing(new TypeError('Network request failed')).send(input())).toMatchObject({ ok: false, error: 'offline' });
  });

  it('does not retry once something reached the screen (a tool may have run)', async () => {
    const acc = account();
    let calls = 0;
    const s = new AssistantService({
      account: acc,
      vehicle: car,
      makeLlm: () => ({
        complete: async (_req, opts) => {
          calls++;
          opts?.onText?.('Mido…');
          throw new LlmHttpError(401, '');
        },
      }),
    });
    expect(await s.send(input())).toEqual({ ok: false, error: 'unauthorized' });
    expect(calls).toBe(1);
    expect(acc.renewals).toBe(0);
  });
});

describe('chatStore', () => {
  it('starts, saves and removes conversations; persists a version for migrations', () => {
    const s = useChatStore.getState();
    const c = s.startNew('c1', 1);
    useChatStore.getState().save(addUserMessage(c, 'u1', 'hola', 0, 2));
    expect(useChatStore.getState().active()?.title).toBe('hola');
    useChatStore.getState().remove('c1');
    expect(useChatStore.getState().active()).toBeNull();
    expect(CHAT_STORE_VERSION).toBe(1);
  });

  it('an unknown persisted version is dropped, not half-read', () => {
    const migrate = useChatStore.persist.getOptions().migrate!;
    expect(migrate({ conversations: [{ weird: true }] }, 0)).toEqual({ conversations: [], activeId: null });
  });
});

describe('screen confirmation', () => {
  it('the agent loop waits until the modal answers', async () => {
    const { screenConfirmation, useConfirmStore } = await import('@/store/confirmStore');
    const pending = screenConfirmation.confirm({ name: 'clear_dtcs' });
    expect(useConfirmStore.getState().request?.call).toEqual({ name: 'clear_dtcs' });
    useConfirmStore.getState().answer(true);
    await expect(pending).resolves.toBe(true);
    expect(useConfirmStore.getState().request).toBeNull();

    const declined = screenConfirmation.confirm({ name: 'clear_dtcs' });
    useConfirmStore.getState().answer(false);
    await expect(declined).resolves.toBe(false);
  });
});
