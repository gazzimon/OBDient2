import { followingManeuver, gpsQuality, nextSoundMode, repeatPhrase } from '@/domain/navigation/drive-hud';
import type { Maneuver, Route } from '@/domain/navigation/route';

const m = (routeOffsetM: number, type: Maneuver['type'] = 'turn'): Maneuver => ({
  type,
  modifier: 'right',
  location: { lat: 0, lng: 0 },
  roadName: 'Mitre',
  exit: null,
  routeOffsetM,
});

const route = (maneuvers: Maneuver[]): Route => ({
  geometry: [],
  cumulativeM: [],
  distanceM: 1000,
  durationS: 100,
  maneuvers,
});

describe('followingManeuver', () => {
  it('shows "then" when the next one comes right after', () => {
    const a = m(100);
    const b = m(200);
    expect(followingManeuver(route([a, b]), a)).toBe(b);
  });

  it('hides it when it is far, missing, or after arriving', () => {
    const a = m(100);
    expect(followingManeuver(route([a, m(400)]), a)).toBeNull();
    expect(followingManeuver(route([a]), a)).toBeNull();
    const end = m(900, 'arrive');
    expect(followingManeuver(route([end]), end)).toBeNull();
    expect(followingManeuver(route([a]), null)).toBeNull();
  });
});

describe('repeatPhrase', () => {
  it('says distance and instruction', () => {
    expect(repeatPhrase(m(0), 200)).toBe('En 200 m, gira a la derecha hacia Mitre');
    expect(repeatPhrase(m(0, 'arrive'), 50)).toBe('En 50 m, llegás a tu destino');
  });
});

describe('nextSoundMode', () => {
  it('cycles all → alerts → silent → all', () => {
    expect(nextSoundMode('all')).toBe('alerts');
    expect(nextSoundMode('alerts')).toBe('silent');
    expect(nextSoundMode('silent')).toBe('all');
  });
});

describe('gpsQuality', () => {
  it('grades the fix', () => {
    expect(gpsQuality(null)).toBe('none');
    expect(gpsQuality(Infinity)).toBe('none');
    expect(gpsQuality(8)).toBe('ok');
    expect(gpsQuality(45)).toBe('weak');
  });
});
