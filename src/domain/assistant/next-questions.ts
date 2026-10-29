// Suggested next questions (online): after each answer, a short separate call
// asks the model what the user could ask next about *this* conversation.
// Fixed rules (suggestions.ts) are only for offline.
//
// The call has no tools and a small budget; it runs in the background after
// the answer is on screen, so it never delays it. If it fails, no buttons.
//
// It gets what the conversation is about, not only its last line: how it began,
// the summary of the turns already dropped, the recent turns with what the tools
// measured, and the last answer in full (2026-10-28: with only the last exchange
// the buttons drifted to prices and places in the middle of a diagnosis).

import type { ApiMessage, LlmRequest } from '@/domain/ports/llm.port';
import { CAR_BLOCKS } from '@/domain/vehicle/car-brief';

export const NEXT_QUESTIONS = 3;
const MAX_TOKENS = 120;
// Recent user turns shown, newest first, until RECENT_CHARS is spent.
const RECENT_TURNS = 4;
const RECENT_CHARS = 3_500;
const MESSAGE_CHARS = 400;
const LAST_ANSWER_CHARS = 900;
const OPENING_CHARS = 300;
const SUMMARY_CHARS = 600;
const TOOL_ARGS_CHARS = 80;
const TOOL_RESULT_CHARS = 160;
const QUESTION_CHARS = 60;

export type Audience = 'driver' | 'workshop';

const WHO: Record<Audience, { label: string; reader: string; examples: string; scope: string }> = {
  driver: {
    label: 'Conductor',
    reader: 'el asistente del auto de un conductor',
    examples: '"¿Qué reviso primero?", "Llevame a la más cercana"',
    scope:
      'leer el auto (códigos, batería, sensores, monitores), buscar en internet, buscar direcciones y navegar, decir cuánto falta, explicar. Nada de tráfico, reservas, llamadas ni compras.',
  },
  workshop: {
    label: 'Mecánico',
    reader: 'el asistente de diagnóstico de un mecánico, que tiene el auto en el taller',
    examples: '"Leé el freeze frame", "¿Qué DIDs contesta el 714?"',
    scope:
      'leer el auto (códigos, freeze frame, PIDs, monitores, módulos, DIDs), buscar en documentación e internet, explicar. Nada de precios, repuestos, comercios, talleres ni navegación, salvo que la conversación ya sea sobre eso.',
  },
};

function instructions(audience: Audience): string {
  const w = WHO[audience];
  const who = w.label.toLowerCase();
  return `Sos parte de OBDient, ${w.reader}. Proponé ${NEXT_QUESTIONS} preguntas o pedidos cortos que el ${who} podría hacerle ahora al asistente.
Primero, sin escribirlo, identificá el tema central: el problema que se está resolviendo (una falla, un código, un módulo, un dato del auto, un viaje), con el inicio, el resumen y los últimos turnos, no solo con la última línea.
Reglas:
- Las ${NEXT_QUESTIONS} siguen ese tema central: el paso siguiente natural, profundizar lo último que se midió, o confirmar o descartar lo que quedó abierto.
- Usá los datos concretos de la conversación (códigos, módulos, direcciones, valores, lugares) en vez de preguntas genéricas.
- No traigas temas que no aparecieron en la conversación.
- Si el último intercambio fue un desvío corto (dólar, clima, una charla) y antes había un tema abierto, al menos una vuelve a ese tema.
- Una por línea, sin números, guiones ni comillas.
- En primera persona del ${who}, español rioplatense con voseo (${w.examples}).
- Menos de 8 palabras cada una.
- Que sean distintas entre sí y no repitan lo que ya se preguntó o respondió.
- Si OBDient terminó con una pregunta al ${who}, la primera opción es una respuesta corta a esa pregunta ("Sí, dale", "No, es otro").
- Solo cosas que el asistente puede hacer: ${w.scope}`;
}

export interface NextQuestionsContext {
  // What the turns no longer in the history said (the conversation's summary).
  readonly summary?: string | null;
  readonly audience?: Audience;
}

export function nextQuestionsRequest(history: readonly ApiMessage[], ctx: NextQuestionsContext = {}): LlmRequest {
  const audience = ctx.audience ?? 'driver';
  const label = WHO[audience].label;
  const users = history.flatMap((m, i) => (m.role === 'user' ? [i] : []));
  const lastAnswer = lastIndex(history, (m) => m.role === 'assistant' && !!m.content);

  // The recent turns, newest first, while they fit.
  const turns: string[][] = [];
  let used = 0;
  let from = history.length;
  for (let k = users.length - 1; k >= 0 && turns.length < RECENT_TURNS; k--) {
    const lines = turnLines(history.slice(users[k]!, from), users[k]!, lastAnswer, label);
    const size = lines.join('\n').length;
    if (turns.length > 0 && used + size > RECENT_CHARS) break;
    turns.unshift(lines);
    used += size;
    from = users[k]!;
  }

  const parts: string[] = [];
  if (ctx.summary?.trim()) parts.push(`Resumen de lo anterior: ${clip(ctx.summary, SUMMARY_CHARS)}`);
  const first = users[0];
  if (first !== undefined && first < from) parts.push(`${ctx.summary?.trim() ? 'Después del resumen' : 'Inicio de la conversación'}: ${label}: ${clip(textOf(history[first]!.content), OPENING_CHARS)}`);
  parts.push(`Últimos turnos:\n${turns.map((t) => t.join('\n')).join('\n')}`);

  return {
    messages: [
      { role: 'system', content: instructions(audience) },
      { role: 'user', content: parts.join('\n\n') },
    ],
    tools: [],
    toolChoice: 'none',
    maxTokens: MAX_TOKENS,
    thinking: false,
  };
}

// One turn as plain lines: what was asked, what the tools were asked and gave, what was answered.
function turnLines(turn: readonly ApiMessage[], offset: number, lastAnswer: number, label: string): string[] {
  return turn.flatMap((m, i) => {
    if (m.role === 'user') return [`${label}: ${clip(textOf(m.content), MESSAGE_CHARS)}`];
    if (m.role === 'tool') return [`(dio: ${clip(resultOf(m.content), TOOL_RESULT_CHARS)})`];
    if (m.role === 'assistant') {
      const calls = (m.tool_calls ?? []).map((c) => callText(c.function.name, c.function.arguments));
      const max = offset + i === lastAnswer ? LAST_ANSWER_CHARS : MESSAGE_CHARS;
      return [...(calls.length ? [`(OBDient usó: ${calls.join(', ')})`] : []), ...(m.content ? [`OBDient: ${clip(m.content, max)}`] : [])];
    }
    return [];
  });
}

function callText(name: string, args: string): string {
  const a = args.replace(/\s+/g, ' ').trim();
  return a && a !== '{}' ? `${name} ${clip(a, TOOL_ARGS_CHARS)}` : name;
}

// The tool's data without the wrapper the model gets ({"result": …}).
function resultOf(content: ApiMessage['content']): string {
  const t = textOf(content);
  const m = /^\{"result":([\s\S]*)\}$/.exec(t) ?? /^\{"error":([\s\S]*)\}$/.exec(t);
  return m ? m[1]! : t;
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

function clip(text: string, max: number): string {
  const t = text.replace(/\n*\[estado:[^\]]*\]\s*$/, '').replace(CAR_BLOCKS, '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
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
