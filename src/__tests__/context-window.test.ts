import { CONTEXT_TOKENS, isContextOverflow, MAX_TOOL_RESULT_TOKENS, runTurn } from '@/domain/assistant/agent-loop';
import { estimateChars, estimateTokens, textTokens } from '@/domain/assistant/history';
import { maxTokensFor, SYSTEM_PROMPT, type AssistantContext } from '@/domain/assistant/prompt';
import { toolSchemas } from '@/domain/assistant/tools';
import type { ApiMessage, LlmPort, LlmRequest, LlmResult } from '@/domain/ports/llm.port';
import type { VehicleToolsPort } from '@/domain/ports/vehicle-tools.port';
import { LlmHttpError, prefillAllowanceMs } from '@/data/llm/openai-chat-client';

const CTX: AssistantContext = { connected: true, protocol: 'CAN 29/500', supportedPids: 4, moving: false, speedKmh: 0, navigating: false, labMode: false };
const PIDS = ['SPEED', 'RPM', 'COOLANT_TEMP', 'ENGINE_LOAD'] as const;
const vehicle: VehicleToolsPort = { supportedPids: () => [...PIDS], execute: async () => ({ ok: true, data: {}, summary: 'ok' }) };
const confirmation = { confirm: async () => true };
const say = (content: string): LlmResult => ({ content, toolCalls: [], finishReason: 'stop' });
const OVERFLOW = new LlmHttpError(400, `{"error":{"message":"This model's maximum context length is 32768 tokens. However, you requested 500 output tokens and your prompt contains at least 32268 input tokens"}}`);

// A conversation of `turns` question-and-answer pairs of about 1 200 tokens each.
const history = (turns: number): ApiMessage[] =>
  Array.from({ length: turns }).flatMap((_, i): ApiMessage[] => [
    { role: 'user', content: `Pregunta ${i}: ${'dato del auto '.repeat(150)}` },
    { role: 'assistant', content: `Respuesta ${i}: ${'resultado de la lectura '.repeat(110)}` },
  ]);

const promptTokens = (req: LlmRequest) => estimateChars(SYSTEM_PROMPT.length) + estimateChars(JSON.stringify(req.tools).length) + req.messages.slice(1).reduce((sum, m) => sum + estimateTokens(m), 0);

describe('the conversation fits the model window', () => {
  it('trims the history by what the instructions and tools leave, not by a fixed number', async () => {
    const requests: LlmRequest[] = [];
    const llm: LlmPort = { complete: async (req) => (requests.push(req), say('ok')) };
    const r = await runTurn({ history: history(40), text: '¿Cómo está el auto?', context: CTX, llm, vehicle, confirmation });
    expect(r.dropped.length).toBeGreaterThan(0);
    // Prompt + answer + the room kept for tool results fit in 16 384.
    expect(promptTokens(requests[0]!) + maxTokensFor(CTX)).toBeLessThan(CONTEXT_TOKENS - 1_500);
    // It really kept some history (not an empty prompt).
    expect(requests[0]!.messages.length).toBeGreaterThan(4);
  });

  it('the fixed part (instructions + tools) is counted: with more tools there is less history', () => {
    const fixed = estimateChars(SYSTEM_PROMPT.length) + estimateChars(JSON.stringify(toolSchemas([...PIDS])).length);
    // Today it is several times what the old comment said (~1.4k tokens).
    expect(fixed).toBeGreaterThan(4_000);
  });

  it('when the provider still says it does not fit, it drops older turns and asks again, silently', async () => {
    const requests: LlmRequest[] = [];
    let first = true;
    const llm: LlmPort = {
      complete: async (req) => {
        requests.push(req);
        if (first) {
          first = false;
          throw OVERFLOW;
        }
        return say('listo');
      },
    };
    const r = await runTurn({ history: history(30), text: 'hola', context: CTX, llm, vehicle, confirmation });
    expect(r.text).toBe('listo');
    expect(requests).toHaveLength(2);
    expect(requests[1]!.messages.length).toBeLessThan(requests[0]!.messages.length);
    expect(r.modelCalls).toBe(1); // the failed ask is not a model call
    expect(r.dropped.length).toBeGreaterThan(0); // what left is summarised later
  });

  it('with nothing left to drop it is a real error, and it does not loop', async () => {
    let calls = 0;
    const llm: LlmPort = { complete: async () => (calls++, Promise.reject(OVERFLOW)) };
    await expect(runTurn({ history: [], text: 'hola', context: CTX, llm, vehicle, confirmation })).rejects.toBe(OVERFLOW);
    expect(calls).toBe(1);
  });

  it('other errors are not retried as overflow', async () => {
    let calls = 0;
    const err = new LlmHttpError(502, 'bad gateway');
    const llm: LlmPort = { complete: async () => (calls++, Promise.reject(err)) };
    await expect(runTurn({ history: history(30), text: 'hola', context: CTX, llm, vehicle, confirmation })).rejects.toBe(err);
    expect(calls).toBe(1);
  });

  it('isContextOverflow only matches the 400 about the window', () => {
    expect(isContextOverflow(OVERFLOW)).toBe(true);
    expect(isContextOverflow(new LlmHttpError(400, 'invalid request'))).toBe(false);
    expect(isContextOverflow(new LlmHttpError(500, 'maximum context length'))).toBe(false);
    expect(isContextOverflow(new TypeError('Network request failed'))).toBe(false);
    expect(isContextOverflow(null)).toBe(false);
  });

  it('also recognises the gateway wording and a 413', () => {
    expect(isContextOverflow(new LlmHttpError(400, '{"error":{"message":"upstream error","type":"new_api_error","code":"context_length_exceeded"}}'))).toBe(true);
    expect(isContextOverflow(new LlmHttpError(413, 'Request too large: prompt is too long'))).toBe(true);
    expect(isContextOverflow(new LlmHttpError(400, 'Too many input tokens (18077 > 16384)'))).toBe(true);
    expect(isContextOverflow(new LlmHttpError(413, 'payload too large'))).toBe(false);
  });
});

// A diagnostic capture as the app shares it (hex replies, ~4 kB), the text that
// filled the window in the 2026-10-21 chat.
const CAPTURE = `OBDient2 · OBDient\n\nCaptura de diagnóstico\n${Array.from({ length: 60 }, (_, i) => `> 0${i % 10}00 (60 ms)\n  4100${(0xbe1f9803 + i).toString(16).toUpperCase()}\n  = 18DAF111: 41 00 BE 1F 98 0${i % 10}`).join('\n')}`;

describe('a hex dump is not counted as prose', () => {
  it('costs about a token per character, not per 3.2', () => {
    const hex = '18DAF1111014490201384147 18DAF1112145413736433052 18DAF1112252303030303433'.repeat(20);
    expect(textTokens(hex)).toBeGreaterThan(hex.length / 1.6);
    expect(textTokens('El auto está detenido y el adaptador conectado. '.repeat(20))).toBeLessThan(`El auto está detenido y el adaptador conectado. `.length * 20 / 3);
  });

  it('a long chain of tools after two pasted captures still fits the window on every call', async () => {
    const requests: LlmRequest[] = [];
    const call = (name: string, args: object, id: string) => ({ id, name, arguments: JSON.stringify(args) });
    let round = 0;
    const llm: LlmPort = {
      complete: async (req) => {
        requests.push(req);
        round += 1;
        if (round >= 5) return say('Listo.');
        return { content: '', toolCalls: [call('obd_command', { command: `22 F1 ${round}0`, header: '18DA11F1' }, `a${round}`), call('obd_command', { command: `22 F1 ${round}1`, header: '18DA11F1' }, `b${round}`), call('obd_command', { command: `22 F1 ${round}2`, header: '18DA11F1' }, `c${round}`)], finishReason: 'tool_calls' };
      },
    };
    // Every reply is a big raw dump: the kind of tool result that overflowed.
    const big: VehicleToolsPort = { supportedPids: () => [...PIDS], execute: async () => ({ ok: true, data: { raw: '41 01 00 07 E1 21 '.repeat(900) }, summary: 'ok' }) };
    const past: ApiMessage[] = [
      { role: 'user', content: CAPTURE },
      { role: 'assistant', content: 'En el barrido no aparece el PID de odómetro.' },
      { role: 'user', content: CAPTURE },
      { role: 'assistant', content: 'El adaptador anda bien.' },
    ];
    const r = await runTurn({ history: past, text: '¿Probás con otros DIDs?', context: { ...CTX, labMode: true }, llm, vehicle: big, confirmation });

    expect(r.text).toBe('Listo.');
    for (const req of requests) expect(promptTokens(req) + maxTokensFor(CTX)).toBeLessThan(CONTEXT_TOKENS);
    // No single result went to the model whole.
    const results = requests.at(-1)!.messages.filter((m) => m.role === 'tool');
    expect(results.length).toBeGreaterThan(0);
    for (const m of results) expect(textTokens(m.content as string)).toBeLessThan(MAX_TOOL_RESULT_TOKENS + 60);
    // What gave way was the turn's older results (cut short), not the question.
    expect(results.some((m) => (m.content as string).includes('[recortado'))).toBe(true);
    expect(requests.at(-1)!.messages.some((m) => m.role === 'user' && typeof m.content === 'string' && m.content.includes('¿Probás con otros DIDs?'))).toBe(true);
  });
});

describe('the wait for the first word grows with the prompt', () => {
  it('a short prompt gets no extra time', () => {
    expect(prefillAllowanceMs('x'.repeat(4_000))).toBe(0);
  });

  it('a 12 000-token prompt gets ~12 s more (8 s + that = what an uncached prefill needs)', () => {
    const extra = prefillAllowanceMs('x'.repeat(12_000 * 3.2));
    expect(extra).toBeGreaterThan(10_000);
    expect(extra).toBeLessThan(14_000);
  });

  it('a photo counts as its vision tokens, not as its base64 characters', () => {
    const photo = `data:image/jpeg;base64,${'A'.repeat(400_000)}`;
    const withPhoto = prefillAllowanceMs(`{"messages":[{"content":"${photo}"}]}${'x'.repeat(3_000)}`);
    expect(withPhoto).toBeLessThan(2_000); // ~1 500 vision tokens + the text, a little over the free 2 000
  });
});
