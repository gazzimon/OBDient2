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
