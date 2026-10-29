import { addUserMessage, newConversation, setNextQuestions } from '@/domain/assistant/conversation';
import { nextQuestionsRequest, parseNextQuestions } from '@/domain/assistant/next-questions';
import type { ApiMessage } from '@/domain/ports/llm.port';

const HISTORY: ApiMessage[] = [
  { role: 'user', content: '¿Cómo está la batería?\n\n[estado: adaptador conectado · auto detenido · sin navegación]' },
  { role: 'assistant', content: 'Bien, 12,6 V.' },
  { role: 'user', content: 'Buscame ferreterías cerca\n\n[estado: adaptador conectado · auto detenido · sin navegación]' },
  { role: 'assistant', content: null, tool_calls: [{ id: '1', type: 'function', function: { name: 'web_search', arguments: '{}' } }] },
  { role: 'tool', tool_call_id: '1', content: '{"result":{}}' },
  { role: 'assistant', content: 'Encontré 3 ferreterías: A, B y C.' },
];

describe('next questions', () => {
  it('asks about the last exchange only, without tools or the state block', () => {
    const req = nextQuestionsRequest(HISTORY);
    expect(req.tools).toEqual([]);
    const text = req.messages[1]!.content as string;
    expect(text).toContain('Conductor: ¿Cómo está la batería?');
    expect(text).toContain('Conductor: Buscame ferreterías cerca');
    expect(text).toContain('(OBDient usó: web_search)');
    expect(text).toContain('OBDient: Encontré 3 ferreterías');
    expect(text).not.toContain('[estado');
    expect(text).not.toContain('"result"');
  });

  it('sees what the tools were asked and what they gave, and the last answer in full', () => {
    const long = `El 714 contestó F187 y F18C. ${'x'.repeat(600)}`;
    const text = nextQuestionsRequest([
      { role: 'user', content: '¿Qué DIDs contesta el tablero?' },
      { role: 'assistant', content: null, tool_calls: [{ id: '1', type: 'function', function: { name: 'did_probe', arguments: '{"mode":"scan","header":"714"}' } }] },
      { role: 'tool', tool_call_id: '1', content: '{"result":{"verdict":"link_ok","supported":["F187","F18C"]}}' },
      { role: 'assistant', content: long },
    ]).messages[1]!.content as string;
    expect(text).toContain('(OBDient usó: did_probe {"mode":"scan","header":"714"})');
    expect(text).toContain('(dio: {"verdict":"link_ok","supported":["F187","F18C"]})');
    expect(text).toContain(long.slice(0, 600));
  });

  it('keeps the thread: the summary and how it began when the start is out of the recent turns', () => {
    const turns: ApiMessage[] = [{ role: 'user', content: 'El auto tira P0562, ¿qué es?' }, { role: 'assistant', content: 'Tensión baja del sistema.' }];
    for (let i = 0; i < 5; i++) turns.push({ role: 'user', content: `pregunta ${i}` }, { role: 'assistant', content: `respuesta ${i}` });
    const text = nextQuestionsRequest(turns, { summary: 'Se midió la batería en 11,9 V.' }).messages[1]!.content as string;
    expect(text).toContain('Resumen de lo anterior: Se midió la batería en 11,9 V.');
    expect(text).toContain('Después del resumen: Conductor: El auto tira P0562');
    expect(text).not.toContain('pregunta 0');
    expect(text).toContain('pregunta 4');
    // Short enough to fit: the beginning appears once, as a recent turn.
    expect(nextQuestionsRequest(turns.slice(0, 4)).messages[1]!.content).not.toContain('Inicio de la conversación');
  });

  it('for the workshop: the mechanic, and no shopping or routes on its own', () => {
    const req = nextQuestionsRequest(HISTORY, { audience: 'workshop' });
    const system = req.messages[0]!.content as string;
    expect(system).toContain('mecánico');
    expect(system).toContain('Nada de precios, repuestos, comercios, talleres ni navegación');
    expect(system).not.toContain('Llevame a la más cercana');
    expect(req.messages[1]!.content).toContain('Mecánico: ¿Cómo está la batería?');
    expect(nextQuestionsRequest(HISTORY).messages[0]!.content).toContain('tema central');
  });

  it('cleans the model lines: numbers, bullets, quotes, repeats, too long', () => {
    const out = parseNextQuestions(
      '1. ¿Cuál abre ahora?\n- "Llevame a la más cercana"\n• ¿Cuál abre ahora\n\n¿Tienen estacionamiento para camionetas grandes y utilitarios pesados?\n[INTENT] ¿Qué venden?\n¿Algo más?',
      'Buscame ferreterías cerca',
    );
    expect(out).toEqual(['¿Cuál abre ahora?', 'Llevame a la más cercana', '¿Qué venden?']);
  });

  it('never repeats what was just asked', () => {
    expect(parseNextQuestions('¿Cómo está la batería?\n¿Tengo códigos?', '¿Cómo está la batería?')).toEqual(['¿Tengo códigos?']);
  });

  it('are kept only for the answer they were made for', () => {
    let c = addUserMessage(newConversation('c', 0), 'u1', 'hola', 0, 1);
    expect(setNextQuestions(c, 'u1', ['¿A?']).next).toEqual({ afterId: 'u1', questions: ['¿A?'] });
    c = addUserMessage(c, 'u2', 'otra', 0, 2);
    expect(setNextQuestions(c, 'u1', ['¿A?']).next).toBeUndefined();
    expect(setNextQuestions(c, 'u2', []).next).toBeUndefined();
  });
});
