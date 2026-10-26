import { coarseCoord, maskVin, redactText, vinFromBytes, VIN_MASK } from '@/domain/privacy/redact';

const VIN = '8AGEA76C0RR000043';
const SERIAL_HEX = '30 30 30 30 34 33';

// The capture of the 2026-10-21 chat, the 09 02 part, as the app shared it.
const CAPTURE = `> 0902 (77 ms)
  014
  0:490201384147
  1:45413736433052
  2:52303030303433
  = ECU ?: 49 02 01 38 41 47 45 41 37 36 43 30 52 52 30 30 30 30 34 33
> ATDP (36 ms)
  AUTO, ISO 15765-4 (CAN 29/500)

== Con encabezados (ATH1) ==
> 0902 (77 ms)
  18DAF1111014490201384147
  18DAF1112145413736433052
  18DAF1112252303030303433
  = 18DAF111: 49 02 01 38 41 47 45 41 37 36 43 30 52 52 30 30 30 30 34 33`;

describe('maskVin', () => {
  it('keeps what the car is (11 characters) and hides its serial', () => {
    expect(maskVin(VIN)).toBe(`8AGEA76C0RR${VIN_MASK}`);
    expect(maskVin(VIN)).not.toContain('000043');
  });

  it('a string that is not a VIN is hidden whole', () => {
    expect(maskVin('1234')).toBe(VIN_MASK);
  });
});

describe('redactText: the VIN in its three forms', () => {
  it('written', () => {
    const out = redactText(`El VIN es ${VIN} y la marca Chevrolet.`);
    expect(out).toBe(`El VIN es 8AGEA76C0RR${VIN_MASK} y la marca Chevrolet.`);
  });

  it('as the reply bytes, spaced or not', () => {
    const spaced = redactText('= ECU ?: 49 02 01 38 41 47 45 41 37 36 43 30 52 52 30 30 30 30 34 33');
    expect(spaced).toBe('= ECU ?: 49 02 01 38 41 47 45 41 37 36 43 30 52 52 ** ** ** ** ** **');
    // Unspaced: 49 02 01, the 11 characters that stay, then the 6 that go.
    expect(redactText('4902013841474541373643305252303030303433')).toBe('4902013841474541373643305252************');
  });

  it('the serial inside a frame dump, once the VIN is known from the same text', () => {
    const out = redactText(CAPTURE);
    // The frame survives, its serial bytes do not.
    expect(out).toContain('2:52************');
    expect(out).toContain('18DAF11122 52'.replace(' ', '') + '************');
    // What says what the car is stays: the first frames are the maker and the model line.
    expect(out).toContain('0:490201384147');
    expect(out).toContain('1:45413736433052');
  });

  it('the serial inside a frame dump when the caller knows the VIN and the text does not show it', () => {
    expect(redactText('2:52303030303433', [VIN])).toBe('2:52************');
  });

  it('a UDS F190 reply too', () => {
    expect(redactText('62 F1 90 38 41 47 45 41 37 36 43 30 52 52 30 30 30 30 34 33')).toContain('52 52 ** ** ** ** ** **');
  });

  it('nothing in a whole capture still has the serial', () => {
    const out = redactText(CAPTURE);
    expect(out).not.toMatch(/000043|303030303433|30 30 30 30 34 33/);
  });
});

describe('redactText: other traces', () => {
  it('adapter MAC and e-mail', () => {
    expect(redactText('OBDII 00:1D:A5:68:98:8B de gazzimon@gmail.com')).toBe('OBDII [MAC] de [correo]');
  });

  it('a precise position is blurred to ~1 km', () => {
    expect(redactText('en -27.3749243, -55.8984652 cerca')).toBe('en -27.37, -55.90 cerca');
  });

  it('plain text, short hex and numbers are left alone', () => {
    const t = '> 0101 (60 ms)\n  41010007E121\n  = 18DAF111: 41 01 00 07 E1 21\nCoolant 87 °C, 12,4 V, 2.500 rpm';
    expect(redactText(t)).toBe(t);
  });

  it('a word with 17 letters or 17 digits is not a VIN', () => {
    expect(redactText('ANTICONSTITUCIONAL y 12345678901234567')).toBe('ANTICONSTITUCIONAL y 12345678901234567');
  });

  it('is idempotent', () => {
    const once = redactText(CAPTURE);
    expect(redactText(once)).toBe(once);
  });
});

describe('vinFromBytes / coarseCoord', () => {
  it('reads the ASCII bytes of a reply', () => {
    expect(vinFromBytes([...VIN].map((c) => c.charCodeAt(0)))).toBe(VIN);
    expect(vinFromBytes([0x38, 0x41])).toBeNull();
  });

  it('rounds a coordinate to 2 decimals', () => {
    expect(coarseCoord(-27.3749243)).toBe(-27.37);
  });
});
