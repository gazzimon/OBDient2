import { trimHistory, estimateTokens } from '@/domain/assistant/history';
import { ChatStreamAccumulator, SseDecoder } from '@/domain/assistant/sse';
import type { ApiMessage } from '@/domain/ports/llm.port';

const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

describe('SseDecoder', () => {
  it('reassembles events split anywhere, including mid-line and on \\r\\n', () => {
    const stream = `${chunk({ content: 'Ho' })}${chunk({ content: 'la' })}: keep-alive\r\n\r\ndata: [DONE]\n\n`;
    for (const size of [1, 3, 7, stream.length]) {
      const d = new SseDecoder();
      const out: string[] = [];
      for (let i = 0; i < stream.length; i += size) out.push(...d.push(stream.slice(i, i + size)));
      expect(out.map((p) => (p === '[DONE]' ? p : JSON.parse(p).choices[0].delta.content))).toEqual(['Ho', 'la', '[DONE]']);
    }
  });
});

describe('ChatStreamAccumulator', () => {
  const feed = (events: string) => {
    const acc = new ChatStreamAccumulator();
    const visible: string[] = [];
    for (const p of new SseDecoder().push(events)) visible.push(acc.push(p));
    return { acc, visible: visible.join('') };
  };

  it('assembles parallel tool calls whose fragments arrive by index', () => {
    const { acc } = feed(
      chunk({ tool_calls: [{ index: 0, id: 'a', function: { name: 'read_pids', arguments: '' } }] }) +
        chunk({ tool_calls: [{ index: 1, id: 'b', function: { name: 'read_', arguments: '{"kind"' } }] }) +
        chunk({ tool_calls: [{ index: 0, function: { arguments: '{"pids":["VOL' } }] }) +
        chunk({ tool_calls: [{ index: 1, function: { name: 'dtcs', arguments: ':"stored"}' } }] }) +
        chunk({ tool_calls: [{ index: 0, function: { arguments: 'TAGE"]}' } }] }, 'tool_calls') +
        'data: [DONE]\n\n',
    );
    expect(acc.toolCalls).toEqual([
      { id: 'a', name: 'read_pids', arguments: '{"pids":["VOLTAGE"]}' },
      { id: 'b', name: 'read_dtcs', arguments: '{"kind":"stored"}' },
    ]);
    expect(acc.finishReason).toBe('tool_calls');
    expect(acc.done).toBe(true);
  });

  it('never shows reasoning and drops the blank lines it leaves before the answer', () => {
    const { acc, visible } = feed(
      chunk({ reasoning_content: 'Thinking in English...' }) +
        chunk({ reasoning: 'more' }) +
        chunk({ content: '\n\n' }) +
        chunk({ content: 'La batería ' }) +
        chunk({ content: 'está bien.' }, 'stop'),
    );
    expect(visible).toBe('La batería está bien.');
    expect(acc.content).toBe('La batería está bien.');
  });

  it('counts malformed payloads without failing', () => {
    const { acc, visible } = feed('data: {not json\n\n' + chunk({ content: 'ok' }));
    expect(acc.malformed).toBe(1);
    expect(visible).toBe('ok');
  });
});

describe('trimHistory', () => {
  const user = (n: number, len = 350): ApiMessage => ({ role: 'user', content: `${n} ${'x'.repeat(len)}` });
  const toolTurn = (n: number): ApiMessage[] => [
    user(n),
    {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: `c${n}`, type: 'function', function: { name: 'read_pids', arguments: '{"pids":["RPM"]}' } }],
    },
    { role: 'tool', tool_call_id: `c${n}`, content: '{"result":{"RPM":800}}' },
    { role: 'assistant', content: 'a'.repeat(350) },
  ];

  it('drops whole old turns and never separates a tool call from its result', () => {
    const history = [...toolTurn(1), ...toolTurn(2), ...toolTurn(3)];
    const perTurn = toolTurn(1).reduce((s, m) => s + estimateTokens(m), 0);
    const { kept, dropped } = trimHistory(history, perTurn * 2);
    expect(kept).toEqual([...toolTurn(2), ...toolTurn(3)]);
    expect(dropped).toEqual(toolTurn(1));
    for (const m of kept) {
      if (m.role === 'tool') {
        expect(kept.some((a) => a.role === 'assistant' && a.tool_calls?.some((t) => t.id === m.tool_call_id))).toBe(true);
      }
    }
  });

  it('always keeps the last turn, even over budget', () => {
    const { kept } = trimHistory([user(1), user(2, 10_000)], 10);
    expect(kept).toEqual([user(2, 10_000)]);
  });

  it('ignores system messages (the loop adds its own)', () => {
    const { kept } = trimHistory([{ role: 'system', content: 'old prompt' }, user(1)], 1000);
    expect(kept).toEqual([user(1)]);
  });

  it('charges attached images', () => {
    const withImage: ApiMessage = {
      role: 'user',
      content: [
        { type: 'text', text: '¿Qué es esta luz?' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,xx' } },
      ],
    };
    expect(estimateTokens(withImage)).toBeGreaterThan(800);
  });
});
