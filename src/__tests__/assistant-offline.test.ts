import { runTurn } from '@/domain/assistant/agent-loop';
import { addNote, addOfflineAnswer, addUserMessage, applySummary, clearNotes, MAX_MESSAGES, newConversation, type Conversation } from '@/domain/assistant/conversation';
import { MAX_NOTES, makeNote, noteReply, notesBrief } from '@/domain/assistant/offline';
import { OFFLINE_READ_MS, OfflineAssistant } from '@/domain/assistant/offline-assistant';
import { routePhrase } from '@/domain/assistant/phrase-router';
import type { AssistantContext } from '@/domain/assistant/prompt';
import { SUMMARY_PREFIX, summaryMessages, summaryRequest } from '@/domain/assistant/summary';
import { matchSymptoms } from '@/domain/assistant/symptoms';
import type { ApiMessage, LlmPort, LlmRequest } from '@/domain/ports/llm.port';
import type { VehicleToolsPort } from '@/domain/ports/vehicle-tools.port';
import type { ToolCall, ToolOutcome } from '@/domain/assistant/tools';

const CTX: AssistantContext = { connected: true, protocol: 'CAN 11/500', supportedPids: 4, moving: false, speedKmh: 0, navigating: false };

describe('phrase router', () => {
  it.each([
    ['¿Tengo códigos?', 'codes'],
    ['leeme los códigos', 'codes'],
    ['DTC', 'codes'],
    ['medime la batería', 'battery'],
    ['¿cómo está la tensión?', 'battery'],
    ['¿ya pasa la VTV?', 'readiness'],
    ['mostrame el freeze frame', 'freeze_frame'],
    ['¿cuánto falta?', 'route_status'],
    ['¿a qué hora llego?', 'route_status'],
    ['cancelá la navegación', 'stop_navigation'],
  ])('%s → %s', (text, intent) => {
    expect(routePhrase(text)).toBe(intent);
  });

  it.each([
    'el auto tiembla cuando acelero',
    'la batería del control remoto se gastó',
    'me falta plata para el service',
    'no entiendo los códigos de la radio',
    'qué es un freno',
    '',
  ])('does not take "%s"', (text) => {
    expect(routePhrase(text)).toBeNull();
  });
});

describe('symptoms', () => {
  it('finds symptoms and tells denials apart', () => {
    const m = matchSymptoms('Tironea al acelerar y huele a quemado, pero no tira humo blanco');
    expect(m.confirmed).toEqual(expect.arrayContaining(['hesitation', 'smell_burning']));
    expect(m.denied).toEqual(['smoke_white']);
  });
  it('"no arranca" is the symptom, not a denial', () => {
    expect(matchSymptoms('no arranca').confirmed).toEqual(['no_start']);
  });
  it('a sentence break cancels the negation', () => {
    expect(matchSymptoms('no sé. Tiembla en ralenti').confirmed).toContain('rough_idle');
  });
  it('matches whole words only', () => {
    expect(matchSymptoms('estiembla').confirmed).toEqual([]);
  });
  it('flashing check light is not also "on"', () => {
    expect(matchSymptoms('el check engine titila').confirmed).toEqual(['check_flashing']);
  });
});

function tools(map: Partial<Record<ToolCall['name'], ToolOutcome>>, calls: ToolCall[] = []): VehicleToolsPort {
  return {
    supportedPids: () => ['RPM', 'SPEED', 'COOLANT_TEMP'],
    execute: async (call) => {
      calls.push(call);
      return map[call.name] ?? { ok: false, error: 'not_supported', message: 'no' };
    },
  };
}

const DTCS: ToolOutcome = {
  ok: true,
  data: { codes: [{ code: 'P0301', description: 'Falla de encendido en el cilindro 1. Detalle largo.' }] },
  summary: 'Códigos',
};
const NO_DTCS: ToolOutcome = { ok: true, data: { codes: [] }, summary: 'Sin códigos' };

describe('offline assistant', () => {
  const input = (text: string, photos = 0) => ({ id: 'n1', at: 1000, text, photos });

  it('answers a known phrase from the tool, without the model', async () => {
    const a = new OfflineAssistant(tools({ read_dtcs: DTCS }));
    const r = await a.handle(input('¿tengo códigos?'), CTX);
    expect(r).toEqual({ kind: 'answer', intent: 'codes', text: 'El auto tiene 1 código:\n- P0301: Falla de encendido en el cilindro 1' });
  });

  it('says so when there are no codes and when the voltage is read', async () => {
    const a = new OfflineAssistant(tools({ read_dtcs: NO_DTCS, read_pids: { ok: true, data: { VOLTAGE: { value: 12.64, unit: 'V' } }, summary: '' } }));
    expect((await a.handle(input('tengo códigos'), CTX))).toMatchObject({ text: 'El auto no tiene códigos guardados.' });
    expect((await a.handle(input('medime la batería'), CTX))).toMatchObject({ text: 'La tensión es 12,6 V.' });
  });

  it('asks for the adapter when the car is needed and it is not connected', async () => {
    const calls: ToolCall[] = [];
    const a = new OfflineAssistant(tools({}, calls));
    const r = await a.handle(input('¿tengo códigos?'), { ...CTX, connected: false });
    expect(r).toMatchObject({ kind: 'answer' });
    expect(calls).toEqual([]);
  });

  it('answers route status from the navigation tool even without the adapter', async () => {
    const status: ToolOutcome = { ok: true, data: { navigating: true, remainingKm: 3.2, remainingMin: 9, arrival: '14:35' }, summary: '' };
    const a = new OfflineAssistant(tools({ route_status: status }));
    const r = await a.handle(input('¿cuánto falta?'), { ...CTX, connected: false });
    expect(r).toMatchObject({ text: 'Faltan 3,2 km, unos 9 minutos: llegás a las 14:35.' });
  });

  it('anything else becomes a note with the car at that moment', async () => {
    const a = new OfflineAssistant(
      tools({
        read_dtcs: DTCS,
        read_pids: {
          ok: true,
          data: { RPM: { value: 850, unit: 'rpm' }, COOLANT_TEMP: { value: 88, unit: '°C' } },
          summary: '',
        },
      }),
    );
    const r = await a.handle(input('tironea al acelerar y no tira humo blanco'), CTX);
    expect(r.kind).toBe('note');
    if (r.kind !== 'note') return;
    expect(r.note.symptoms).toEqual(['hesitation']);
    expect(r.note.denied).toEqual(['smoke_white']);
    expect(r.note.car?.codes).toEqual(['P0301']);
    expect(r.note.car?.values).toContain('850 rpm');
  });

  it('a note without the adapter has no car data, and a message with a photo is always a note', async () => {
    const a = new OfflineAssistant(tools({}));
    const r = await a.handle(input('¿tengo códigos?', 1), { ...CTX, connected: false });
    expect(r.kind).toBe('note');
    if (r.kind === 'note') {
      expect(r.note.car).toBeNull();
      expect(r.note.text).toContain('foto');
    }
  });

  it('a read that never answers does not hold the note', async () => {
    jest.useFakeTimers();
    try {
      const hang: VehicleToolsPort = { supportedPids: () => ['RPM'], execute: () => new Promise(() => undefined) };
      const p = new OfflineAssistant(hang).handle(input('hace un ruido raro'), CTX);
      await jest.advanceTimersByTimeAsync(OFFLINE_READ_MS * 2 + 10);
      const r = await p;
      expect(r.kind).toBe('note');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('notes', () => {
  it('the reply names what was noted and asks the two questions once', () => {
    const n1 = makeNote('a', 1, 'tironea al acelerar', false, { codes: ['P0301'], values: null });
    expect(noteReply(n1, [])).toContain('¿Desde cuándo pasa?');
    expect(noteReply(n1, [])).toContain('P0301');
    const n2 = makeNote('b', 2, 'pasa en frío', false, null);
    expect(noteReply(n2, [n1])).not.toContain('¿Desde cuándo');
  });

  it('the brief carries the words, symptoms, denials and the car', () => {
    const n = makeNote('a', 1, 'tironea y no tira humo blanco', true, { codes: [], values: 'RPM 850 rpm' });
    const text = notesBrief([n], () => '14:02');
    expect(text).toContain('1 nota');
    expect(text).toContain('14:02 (en movimiento): "tironea y no tira humo blanco"');
    expect(text).toContain('síntomas: tironea al acelerar');
    expect(text).toContain('dice que no: humo blanco');
    expect(text).toContain('sin códigos');
    expect(text).toContain('RPM 850 rpm');
  });

  it('are kept per conversation, bounded, and cleared by id', () => {
    let c = newConversation('c', 0);
    for (let i = 0; i < MAX_NOTES + 3; i++) c = addNote(c, makeNote(`n${i}`, i, 'x', false, null));
    expect(c.notes).toHaveLength(MAX_NOTES);
    expect(c.notes![0]!.id).toBe('n3');
    c = clearNotes(c, ['n3', 'n4']);
    expect(c.notes).toHaveLength(MAX_NOTES - 2);
  });

  it('an offline answer is on screen but not in the API history', () => {
    let c = addUserMessage(newConversation('c', 0), 'u', 'hola', 0, 1);
    c = addOfflineAnswer(c, 'a', 'Lo anoté.', 2);
    expect(c.items.at(-1)).toMatchObject({ kind: 'assistant', offline: true });
    expect(c.api).toEqual([]);
    for (let i = 0; i < MAX_MESSAGES + 5; i++) c = addOfflineAnswer(c, `a${i}`, 'x', 3);
    expect(c.items).toHaveLength(MAX_MESSAGES);
  });
});

describe('summary', () => {
  const turn = (q: string, a: string): ApiMessage[] => [
    { role: 'user', content: `${q}\n\n[estado: adaptador conectado · auto detenido · sin navegación]` },
    { role: 'assistant', content: a },
  ];

  it('asks the model for a summary without tools, hiding the state block', () => {
    const req = summaryRequest('Auto: Corsa.', turn('¿códigos?', 'P0301'));
    expect(req.tools).toEqual([]);
    const user = req.messages[1]!.content as string;
    expect(user).toContain('Resumen anterior:\nAuto: Corsa.');
    expect(user).toContain('Conductor: ¿códigos?');
    expect(user).not.toContain('[estado');
  });

  it('is the first exchange of the history', () => {
    expect(summaryMessages(null)).toEqual([]);
    const [u, a] = summaryMessages('Corsa 1.4, P0301.');
    expect(u).toEqual({ role: 'user', content: `${SUMMARY_PREFIX}\nCorsa 1.4, P0301.` });
    expect(a?.role).toBe('assistant');
  });

  it('replaces the dropped turns only if the history still starts with them', () => {
    const t1 = turn('a', 'b');
    const t2 = turn('c', 'd');
    let c: Conversation = { ...newConversation('c', 0), api: [...t1, ...t2] };
    const same = applySummary(c, [...c.api.slice(0, 1), ...c.api.slice(2, 3)], 'x');
    expect(same).toBe(c);
    c = applySummary(c, t1, 'resumen');
    expect(c.api).toEqual(t2);
    expect(c.summary).toBe('resumen');
  });

  it('goes to the model ahead of the history and takes room from the budget', async () => {
    const seen: LlmRequest[] = [];
    const llm: LlmPort = {
      complete: async (req) => {
        seen.push(req);
        return { content: 'ok', toolCalls: [], finishReason: 'stop' };
      },
    };
    const vehicle: VehicleToolsPort = { supportedPids: () => [], execute: async () => ({ ok: false, error: 'not_supported', message: '' }) };
    await runTurn({ history: turn('antes', 'sí'), summary: 'Corsa 1.4.', text: 'ahora', context: CTX, llm, vehicle, confirmation: { confirm: async () => true } });
    const m = seen[0]!.messages;
    expect(m[0]!.role).toBe('system');
    expect(m[1]).toMatchObject({ role: 'user', content: expect.stringContaining('Corsa 1.4.') });
    expect(m[2]).toMatchObject({ role: 'assistant', content: 'Entendido.' });
    expect(m[3]).toMatchObject({ role: 'user' });
  });
});
