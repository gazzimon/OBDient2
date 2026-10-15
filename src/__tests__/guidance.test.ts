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
    expect(a.next(turn, 600, 10)).toBe('En 600 m, gira a la izquierda hacia Av. Corrientes');
    expect(a.next(turn, 590, 10)).toBeNull();
    expect(a.next(turn, 150, 10)).toMatch(/^En 150 m/);
    expect(a.next(turn, 20, 10)).toBe('Gira a la izquierda hacia Av. Corrientes');
    expect(a.next(turn, 15, 10)).toBeNull();
  });
});
