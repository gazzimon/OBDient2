// The assistant's start screen (2026-10-31): what it can do, as six capabilities
// with questions to tap, and a short "Para empezar" row that follows the car's
// state. The app opens here.
//
// - Capabilities, not tools: the user sees "Fallas y diagnóstico", never read_dtcs.
// - A capability the moment cannot serve is shown dimmed with the reason, not
//   hidden: the user learns it exists.
// - Without the model (offline, or no account), only the phrases the app answers
//   by itself work; a phrase marked `offline` must be one the router knows (test).
// - "Borrá los códigos" is never offered here: it is destructive, and belongs
//   after the codes were read.

import { routePhrase } from './phrase-router';
import type { Audience } from './next-questions';

export type CapabilityId = 'faults' | 'live' | 'modules' | 'trip' | 'service' | 'info';

export interface Starter {
  readonly text: string;
  // The phrase router answers it without the model.
  readonly offline?: true;
}

export interface Capability {
  readonly id: CapabilityId;
  readonly title: string;
  // It reads the car: without the adapter it cannot answer.
  readonly needsCar: boolean;
  readonly questions: readonly Starter[];
}

export const CAPABILITIES: readonly Capability[] = [
  {
    id: 'faults',
    title: 'Fallas y diagnóstico',
    needsCar: true,
    questions: [
      { text: '¿Tengo códigos de falla?', offline: true },
      { text: '¿Por qué se prendió el check engine?' },
      { text: 'Mostrame el freeze frame', offline: true },
      { text: '¿Pasa la VTV? Mirá los monitores', offline: true },
      { text: 'Tironea en frío, ¿qué puede ser?' },
      { text: '¿Qué fallas tuvo este auto antes?' },
    ],
  },
  {
    id: 'live',
    title: 'Datos en vivo',
    needsCar: true,
    questions: [
      { text: '¿Cómo está la batería?', offline: true },
      { text: 'Mostrame los datos en vivo', offline: true },
      { text: 'Mirá el ralentí durante 10 segundos' },
      { text: '¿A qué temperatura está el motor?' },
      { text: '¿Cuánto estoy consumiendo ahora?' },
    ],
  },
  {
    id: 'modules',
    title: 'Módulos y laboratorio',
    needsCar: true,
    questions: [
      { text: '¿Qué módulos tiene este auto?' },
      { text: '¿Qué puede leer mi adaptador?' },
      { text: 'Validá los DIDs candidatos de este auto' },
      { text: '¿Qué sabe el laboratorio de este modelo?' },
    ],
  },
  {
    id: 'trip',
    title: 'Viaje y navegación',
    needsCar: false,
    questions: [
      { text: 'Llevame a la estación de servicio más cercana' },
      { text: '¿Dónde estacioné?', offline: true },
      { text: '¿Va a llover en el camino?' },
      { text: '¿Dónde está más barata la nafta?' },
    ],
  },
  {
    id: 'service',
    title: 'Service y mantenimiento',
    needsCar: false,
    questions: [
      { text: 'Anotá que hoy cambié el aceite' },
      { text: '¿Cuándo toca el próximo service?' },
      { text: '¿Qué le hice al auto este año?' },
      { text: '¿Cada cuánto se cambia la correa en este motor?' },
    ],
  },
  {
    id: 'info',
    title: 'Buscar información',
    needsCar: false,
    questions: [
      { text: '¿Cómo se prueba el sensor de posición del pedal?' },
      { text: '¿Cuánto vale mi auto usado?' },
      { text: '¿A cuánto está el dólar hoy?' },
      { text: '¿Qué hablamos la última vez?' },
    ],
  },
];

const ORDER: Record<Audience, readonly CapabilityId[]> = {
  driver: ['faults', 'live', 'trip', 'service', 'info', 'modules'],
  workshop: ['faults', 'modules', 'live', 'service', 'info', 'trip'],
};

export interface StartContext {
  readonly connected: boolean;
  readonly online: boolean;
  readonly signedIn: boolean;
  readonly navigating: boolean;
  // A parking spot is saved.
  readonly parked: boolean;
  // The codes of the last read on this phone (fault history), or null if none.
  readonly lastCodes: readonly string[] | null;
}

// ok: tap sends it · sign-in: it needs the model and there is no account ·
// unavailable: it cannot be answered now.
export type StarterState = 'ok' | 'sign-in' | 'unavailable';

export function starterState(s: Starter, cap: Pick<Capability, 'needsCar'>, ctx: StartContext): StarterState {
  if (cap.needsCar && !ctx.connected) return 'unavailable';
  if (s.offline) return 'ok';
  if (!ctx.online) return 'unavailable';
  return ctx.signedIn ? 'ok' : 'sign-in';
}

export interface CapabilityView {
  readonly capability: Capability;
  // Only the questions that can be tapped now (sending, or asking to sign in).
  readonly questions: readonly { readonly text: string; readonly state: Exclude<StarterState, 'unavailable'> }[];
  // Why it is dimmed; null when it has questions to offer.
  readonly reason: string | null;
}

export function capabilities(audience: Audience, ctx: StartContext): CapabilityView[] {
  return ORDER[audience].map((id) => {
    const capability = CAPABILITIES.find((c) => c.id === id)!;
    const questions = capability.questions.flatMap((q) => {
      const state = starterState(q, capability, ctx);
      return state === 'unavailable' ? [] : [{ text: q.text, state }];
    });
    const reason = questions.length ? null : capability.needsCar && !ctx.connected ? 'Conectá el adaptador' : 'Sin conexión';
    return { capability, questions, reason };
  });
}

// "Para empezar": up to three, from what is going on. `drive` is not a question:
// it goes back to the driving screen.
export type StartItem = { readonly kind: 'ask'; readonly text: string; readonly state: Exclude<StarterState, 'unavailable'> } | { readonly kind: 'drive'; readonly text: string };

export const START_SHOWN = 3;

export function startHere(ctx: StartContext): StartItem[] {
  const out: StartItem[] = [];
  const ask = (text: string, needsCar = false) => {
    const state = starterState({ text, ...(routePhrase(text) ? { offline: true as const } : {}) }, { needsCar }, ctx);
    if (state !== 'unavailable' && !out.some((i) => i.text === text)) out.push({ kind: 'ask', text, state });
  };
  if (ctx.navigating) {
    out.push({ kind: 'drive', text: 'Volver al manejo' });
    ask('¿Cuánto falta?');
  }
  const code = ctx.lastCodes?.[0];
  if (code) ask(`Explicame el ${code}`);
  if (ctx.connected) ask(code ? '¿Tengo códigos de falla?' : 'Diagnosticá el auto', true);
  if (ctx.parked && !ctx.connected) ask('¿Dónde estacioné?');
  if (!ctx.connected) ask('¿Cómo conecto el adaptador?');
  ask('¿Cómo está la batería?', true);
  return out.slice(0, START_SHOWN);
}

// Each phrase marked offline must be one the router answers (checked by a test).
export const offlineStartersRouted = (): boolean => CAPABILITIES.every((c) => c.questions.every((q) => !q.offline || routePhrase(q.text) != null));
