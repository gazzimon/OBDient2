// Long conversations (M4): when the oldest turns no longer fit in the model's
// context, the model summarises them and the summary takes their place, so the
// conversation keeps what was said (the car, the codes, what was checked)
// instead of forgetting it.
//
// The summary travels as the first exchange of the history, a user message and
// a short acknowledgement: the system prompt stays the same and cacheable.

import type { ApiMessage, LlmRequest } from '@/domain/ports/llm.port';

export const SUMMARY_MAX_TOKENS = 300;
// Per message, in the text the model summarises.
const MESSAGE_CHARS = 600;

const INSTRUCTIONS = `Resumí esta parte vieja de una conversación entre un conductor y OBDient, su asistente del auto.
Conservá lo que sirva para seguir: el auto, los síntomas que contó, los códigos y valores medidos (con su hora si figura), lo que se revisó o se descartó, lo que quedó pendiente y destinos de navegación.
Escribí en español, en texto plano, en menos de 120 palabras, sin introducción.`;

export const SUMMARY_PREFIX = '[Resumen de lo hablado antes en esta conversación]';
const ACK = 'Entendido.';

export function summaryRequest(previous: string | null, dropped: readonly ApiMessage[]): LlmRequest {
  const transcript = dropped.flatMap(render).join('\n');
  const prior = previous ? `Resumen anterior:\n${previous}\n\nLo que sigue:\n` : '';
  return {
    messages: [
      { role: 'system', content: INSTRUCTIONS },
      { role: 'user', content: `${prior}${transcript}` },
    ],
    tools: [],
    toolChoice: 'none',
    maxTokens: SUMMARY_MAX_TOKENS,
    thinking: false,
  };
}

// The summary as history messages, ahead of the kept turns.
export function summaryMessages(summary: string | null | undefined): ApiMessage[] {
  if (!summary) return [];
  return [
    { role: 'user', content: `${SUMMARY_PREFIX}\n${summary}` },
    { role: 'assistant', content: ACK },
  ];
}

function render(m: ApiMessage): string[] {
  switch (m.role) {
    case 'system':
      return [];
    case 'user': {
      const text = typeof m.content === 'string' ? m.content : m.content.flatMap((p) => (p.type === 'text' ? [p.text] : ['[foto]'])).join(' ');
      return [`Conductor: ${clip(text)}`];
    }
    case 'assistant': {
      const calls = (m.tool_calls ?? []).map((c) => `${c.function.name}(${c.function.arguments})`);
      return [
        ...(m.content ? [`OBDient: ${clip(m.content)}`] : []),
        ...(calls.length ? [`OBDient usó: ${clip(calls.join(', '))}`] : []),
      ];
    }
    case 'tool':
      return [`Resultado: ${clip(m.content)}`];
  }
}

// The state block the app appends to each user message is noise here.
function clip(text: string): string {
  const t = text.replace(/\n*\[estado:[^\]]*\]\s*$/, '').replace(/\s+/g, ' ').trim();
  return t.length > MESSAGE_CHARS ? `${t.slice(0, MESSAGE_CHARS - 1)}…` : t;
}
