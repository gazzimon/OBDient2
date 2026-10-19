// Suggested next questions (online): after each answer, a short separate call
// asks the model what the driver could ask next about *this* conversation.
// Fixed rules (suggestions.ts) are only for offline.
//
// The call has no tools and a small budget; it runs in the background after
// the answer is on screen, so it never delays it. If it fails, no buttons.

import type { ApiMessage, LlmRequest } from '@/domain/ports/llm.port';

export const NEXT_QUESTIONS = 3;
const MAX_TOKENS = 90;
const MESSAGE_CHARS = 500;
const QUESTION_CHARS = 60;

const INSTRUCTIONS = `Sos parte de OBDient, el asistente del auto de un conductor. Mirá el final de la conversación y proponé ${NEXT_QUESTIONS} preguntas o pedidos cortos que el conductor podría hacerle ahora al asistente para seguir ese mismo tema.
Reglas:
- Una por línea, sin números, guiones ni comillas.
- En primera persona del conductor, español rioplatense con voseo ("¿Qué reviso primero?", "Llevame a la más cercana").
- Menos de 8 palabras cada una.
- Que sean distintas entre sí y no repitan lo que ya se preguntó o respondió.
- Si OBDient terminó con una pregunta al conductor, la primera opción es una respuesta corta a esa pregunta ("Sí, vamos", "No, es otro lugar").
- Solo cosas que el asistente puede hacer: leer el auto (códigos, batería, sensores, monitores), buscar en internet, buscar direcciones y navegar, decir cuánto falta, explicar. Nada de tráfico, reservas, llamadas ni compras.`;

// The last exchange (and the question before it), as plain lines.
export function nextQuestionsRequest(history: readonly ApiMessage[]): LlmRequest {
  const lastUser = lastIndex(history, (m) => m.role === 'user');
  const prevUser = lastUser > 0 ? lastIndex(history.slice(0, lastUser), (m) => m.role === 'user') : -1;
  const tail = history.slice(Math.max(0, prevUser));
  const lines = tail.flatMap((m) => {
    if (m.role === 'user') return [`Conductor: ${clip(textOf(m.content))}`];
    if (m.role === 'assistant') {
      const used = (m.tool_calls ?? []).map((c) => c.function.name);
      return [...(used.length ? [`(OBDient usó: ${used.join(', ')})`] : []), ...(m.content ? [`OBDient: ${clip(m.content)}`] : [])];
    }
    return [];
  });
  return {
    messages: [
      { role: 'system', content: INSTRUCTIONS },
      { role: 'user', content: lines.join('\n') },
    ],
    tools: [],
    toolChoice: 'none',
    maxTokens: MAX_TOKENS,
    thinking: false,
  };
}

// The model's lines → up to three clean questions.
export function parseNextQuestions(text: string, asked: string | null = null): string[] {
  const seen = new Set<string>(asked ? [fold(asked)] : []);
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    const q = raw
      .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
      .replace(/^["“«']+|["”»']+$/g, '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/\.+$/, '')
      .trim();
    if (q.length < 4 || q.length > QUESTION_CHARS) continue;
    const key = fold(q);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length === NEXT_QUESTIONS) break;
  }
  return out;
}

function textOf(content: ApiMessage['content']): string {
  if (typeof content === 'string') return content;
  if (!content) return '';
  return content.flatMap((p) => (p.type === 'text' ? [p.text] : ['[foto]'])).join(' ');
}

function clip(text: string): string {
  const t = text.replace(/\n*\[estado:[^\]]*\]\s*$/, '').replace(/\s+/g, ' ').trim();
  return t.length > MESSAGE_CHARS ? `${t.slice(0, MESSAGE_CHARS - 1)}…` : t;
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ¿?¡!.]/g, '')
    .trim();

function lastIndex<T>(list: readonly T[], test: (x: T) => boolean): number {
  for (let i = list.length - 1; i >= 0; i--) if (test(list[i]!)) return i;
  return -1;
}
