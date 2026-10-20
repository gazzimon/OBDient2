import { Announcer, distanceEs, instructionEs, stageFor } from '@/domain/navigation/guidance';
import type { Maneuver } from '@/domain/navigation/route';

const turn: Maneuver = {
  type: 'turn',
  modifier: 'left',
  location: { lat: 0, lng: 0 },
  roadName: 'Av. Corrientes',
  exit: null,
  routeOffsetM: 500,
};

describe('guidance', () => {
  it('words maneuvers in Spanish', () => {
    expect(instructionEs(turn)).toBe('Gira a la izquierda hacia Av. Corrientes');
    expect(instructionEs({ ...turn, type: 'roundabout', exit: 2, modifier: null })).toBe(
      'En la rotonda, toma la segunda salida hacia Av. Corrientes',
    );
  });

  it('rounds spoken distances', () => {
    expect(distanceEs(1240)).toBe('1,2 km');
    expect(distanceEs(180)).toBe('200 m');
    expect(distanceEs(42)).toBe('40 m');
  });

  it('announces earlier at highway speed', () => {
    expect(stageFor(300, 5)).toBe('far');
    expect(stageFor(300, 30)).toBe('near');
  });

  it('speaks each stage once', () => {
    const a = new Announcer();
    expect(a.next(turn, 600, 10, 0)).toBe('En 600 m, gira a la izquierda hacia Av. Corrientes');
    expect(a.next(turn, 590, 10, 1000)).toBeNull();
    expect(a.next(turn, 150, 10, 45_000)).toMatch(/^En 150 m/);
    expect(a.next(turn, 20, 10, 60_000)).toBe('Gira a la izquierda hacia Av. Corrientes');
    expect(a.next(turn, 15, 10, 61_000)).toBeNull();
  });

  it('does not say "near" right after "far" (seen on the road)', () => {
    const a = new Announcer();
    expect(a.next(turn, 250, 10, 0)).toMatch(/^En 250 m/);
    expect(a.next(turn, 200, 10, 1100)).toBeNull();
    expect(a.next(turn, 20, 10, 20_000)).toBe('Gira a la izquierda hacia Av. Corrientes');
  });

  it('leaves the arrival itself to the controller (it was said twice)', () => {
    const a = new Announcer();
    const end: Maneuver = { ...turn, type: 'arrive', modifier: null };
    expect(a.next(end, 300, 10, 0)).toBe('En 300 m, llegarás a tu destino');
    expect(a.next(end, 10, 10, 30_000)).toBeNull();
  });
});
