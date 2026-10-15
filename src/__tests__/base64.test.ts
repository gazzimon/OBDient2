import { asciiToBase64, base64ToAscii } from '@/data/adapters/base64';

describe('base64 (ASCII)', () => {
  it.each(['', 'A', 'AB', 'ABC', 'ATZ\r', '0100\r', '22 F1 90\r'])('round-trips %j', (text) => {
    expect(base64ToAscii(asciiToBase64(text))).toBe(text);
  });

  it('matches the standard encoding', () => {
    expect(asciiToBase64('ATZ\r')).toBe('QVRaDQ==');
    expect(asciiToBase64('0100\r')).toBe('MDEwMA0=');
    expect(asciiToBase64('41 00 BE 3F')).toBe('NDEgMDAgQkUgM0Y=');
    expect(base64ToAscii('NDEgMDAgQkUgM0Y=')).toBe('41 00 BE 3F');
  });
});
