import { findValue } from '@/domain/obd/value-search';

// 87654 km on the dashboard, written the ways modules write it.
const KM = 87654;
const encodings = (data: number[], target = KM) => findValue('2203', data, target).map((m) => m.encoding);

describe('findValue: the number the dashboard shows, inside a DID', () => {
  it('a whole number in km, kept once at its narrowest width', () => {
    // 00 01 56 66 = 0x015666: found as 3 bytes, not again as 4 with the leading zero.
    expect(findValue('2203', [0x00, 0x01, 0x56, 0x66], KM)).toEqual([{ did: '2203', encoding: 'entero de 3 bytes, big-endian, en km', offset: 1, value: KM }]);
  });

  it('little-endian, and in tenths of a km', () => {
    expect(encodings([0x66, 0x56, 0x01])).toContain('entero de 3 bytes, little-endian, en km');
    // 876547 = 87654.7 km: the dashboard shows 87654.
    expect(findValue('2203', [0x0d, 0x60, 0x03], KM)).toContainEqual({ did: '2203', encoding: 'entero de 3 bytes, big-endian, en décimas de km', offset: 0, value: 87654.7 });
  });

  it('BCD and text', () => {
    expect(encodings([0xaa, 0x08, 0x76, 0x54])).toContain('BCD de 3 bytes, en km');
    expect(encodings([0x30, 0x38, 0x37, 0x36, 0x35, 0x34])).toContain('texto (6 dígitos), en km');
  });

  it('one km of slack, no more', () => {
    expect(encodings([0x01, 0x56, 0x67])).toHaveLength(1); // 87655
    expect(encodings([0x01, 0x56, 0x68])).toEqual([]); // 87656
  });

  it('nothing in a value that does not hold it, nor in an empty one', () => {
    expect(findValue('2203', [0x2d, 0x2d, 0x2d], KM)).toEqual([]);
    expect(findValue('2203', [], KM)).toEqual([]);
  });
});
