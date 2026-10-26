import { MAX_MODEL_CALLS, MAX_TOOLS_PER_ROUND, runTurn, ToolMemo, type AgentEvent } from '@/domain/assistant/agent-loop';
import type { AssistantContext } from '@/domain/assistant/prompt';
import type { ToolCall, ToolOutcome } from '@/domain/assistant/tools';
import type { LlmPort, LlmRequest, LlmResult } from '@/domain/ports/llm.port';
import type { ConfirmationPort, VehicleToolsPort } from '@/domain/ports/vehicle-tools.port';

const STOPPED: AssistantContext = { connected: true, protocol: 'CAN 29/500', supportedPids: 4, moving: false, speedKmh: 0, navigating: false, labMode: false };
const MOVING: AssistantContext = { ...STOPPED, moving: true, speedKmh: 40 };

const call = (name: string, args: object | string = {}, id = '') => ({
  id,
  name,
  arguments: typeof args === 'string' ? args : JSON.stringify(args),
});
const say = (content: string): LlmResult => ({ content, toolCalls: [], finishReason: 'stop' });
const ask = (...calls: ReturnType<typeof call>[]): LlmResult => ({ content: '', toolCalls: calls, finishReason: 'tool_calls' });

// A model that answers from a script and records what it was asked.
function scripted(...answers: (LlmResult | ((req: LlmRequest) => LlmResult))[]) {
  const requests: LlmRequest[] = [];
  const llm: LlmPort = {
    async complete(req, opts) {
      requests.push(req);
      const next = answers.shift();
      if (!next) throw new Error('script ran out');
      const r = typeof next === 'function' ? next(req) : next;
      if (r.content) opts?.onText?.(r.content);
      return r;
    },
  };
  return { llm, requests };
}

function car(results: Partial<Record<ToolCall['name'], ToolOutcome>> = {}) {
  const executed: ToolCall[] = [];
  const vehicle: VehicleToolsPort = {
    supportedPids: () => ['SPEED', 'RPM', 'COOLANT_TEMP', 'ENGINE_LOAD'],
    async execute(c) {
      executed.push(c);
      return results[c.name] ?? { ok: true, data: { name: c.name }, summary: `${c.name} ok` };
    },
  };
  return { vehicle, executed };
}

const confirmWith = (answer: boolean) => {
  const asked: ToolCall[] = [];
  const confirmation: ConfirmationPort = {
    async confirm(c) {
      asked.push(c);
      return answer;
    },
  };
  return { confirmation, asked };
};

describe('runTurn', () => {
  it('runs parallel tool calls in order and answers with their results', async () => {
    const { llm, requests } = scripted(
      ask(call('read_pids', { pids: ['VOLTAGE'] }, 't1'), call('read_dtcs', { kind: 'stored' }, 't2')),
      say('La batería está en 12,6 V y no hay códigos guardados.'),
    );
    const { vehicle, executed } = car({
      read_pids: { ok: true, data: { VOLTAGE: 12.6 }, summary: 'Batería: 12,6 V' },
      read_dtcs: { ok: true, data: { codes: [] }, summary: 'Sin códigos guardados' },
    });
    const events: AgentEvent[] = [];
    const r = await runTurn({
      history: [],
      text: '¿Cómo está la batería y tengo códigos?',
      context: STOPPED,
      llm,
      vehicle,
      confirmation: confirmWith(true).confirmation,
      onEvent: (e) => events.push(e),
    });

    expect(executed.map((c) => c.name)).toEqual(['read_pids', 'read_dtcs']);
    expect(r.text).toBe('La batería está en 12,6 V y no hay códigos guardados.');
    expect(r.modelCalls).toBe(2);
    expect(r.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'tool', 'assistant']);
    expect(r.messages[2]).toEqual({ role: 'tool', tool_call_id: 't1', content: '{"result":{"VOLTAGE":12.6}}' });
    // The model sees the state, the UI never shows it.
    expect(requests[0]!.messages[1]).toMatchObject({ role: 'user', content: expect.stringContaining('[estado: adaptador conectado') });
    expect(requests[0]!.messages[0]!.role).toBe('system');
    expect(requests[0]!.toolChoice).toBe('auto');
    expect(events.filter((e) => e.type === 'tool_start')).toHaveLength(2);
  });

  it('ends after MAX_MODEL_CALLS: the last call cannot use tools, and empty text falls back to the results', async () => {
    const loop = () => ask(call('read_pids', { pids: ['RPM'] }));
    // Every call but the last asks for a tool; the last one has no tools and answers nothing.
    const { llm, requests } = scripted(...Array.from({ length: MAX_MODEL_CALLS - 1 }, () => loop), say(''));
    const { vehicle } = car({ read_pids: { ok: true, data: { RPM: 812 }, summary: 'RPM: 812' } });
    const r = await runTurn({ history: [], text: 'rpm?', context: STOPPED, llm, vehicle, confirmation: confirmWith(true).confirmation, memo: new ToolMemo(), now: () => 0 });

    expect(requests).toHaveLength(MAX_MODEL_CALLS);
    expect(requests.map((q) => q.toolChoice)).toEqual([...Array(MAX_MODEL_CALLS - 1).fill('auto'), 'none']);
    // The same summary four times is one line, and it says it is not an answer.
    expect(r.text).toBe('No pude armar la respuesta completa. Esto es lo que consulté:\nRPM: 812');
    // The history does not keep that list as if the model had said it.
    expect(r.messages.at(-1)).toEqual({ role: 'assistant', content: 'No pude armar la respuesta a esto.' });
  });

  it('an empty round after tools gets one closing round without tools, and its answer is the turn answer', async () => {
    // The 2026-10-21 chat: three searches, then the model came back empty and the
    // user was shown "5 resultados de la web" three times.
    const { llm, requests } = scripted(
      ask(call('web_search', { query: 'Tracker 2023 odómetro DID' }, 's1')),
      ask(call('web_search', { query: 'Tracker odómetro DID CAN FD' }, 's2')),
      say(''),
      say('No encontré el DID del odómetro en esas páginas; probemos leyendo una.'),
    );
    const { vehicle } = car({ web_search: { ok: true, data: { results: [] }, summary: '5 resultados de la web' } });
    const r = await runTurn({ history: [], text: 'buscá el DID', context: STOPPED, llm, vehicle, confirmation: confirmWith(true).confirmation, memo: new ToolMemo(), now: () => 0 });

    expect(r.text).toBe('No encontré el DID del odómetro en esas páginas; probemos leyendo una.');
    expect(requests.map((q) => q.toolChoice)).toEqual(['auto', 'auto', 'auto', 'none']);
    // The closing instruction travels in the request but not in the history.
    expect(requests[3]!.messages.at(-1)).toMatchObject({ role: 'user', content: expect.stringContaining('Ya no podés usar herramientas') });
    expect(JSON.stringify(r.messages)).not.toContain('Ya no podés usar herramientas');
    expect(r.messages.at(-1)).toEqual({ role: 'assistant', content: r.text });
    expect(r.rounds?.map((x) => x.closing)).toEqual([false, false, false, true]);
  });

  it('records why each call ended: finish reason, text, reasoning and tool calls', async () => {
    const { llm } = scripted(
      { content: '', toolCalls: [], finishReason: 'length', reasoningChars: 1800 },
    );
    const r = await runTurn({ history: [], text: 'hola', context: STOPPED, llm, vehicle: car().vehicle, confirmation: confirmWith(true).confirmation });
    expect(r.rounds).toEqual([{ finishReason: 'length', contentChars: 0, reasoningChars: 1800, toolCalls: 0, promptTokensEst: expect.any(Number), closing: false }]);
  });

  it('refuses invalid, unknown and excess calls without running them, and tells the model', async () => {
    // Distinct reads (identical ones would come from the memo).
    const many = [
      call('read_readiness', {}, 'r0'),
      call('read_freeze_frame', {}, 'r1'),
      call('read_vehicle_info', {}, 'r2'),
      call('read_dtcs', { kind: 'stored' }, 'r3'),
      call('read_dtcs', { kind: 'pending' }, 'r4'),
      call('read_dtcs', { kind: 'permanent' }, 'r5'),
      call('read_adapter_info', { include_power: true }, 'r6'),
    ];
    const { llm, requests } = scripted(
      ask(call('read_pids', '{"pids":["OIL_PRESSURE"]}', 'x1'), call('open_trunk', {}, 'x2'), ...many),
      say('Listo.'),
    );
    const { vehicle, executed } = car();
    const r = await runTurn({ history: [], text: '...', context: STOPPED, llm, vehicle, confirmation: confirmWith(true).confirmation });

    expect(r.invalidCalls).toBe(2);
    // 6 per round: 2 invalid + 4 readiness run, the rest refused.
    expect(executed).toHaveLength(MAX_TOOLS_PER_ROUND - 2);
    const toolMsgs = requests[1]!.messages.filter((m) => m.role === 'tool');
    expect(toolMsgs).toHaveLength(MAX_TOOLS_PER_ROUND + 3);
    expect(toolMsgs[0]!.content).toContain('"error":"invalid_arguments"');
    expect(toolMsgs[1]!.content).toContain('"error":"unknown_tool"');
    expect(toolMsgs[toolMsgs.length - 1]!.content).toContain('"error":"too_many_calls"');
  });

  it('asks the user before clearing codes and respects the answer', async () => {
    for (const accept of [false, true]) {
      const { llm } = scripted(ask(call('clear_dtcs', {}, 'c1')), say(accept ? 'Borrados.' : 'No borré nada.'));
      const { vehicle, executed } = car();
      const { confirmation, asked } = confirmWith(accept);
      const r = await runTurn({ history: [], text: 'borrá los códigos', context: STOPPED, llm, vehicle, confirmation });
      expect(asked).toEqual([{ name: 'clear_dtcs' }]);
      expect(executed.map((c) => c.name)).toEqual(accept ? ['clear_dtcs'] : []);
      expect(r.clears).toBe(accept ? 1 : 0);
      if (!accept) expect(r.messages[2]).toMatchObject({ content: expect.stringContaining('declined_by_user') });
    }
  });

  it('never clears while moving or twice in a conversation, and does not even ask', async () => {
    for (const [context, clearsSoFar, error] of [
      [MOVING, 0, 'not_allowed_while_moving'],
      [STOPPED, 1, 'already_done'],
    ] as const) {
      const { llm } = scripted(ask(call('clear_dtcs', {}, 'c1')), say('No.'));
      const { vehicle, executed } = car();
      const { confirmation, asked } = confirmWith(true);
      const r = await runTurn({ history: [], text: 'borrá', context, clearsSoFar, llm, vehicle, confirmation });
      expect(asked).toHaveLength(0);
      expect(executed).toHaveLength(0);
      expect(r.messages[2]).toMatchObject({ content: expect.stringContaining(error) });
    }
  });

  it('reuses a read made seconds ago, but measures again after MEMO_MS', async () => {
    const memo = new ToolMemo();
    let t = 0;
    const { vehicle, executed } = car();
    const turn = async () => {
      const { llm } = scripted(ask(call('read_pids', { pids: ['RPM'] })), say('ok'));
      await runTurn({ history: [], text: 'rpm', context: STOPPED, llm, vehicle, confirmation: confirmWith(true).confirmation, memo, now: () => t });
    };
    await turn();
    t = 5_000;
    await turn();
    expect(executed).toHaveLength(1);
    t = 20_000;
    await turn();
    expect(executed).toHaveLength(2);
  });

  it('stops when cancelled and leaves no tool call without an answer', async () => {
    const ac = new AbortController();
    const { llm, requests } = scripted(ask(call('read_pids', { pids: ['RPM'] }, 'a'), call('read_dtcs', { kind: 'stored' }, 'b')));
    const vehicle: VehicleToolsPort = {
      supportedPids: () => ['RPM'],
      async execute() {
        ac.abort(); // the user taps Stop while the first read runs
        return { ok: true, data: { RPM: 800 }, summary: 'RPM: 800' };
      },
    };
    const r = await runTurn({ history: [], text: 'x', context: STOPPED, llm, vehicle, confirmation: confirmWith(true).confirmation, signal: ac.signal });

    expect(r.cancelled).toBe(true);
    expect(requests).toHaveLength(1);
    const ids = r.messages.flatMap((m) => (m.role === 'assistant' ? (m.tool_calls ?? []).map((c) => c.id) : []));
    const answered = r.messages.flatMap((m) => (m.role === 'tool' ? [m.tool_call_id] : []));
    expect(answered).toEqual(ids);
    expect(r.messages[r.messages.length - 1]).toMatchObject({ content: expect.stringContaining('cancelled') });
  });

  it('sends the trimmed history and reports what was left out', async () => {
    const old = Array.from({ length: 60 }, (_, i) => [
      { role: 'user' as const, content: `pregunta ${i} ${'x'.repeat(700)}` },
      { role: 'assistant' as const, content: 'y'.repeat(700) },
    ]).flat();
    const { llm, requests } = scripted(say('ok'));
    const r = await runTurn({ history: old, text: 'nueva', context: STOPPED, llm, vehicle: car().vehicle, confirmation: confirmWith(true).confirmation });
    expect(r.dropped.length).toBeGreaterThan(0);
    expect(requests[0]!.messages.length).toBeLessThan(old.length + 2);
    expect(requests[0]!.messages[1]!.role).toBe('user');
  });

  it('the model never reads the VIN serial: not in a tool result, not in what the driver pasted, not in the history', async () => {
    const vin = '8AGEA76C0RR000099';
    const { llm, requests } = scripted(ask(call('read_vehicle_info', {}, 'v1')), say('Es un Chevrolet.'));
    const { vehicle } = car({ read_vehicle_info: { ok: true, data: { vin, make: 'chevrolet' }, summary: `VIN ${vin}, 21 PIDs soportados` } });
    const r = await runTurn({
      history: [{ role: 'user', content: `mi VIN es ${vin}` }, { role: 'assistant', content: 'Anotado.' }],
      text: `= ECU ?: 49 02 01 38 41 47 45 41 37 36 43 30 52 52 30 30 30 30 39 39`,
      context: STOPPED,
      llm,
      vehicle,
      confirmation: confirmWith(true).confirmation,
    });
    for (const q of requests) expect(JSON.stringify(q.messages)).not.toMatch(/000043|30 30 30 30 39 39/);
    expect(JSON.stringify(requests[1]!.messages)).toContain('8AGEA76C0RR••••••');
    expect(JSON.stringify(requests[1]!.messages)).toContain('chevrolet');
    // The owner's history keeps what the car said, in full.
    expect(JSON.stringify(r.messages)).toContain(vin);
  });

  it('the same search twice in a turn is refused with what to do instead; a third search too', async () => {
    const { llm, requests } = scripted(
      ask(call('research', { query: 'Odómetro  Tracker 2023' }, 'r1')),
      ask(call('research', { query: 'odometro tracker 2023' }, 'r2')), // same words, other spelling
      ask(call('web_search', { query: 'taller GM Posadas' }, 'w1')),
      ask(call('research', { query: 'Tracker CAN FD odómetro UDS' }, 'r3')),
      say('No apareció el DID en las páginas que leí.'),
    );
    const { vehicle, executed } = car({ research: { ok: true, data: { grade: 'none', passages: [] }, summary: 'no apareció' } });
    const r = await runTurn({ history: [], text: 'buscá el DID', context: STOPPED, llm, vehicle, confirmation: confirmWith(true).confirmation, memo: new ToolMemo(), now: () => 0 });
    expect(executed.map((c) => c.name)).toEqual(['research', 'web_search']);
    expect(requests[2]!.messages.at(-1)).toMatchObject({ role: 'tool', content: expect.stringContaining('Ya buscaste eso') });
    expect(requests[4]!.messages.at(-1)).toMatchObject({ role: 'tool', content: expect.stringContaining('Ya hiciste 2 búsquedas') });
    expect(r.answered).toBe(true);
  });

  it('web lookups asked in one round run at the same time; car reads do not', async () => {
    let running = 0;
    let most = 0;
    const slow: VehicleToolsPort = {
      supportedPids: () => ['SPEED', 'RPM', 'COOLANT_TEMP', 'ENGINE_LOAD'],
      async execute(c) {
        running += 1;
        most = Math.max(most, running);
        await new Promise((res) => setTimeout(res, 20));
        running -= 1;
        return { ok: true, data: { name: c.name }, summary: c.name };
      },
    };
    const web = scripted(ask(call('research', { query: 'odómetro GM' }, 'a'), call('docs_search', { query: 'F190' }, 'b'), call('knowledge_lookup', { make: 'chevrolet' }, 'c')), say('listo'));
    await runTurn({ history: [], text: 'x', context: STOPPED, llm: web.llm, vehicle: slow, confirmation: confirmWith(true).confirmation });
    expect(most).toBe(3);
    // Results go back to the model in the order they were asked.
    expect(web.requests[1]!.messages.slice(-3).map((m) => (m as { tool_call_id: string }).tool_call_id)).toEqual(['a', 'b', 'c']);

    most = 0;
    const carReads = scripted(ask(call('read_dtcs', { kind: 'stored' }, 'd'), call('read_readiness', {}, 'e')), say('listo'));
    await runTurn({ history: [], text: 'x', context: STOPPED, llm: carReads.llm, vehicle: slow, confirmation: confirmWith(true).confirmation });
    expect(most).toBe(1);
  });

  it('a turn that ends in the fallback is not "answered" (no next questions about it)', async () => {
    const loop = () => ask(call('read_pids', { pids: ['RPM'] }));
    const { llm } = scripted(...Array.from({ length: MAX_MODEL_CALLS - 1 }, () => loop), say(''));
    const r = await runTurn({ history: [], text: 'rpm?', context: STOPPED, llm, vehicle: car().vehicle, confirmation: confirmWith(true).confirmation, memo: new ToolMemo(), now: () => 0 });
    expect(r.answered).toBe(false);
  });

  it('answers shorter while driving', async () => {
    const { llm, requests } = scripted(say('Vas bien.'));
    await runTurn({ history: [], text: '¿todo bien?', context: MOVING, llm, vehicle: car().vehicle, confirmation: confirmWith(true).confirmation });
    expect(requests[0]!.maxTokens).toBeLessThan(200);
    expect(requests[0]!.messages[1]).toMatchObject({ content: expect.stringContaining('auto en movimiento a 40 km/h') });
  });

  it('a leaked internal marker is not shown; alone, the model is asked again', async () => {
    const { llm, requests } = scripted(say('[tool: read_pids]'), ask(call('read_pids', { pids: ['VOLTAGE'] }, 't1')), say('12,6 V. [INTENT]'));
    const { vehicle } = car({ read_pids: { ok: true, data: { VOLTAGE: 12.6 }, summary: 'VOLTAGE 12,6 V' } });
    const r = await runTurn({ history: [], text: 'batería', context: STOPPED, llm, vehicle, confirmation: confirmWith(true).confirmation });
    expect(r.text).toBe('12,6 V.');
    expect(requests).toHaveLength(3);
  });
});
