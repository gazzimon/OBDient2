import { angleDiffDeg, bearingDeg, destination, distanceM, fromEnu, toEnu } from '@/domain/geo/geo';

const BA = { lat: -34.6037, lng: -58.3816 }; // Buenos Aires, Obelisco

describe('geo', () => {
  it('measures ~111 km per degree of latitude', () => {
    expect(distanceM(BA, { lat: BA.lat + 1, lng: BA.lng })).toBeCloseTo(111_195, -2);
  });

  it('round-trips destination → distance/bearing', () => {
    const p = destination(BA, 37, 250);
    expect(distanceM(BA, p)).toBeCloseTo(250, 3);
    expect(bearingDeg(BA, p)).toBeCloseTo(37, 3);
  });

  it('round-trips ENU within centimetres at 500 m', () => {
    const p = destination(BA, 120, 500);
    const back = fromEnu(BA, toEnu(BA, p));
    expect(distanceM(p, back)).toBeLessThan(0.05);
  });

  it('ENU axes point east and north', () => {
    const e = toEnu(BA, destination(BA, 90, 100));
    expect(e.east).toBeCloseTo(100, 1);
    expect(Math.abs(e.north)).toBeLessThan(0.1);
  });

  it('takes the short way around the circle', () => {
    expect(angleDiffDeg(10, 350)).toBeCloseTo(20);
    expect(angleDiffDeg(350, 10)).toBeCloseTo(-20);
  });
});
