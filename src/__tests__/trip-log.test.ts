import { TripLogBuffer, parseTripLog } from '@/domain/recording/trip-log';

describe('TripLogBuffer', () => {
  it('writes one JSON object per line and round-trips', () => {
    const b = new TripLogBuffer();
    b.push({ k: 'gps', t: 1000, lat: -34.6037123456, lng: -58.3816, acc: 4.56789, crs: null, spd: 12.3456 });
    b.push({ k: 'obd', t: 1010, kmh: 44 });
    const text = b.drain();
    expect(text.split('\n').filter(Boolean)).toHaveLength(2);
    const [gps, obd] = parseTripLog(text);
    expect(gps).toEqual({ k: 'gps', t: 1000, lat: -34.6037123, lng: -58.3816, acc: 4.568, crs: null, spd: 12.346 });
    expect(obd).toEqual({ k: 'obd', t: 1010, kmh: 44 });
    expect(b.drain()).toBe('');
  });

  it('keeps raw inputs at full rate but thins fused state to 10 Hz', () => {
    const b = new TripLogBuffer();
    let imu = 0;
    let st = 0;
    for (let t = 0; t < 1000; t += 20) {
      if (b.push({ k: 'imu', t, a: [0, 0, 9.8], g: [0, 0, 0] })) imu++;
      if (
        b.push({ k: 'st', t, lat: 0, lng: 0, hdg: 0, hv: true, spd: 0, src: 'gps', al: 0, yr: 0, p: 0, r: 0 })
      )
        st++;
    }
    expect(imu).toBe(50);
    expect(st).toBe(10);
  });

  it('skips a half-written last line left by a crash', () => {
    const text = '{"k":"obd","t":1,"kmh":10}\n{"k":"obd","t":2,"km';
    expect(parseTripLog(text)).toHaveLength(1);
  });
});
