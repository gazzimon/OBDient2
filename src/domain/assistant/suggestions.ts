// Suggested next questions under the chat (buttons, like the examples at the
// start). Fixed rules on what just happened, no model: instant, and they work
// offline.
//
// - Three suggestions, drawn at random from what fits the moment, so they
//   change from one answer to the next. The screen adds a fourth, fixed button
//   to set a destination.
// - With the assistant reachable, at least one is a question for the model
//   alone ("¿Qué reviso primero?"), no tools needed.
// - Offline, only phrases the phrase router answers by itself.
// - Without the adapter, nothing that needs the car.

import { routePhrase } from './phrase-router';

export const SUGGESTIONS_SHOWN = 3;

export interface SuggestionContext {
  // Tools the last turn ran, with their one-line result ("Códigos guardados: P0301").
  readonly lastTools: readonly { readonly name: string; readonly detail: string | null }[];
  readonly connected: boolean;
  readonly online: boolean;
  readonly navigating: boolean;
  // What the driver just asked, never suggested back.
  readonly lastQuestion?: string | null;
}

type Kind = 'car' | 'nav' | 'text';
interface Suggestion {
  readonly text: string;
  readonly kind: Kind;
}

const car = (text: string): Suggestion => ({ text, kind: 'car' });
const nav = (text: string): Suggestion => ({ text, kind: 'nav' });
const text = (t: string): Suggestion => ({ text: t, kind: 'text' });

const GENERAL: readonly Suggestion[] = [
  car('¿Tengo códigos de falla?'),
  car('¿Cómo está la batería?'),
  car('¿Los monitores están listos para la VTV?'),
  car('Mirá el ralentí durante 10 segundos'),
  car('¿Qué datos da mi adaptador?'),
  text('¿Cada cuánto cambio el aceite?'),
  text('¿Qué significa la luz de check engine?'),
  text('¿Qué presión llevan las cubiertas?'),
  text('Consejos para gastar menos nafta'),
];

const WITH_CODES: readonly Suggestion[] = [
  car('Mostrame el freeze frame'),
  car('¿Los monitores están listos para la VTV?'),
  text('¿Qué reviso primero?'),
  text('¿Es grave seguir manejando?'),
  text('¿Cuánto puede costar arreglarlo?'),
];

const NO_CODES: readonly Suggestion[] = [
  car('¿Cómo está la batería?'),
  car('¿Los monitores están listos para la VTV?'),
  car('Mirá el ralentí durante 10 segundos'),
  text('¿Qué conviene revisar en un service?'),
];

const AFTER_LIVE: readonly Suggestion[] = [
  car('¿Tengo códigos de falla?'),
  car('Mirá el ralentí durante 10 segundos'),
  text('¿Esos valores son normales?'),
  text('¿Qué tensión es normal en la batería?'),
];

// Not a question: the fixed button opens the Ruta tab after a destination is shown.
export const SEE_ON_MAP = 'Ver en el mapa';
const DESTINATION_SHOWN: readonly Suggestion[] = [nav('Sí, vamos'), text('No, es otro lugar'), nav('¿Cuánto tardo?')];

const NAVIGATING: readonly Suggestion[] = [nav('¿Cuánto falta?'), nav('Terminá la navegación'), car('¿Cómo está la batería?')];

const NO_ADAPTER: readonly Suggestion[] = [text('¿Cómo conecto el adaptador?'), text('¿Qué puede leer el adaptador de mi auto?')];

// Offline: only what the phrase router answers (checked by a test).
export const OFFLINE: readonly Suggestion[] = [
  car('¿Tengo códigos?'),
  car('Medime la batería'),
  car('¿Pasa la VTV?'),
  car('Mostrame el freeze frame'),
  nav('¿Cuánto falta?'),
  nav('Terminá la navegación'),
];

function pool(ctx: SuggestionContext): readonly Suggestion[] {
  if (!ctx.online) return OFFLINE.filter((s) => s.kind !== 'nav' || ctx.navigating);
  const names = ctx.lastTools.map((t) => t.name);
  if (names.includes('set_destination')) return DESTINATION_SHOWN;
  if (ctx.navigating) return [...NAVIGATING, ...GENERAL.filter((s) => s.kind === 'text')];
  const dtcs = ctx.lastTools.find((t) => t.name === 'read_dtcs');
  if (dtcs) return /\b[PCBU][0-9A-F]{4}\b/.test(dtcs.detail ?? '') ? WITH_CODES : NO_CODES;
  if (names.includes('read_pids') || names.includes('sample_pids')) return AFTER_LIVE;
  return ctx.connected ? GENERAL : [...NO_ADAPTER, ...GENERAL];
}

export function suggest(ctx: SuggestionContext, random: () => number = Math.random): string[] {
  const asked = (ctx.lastQuestion ?? '').trim().toLowerCase();
  const usable = pool(ctx).filter((s) => (ctx.connected || s.kind !== 'car') && s.text.toLowerCase() !== asked);
  const shuffled = shuffle(usable, random);
  const picked = shuffled.slice(0, SUGGESTIONS_SHOWN);
  // At least one question for the model alone, when it can be reached.
  if (ctx.online && !picked.some((s) => s.kind === 'text')) {
    const t = shuffled.find((s) => s.kind === 'text');
    if (t) picked[picked.length - 1] = t;
  }
  return picked.map((s) => s.text);
}

// Each phrase offered offline must be one the router knows.
export const offlineSuggestionsRouted = (): boolean => OFFLINE.every((s) => routePhrase(s.text) != null);

function shuffle<T>(list: readonly T[], random: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
