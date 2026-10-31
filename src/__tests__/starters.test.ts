import { capabilities, CAPABILITIES, offlineStartersRouted, startHere, starterState, type StartContext } from '@/domain/assistant/starters';

const ctx = (o: Partial<StartContext> = {}): StartContext => ({ connected: true, online: true, signedIn: true, navigating: false, parked: false, lastCodes: null, ...o });

describe('start screen: what the assistant can do', () => {
  it('every phrase offered offline is one the app answers by itself', () => {
    expect(offlineStartersRouted()).toBe(true);
  });

  it('never offers to clear the codes', () => {
    const all = [...CAPABILITIES.flatMap((c) => c.questions.map((q) => q.text)), ...startHere(ctx({ lastCodes: ['P0301'] })).map((i) => i.text)];
    expect(all.some((t) => /borr/i.test(t))).toBe(false);
  });

  it('six capabilities, ordered by who uses the app', () => {
    expect(capabilities('driver', ctx()).map((v) => v.capability.id)).toEqual(['faults', 'live', 'trip', 'service', 'info', 'modules']);
    expect(capabilities('workshop', ctx()).map((v) => v.capability.id)).toEqual(['faults', 'modules', 'live', 'service', 'info', 'trip']);
  });

  it('without the adapter, the car capabilities are dimmed with the reason, not hidden', () => {
    const views = capabilities('driver', ctx({ connected: false }));
    expect(views).toHaveLength(6);
    expect(views.find((v) => v.capability.id === 'faults')).toMatchObject({ questions: [], reason: 'Conectá el adaptador' });
    expect(views.find((v) => v.capability.id === 'trip')!.reason).toBeNull();
  });

  it('offline: only what the app answers by itself; a capability with nothing is "Sin conexión"', () => {
    const views = capabilities('driver', ctx({ online: false }));
    expect(views.find((v) => v.capability.id === 'faults')!.questions.map((q) => q.text)).toEqual(['¿Tengo códigos de falla?', 'Mostrame el freeze frame', '¿Pasa la VTV? Mirá los monitores']);
    expect(views.find((v) => v.capability.id === 'info')).toMatchObject({ questions: [], reason: 'Sin conexión' });
  });

  it('without an account, a question for the model asks to sign in; the app’s own phrases still answer', () => {
    const cap = { needsCar: true };
    expect(starterState({ text: '¿Tengo códigos de falla?', offline: true }, cap, ctx({ signedIn: false }))).toBe('ok');
    expect(starterState({ text: '¿Por qué se prendió el check engine?' }, cap, ctx({ signedIn: false }))).toBe('sign-in');
  });
});

describe('"Para empezar" follows the car', () => {
  it('navigating: back to driving first, then how far', () => {
    expect(startHere(ctx({ navigating: true })).slice(0, 2)).toEqual([
      { kind: 'drive', text: 'Volver al manejo' },
      { kind: 'ask', text: '¿Cuánto falta?', state: 'ok' },
    ]);
  });

  it('codes on record: explain the first one', () => {
    expect(startHere(ctx({ lastCodes: ['P2122', 'U0155'] }))[0]).toEqual({ kind: 'ask', text: 'Explicame el P2122', state: 'ok' });
  });

  it('connected and nothing read yet: a full check', () => {
    expect(startHere(ctx()).map((i) => i.text)).toContain('Diagnosticá el auto');
  });

  it('the car was left somewhere and the adapter is gone: where it is', () => {
    expect(startHere(ctx({ connected: false, parked: true })).map((i) => i.text)).toEqual(['¿Dónde estacioné?', '¿Cómo conecto el adaptador?']);
  });

  it('at most three, nothing that cannot be answered', () => {
    const out = startHere(ctx({ navigating: true, lastCodes: ['P0301'], online: false }));
    expect(out.length).toBeLessThanOrEqual(3);
    expect(out.map((i) => i.text)).not.toContain('Explicame el P0301');
  });
});
