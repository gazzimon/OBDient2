import { forSpeech, MAX_WAIT_MS, VoiceArbiter, type AlertVoiceLevel, type Speaker } from '@/domain/voice/voice-arbiter';

function setup(opts: { voiceOn?: boolean; level?: AlertVoiceLevel } = {}) {
  const log: string[] = [];
  let done: (() => void) | null = null;
  let t = 0;
  const speaker: Speaker = {
    speak: (text, { rate }, d) => {
      log.push(`say ${text}${rate !== 1 ? ` @${rate}` : ''}`);
      done = d;
    },
    stop: () => {
      log.push('stop');
      done = null;
    },
  };
  const settings = { voiceOn: () => opts.voiceOn ?? true, alertLevel: () => opts.level ?? 'all' };
  const v = new VoiceArbiter(speaker, settings, () => t);
  return {
    v,
    log,
    finish: () => done?.(),
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('voice arbiter', () => {
  it('a critical alert cuts a maneuver; the assistant waits for the maneuver', () => {
    const { v, log, finish } = setup();
    v.say('En 200 metros, doblá a la derecha', 'maneuver');
    v.say('La batería está bien', 'assistant');
    v.say('¡Frena!', 'critical');
    expect(log).toEqual(['say En 200 metros, doblá a la derecha', 'stop', 'say ¡Frena! @1.15']);
    finish();
    expect(log.at(-1)).toBe('say La batería está bien');
  });

  it('the newest of each priority waits; the most important goes first', () => {
    const { v, log, finish } = setup();
    v.say('respuesta 1', 'assistant');
    v.say('respuesta 2', 'assistant');
    v.say('maniobra vieja', 'maneuver');
    v.say('maniobra nueva', 'maneuver');
    expect(log).toEqual(['say respuesta 1', 'stop', 'say maniobra vieja']);
    finish();
    expect(log.at(-1)).toBe('say maniobra nueva');
    finish();
    expect(log.at(-1)).toBe('say respuesta 2');
  });

  it('what waited too long is dropped', () => {
    const { v, log, finish, advance } = setup();
    v.say('alerta', 'alert');
    v.say('maniobra', 'maneuver');
    advance(MAX_WAIT_MS.maneuver + 1);
    finish();
    expect(log).toEqual(['say alerta']);
  });

  it('muted: only critical alerts speak, and what was talking stops', () => {
    const { v, log, finish } = setup();
    v.say('respuesta larga', 'assistant');
    v.setMuted(true);
    expect(log).toEqual(['say respuesta larga', 'stop']);
    v.say('maniobra', 'maneuver');
    v.say('auto adelante', 'alert');
    v.say('¡Frena!', 'critical');
    expect(log.at(-1)).toBe('say ¡Frena! @1.15');
    finish();
    v.setMuted(false);
    v.say('maniobra', 'maneuver');
    expect(log.at(-1)).toBe('say maniobra');
  });

  it('alert level and the voice switch', () => {
    const critical = setup({ level: 'critical' });
    critical.v.say('auto adelante', 'alert');
    critical.v.say('¡Frena!', 'critical');
    expect(critical.log).toEqual(['say ¡Frena! @1.15']);

    const off = setup({ level: 'off' });
    off.v.say('¡Frena!', 'critical');
    off.v.say('maniobra', 'maneuver');
    expect(off.log).toEqual(['say maniobra']);

    const silent = setup({ voiceOn: false });
    silent.v.say('¡Frena!', 'critical');
    expect(silent.log).toEqual([]);
  });

  it('tells listeners when muted changes, and stopAll clears everything', () => {
    const { v, log } = setup();
    const seen: string[] = [];
    const off = v.onMuted((m) => seen.push(m));
    v.setMuted(true);
    v.setMuted(true);
    off();
    v.setMuted(false);
    expect(seen).toEqual(['silent']);
    v.say('a', 'assistant');
    v.say('b', 'assistant');
    v.stopAll();
    expect(log.at(-1)).toBe('stop');
  });
});

describe('forSpeech', () => {
  it('reads lists as sentences and keeps it short', () => {
    expect(forSpeech('Revisá esto:\n- la bujía\n- el cable')).toBe('Revisá esto: la bujía. el cable');
    const long = 'Una frase corta. '.repeat(40);
    expect(forSpeech(long, 100).length).toBeLessThanOrEqual(100);
    expect(forSpeech(long, 100).endsWith('.')).toBe(true);
  });

  it('"only alerts" keeps alerts and drops guidance and the assistant', () => {
    const spoken: string[] = [];
    const v = new VoiceArbiter(
      { speak: (t, _o, done) => { spoken.push(t); done(); }, stop: () => {} },
      { voiceOn: () => true, alertLevel: () => 'all' },
    );
    v.setMode('alerts');
    v.say('girá a la derecha', 'maneuver');
    v.say('la batería está bien', 'assistant');
    v.say('peatón adelante', 'alert');
    expect(spoken).toEqual(['peatón adelante']);
    expect(v.isMuted()).toBe(false);
  });
});
