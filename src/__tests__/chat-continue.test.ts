import { continuation, failTurn, newConversation, addUserMessage } from '@/domain/assistant/conversation';
import { estimateTokens, SUMMARY_FROM, SUMMARY_KEEP, turnsToSummarize } from '@/domain/assistant/history';
import { summaryRequest } from '@/domain/assistant/summary';
import type { ApiMessage } from '@/domain/ports/llm.port';

const turns = (n: number, size: number): ApiMessage[] =>
  Array.from({ length: n }).flatMap((_, i): ApiMessage[] => [
    { role: 'user', content: `Pregunta ${i}: ${'dato '.repeat(size)}` },
    { role: 'assistant', content: `Respuesta ${i}: ${'valor '.repeat(size)}` },
  ]);
const tokens = (ms: readonly ApiMessage[]) => ms.reduce((s, m) => s + estimateTokens(m), 0);

describe('summary before the window is full', () => {
  it('below SUMMARY_FROM nothing is summarised', () => {
    const short = turns(4, 50);
    expect(tokens(short)).toBeLessThan(SUMMARY_FROM);
    expect(turnsToSummarize(short)).toEqual([]);
  });

  it('past it, the oldest whole turns go to the summary and the rest fits SUMMARY_KEEP', () => {
    const long = turns(20, 150);
    expect(tokens(long)).toBeGreaterThan(SUMMARY_FROM);
    const old = turnsToSummarize(long);
    expect(old.length % 2).toBe(0); // whole turns: a question with its answer
    expect(old).toEqual(long.slice(0, old.length)); // a prefix: applySummary can replace it
    expect(tokens(long.slice(old.length))).toBeLessThanOrEqual(SUMMARY_KEEP);
  });

  it('the summary keeps what was measured, with its result', () => {
    const sys = summaryRequest(null, turns(1, 5)).messages[0]!.content as string;
    expect(sys).toMatch(/comandos, DIDs o PIDs probados y su resultado/);
    expect(sys).toMatch(/lo que el conductor corrigió/);
    expect(sys).toMatch(/No inventes/);
  });
});

describe('going on in a new conversation', () => {
  it('a conversation that no longer fits offers to go on in a new one', () => {
    const c = failTurn(addUserMessage(newConversation('c', 0), 'u', 'hola', 0, 1), 'e', 'demasiado larga', 'hola', 2, 'continue_new');
    expect(c.items.at(-1)).toMatchObject({ kind: 'error', retryText: 'hola', action: 'continue_new' });
    expect(failTurn(newConversation('d', 0), 'e', 'x', null, 1).items.at(-1)).not.toHaveProperty('action');
  });

  it('the new one starts with the old one’s summary, read by the model first, and says so', () => {
    const old = { ...newConversation('old', 0), title: 'Odómetro del Tracker' };
    const c = continuation(newConversation('new', 5), 'Tracker 2023, ELM327 v2.2, CAN 29 bits; el 18DA11F1 no respondió a 22 F1 87–8F.', old, 'a1', 6);
    expect(c.id).toBe('new');
    expect(c.summary).toContain('18DA11F1');
    expect(c.title).toBe('Odómetro del Tracker');
    expect(c.api).toEqual([]);
    expect(c.items[0]).toMatchObject({ kind: 'assistant', offline: true, text: expect.stringContaining('quedó guardada') });
    // Without a summary it still says where the old one is.
    expect(continuation(newConversation('n2', 5), null, old, 'a2', 6).items[0]).toMatchObject({ text: expect.stringContaining('"Odómetro del Tracker" quedó guardada') });
  });
});
