// The phrase router (M4): a fixed list of phrases the app answers by itself,
// without the model. Today it answers when the assistant cannot be reached;
// voice (M5–M6) will run it first for commands like "silencio".
//
// Ported from OBDient's chat-commands.ts, with its rule: narrow on purpose. A
// phrase wrongly taken as a command is a question that never got answered, so
// every pattern asks for a verb plus its object, or a term with no other
// meaning in a conversation about a car ("vtv", "freeze frame"). Anything else
// is null and becomes a note for the assistant.

import type { ToolCall } from './tools';

export type PhraseIntent = 'codes' | 'battery' | 'readiness' | 'freeze_frame' | 'vehicle_info' | 'route_status' | 'stop_navigation';

const PHRASES: readonly { readonly intent: PhraseIntent; readonly pattern: RegExp }[] = [
  {
    intent: 'codes',
    pattern:
      /^(?:codigos?|dtcs?)\??$|\b(?:lee|leer|leeme|lei|mira|mirame|fijate|revisa|revisame|tengo|hay|tiene|que)\b.{0,20}\b(?:codigos?|dtcs?)\b|\bcodigos? de (?:falla|error)\b/,
  },
  {
    intent: 'battery',
    pattern:
      /^(?:bateria|tension|voltaje)\??$|\b(?:medi|medime|mide|medir|revisa|revisame|chequea|chequeame|proba|probar|como esta|cuanto tiene|cuanta|cuanto da)\b.{0,16}\b(?:bateria|tension|voltaje)\b/,
  },
  { intent: 'readiness', pattern: /\b(?:vtv|monitores?|readiness)\b/ },
  { intent: 'freeze_frame', pattern: /\bfreeze ?frame\b|\bcuadro congelado\b/ },
  { intent: 'vehicle_info', pattern: /\b(?:vin|numero de chasis)\b/ },
  {
    intent: 'route_status',
    pattern: /\bcuanto (?:me |nos )?(?:falta|queda)\b|\ba que hora (?:llego|llegamos)\b|\bhora de llegada\b/,
  },
  {
    intent: 'stop_navigation',
    pattern: /\b(?:termina|terminar|cancela|cancelar|para|parar|frena|frenar|detene|detener|corta|cortar)\b.{0,12}\b(?:navegacion|ruta|guia)\b/,
  },
];

// What each intent runs.
export const INTENT_CALL: Readonly<Record<PhraseIntent, ToolCall>> = {
  codes: { name: 'read_dtcs', kind: 'stored' },
  battery: { name: 'read_pids', pids: ['VOLTAGE'] },
  readiness: { name: 'read_readiness' },
  freeze_frame: { name: 'read_freeze_frame' },
  vehicle_info: { name: 'read_vehicle_info' },
  route_status: { name: 'route_status' },
  stop_navigation: { name: 'stop_navigation' },
};

export function normalise(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[¿¡]/g, '')
    .replace(/\s+/g, ' ');
}

export function routePhrase(text: string): PhraseIntent | null {
  const norm = normalise(text);
  if (!norm) return null;
  for (const { intent, pattern } of PHRASES) {
    if (pattern.test(norm)) return intent;
  }
  return null;
}

// "Leé las notas", "pasale las notas al asistente": the driver asks for the
// notes taken offline. The screen sends them, as with its button.
const NOTES = /\b(?:lee|leer|leelas|lei|pasale|pasales|pasa|pasar|manda|mandale|mandar|envia|enviale|enviar|revisa|revisar|revisalas|mira|mirar|ver)\b.{0,16}\bnotas?\b/;

export const asksForNotes = (text: string): boolean => NOTES.test(normalise(text));

// A greeting or a thanks on its own: answered, never kept as a note.
const SMALL_TALK = /^(?:hola|holi|buenas|buen dia|buenos dias|buenas tardes|buenas noches|gracias|muchas gracias|chau|ok|okey|dale|genial|perfecto)(?: [a-z]+){0,2}[!.]*$/;

export const isSmallTalk = (text: string): boolean => SMALL_TALK.test(normalise(text));

// Voice control (M5), checked before anything else, online or not: a short
// message that is only the order. "Silencio" must act at once, without waiting
// for the model; longer or other ways of saying it reach set_audio.
const MUTE = /^(?:silencio|shh+|callate|calla|cerra la boca|basta|no hables|sin voz|mute|silencia(?:r|te)?(?: la voz)?)(?: por favor| porfa)?[!.]*$/;
const UNMUTE = /^(?:habla|hablame|volve a hablar|activa la voz|con voz|voz|prende la voz|activa el sonido)(?: de nuevo| otra vez)?(?: por favor| porfa)?[!.]*$/;

export function routeVoiceControl(text: string): 'mute' | 'unmute' | null {
  const norm = normalise(text);
  if (MUTE.test(norm)) return 'mute';
  if (UNMUTE.test(norm)) return 'unmute';
  return null;
}
