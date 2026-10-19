import { offlineSuggestionsRouted, OFFLINE, suggest, SUGGESTIONS_SHOWN, type SuggestionContext } from '@/domain/assistant/suggestions';

const BASE: SuggestionContext = { lastTools: [], connected: true, online: true, navigating: false };
const TEXT_ONLY = ['¿Qué reviso primero?', '¿Es grave seguir manejando?', '¿Cuánto puede costar arreglarlo?'];

// A deterministic "random" sequence.
const seq = (...v: number[]) => {
  let i = 0;
  return () => v[i++ % v.length]!;
};

describe('suggestions', () => {
  it('three, and they change with the draw', () => {
    const a = suggest(BASE, seq(0.1, 0.5, 0.9));
    const b = suggest(BASE, seq(0.9, 0.2, 0.4));
    expect(a).toHaveLength(SUGGESTIONS_SHOWN);
    expect(new Set(a).size).toBe(SUGGESTIONS_SHOWN);
    expect(a).not.toEqual(b);
  });

  it('after codes: about the codes, with a question for the model alone', () => {
    for (let k = 0; k < 20; k++) {
      const s = suggest({ ...BASE, lastTools: [{ name: 'read_dtcs', detail: 'Códigos guardados: P0301' }] }, seq(k / 20, 0.3, 0.7));
      expect(s.some((x) => TEXT_ONLY.includes(x))).toBe(true);
      expect(s).not.toContain('¿Tengo códigos de falla?');
    }
  });

  it('after a destination on the map: confirm or change it', () => {
    const s = suggest({ ...BASE, lastTools: [{ name: 'set_destination', detail: 'En el mapa: X' }] });
    expect(s).toEqual(expect.arrayContaining(['Sí, vamos']));
  });

  it('without the adapter, nothing that needs the car', () => {
    for (let k = 0; k < 20; k++) {
      const s = suggest({ ...BASE, connected: false }, seq(k / 20, 0.6));
      expect(s).not.toContain('¿Cómo está la batería?');
      expect(s).not.toContain('¿Tengo códigos de falla?');
    }
  });

  it('offline: only what the phrase router answers', () => {
    expect(offlineSuggestionsRouted()).toBe(true);
    const offline = OFFLINE.map((o) => o.text);
    for (let k = 0; k < 10; k++) {
      for (const x of suggest({ ...BASE, online: false }, seq(k / 10))) expect(offline).toContain(x);
    }
  });

  it('never suggests back what was just asked', () => {
    for (let k = 0; k < 20; k++) {
      expect(suggest({ ...BASE, lastQuestion: '¿Cómo está la batería?' }, seq(k / 20))).not.toContain('¿Cómo está la batería?');
    }
  });
});
