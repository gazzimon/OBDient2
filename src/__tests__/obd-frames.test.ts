import { answersTo, readMessages, type EcuMessage } from '@/core/utils/obdFrames';

// Examples from the ELM327 datasheet (ELM327DSJ, "Multiline Responses",
// "Multiple PID Requests", "Setting the Headers"), one line per adapter line.
const hex = (s: string) => s.split(' ').map((b) => parseInt(b, 16));
const lines = (...l: string[]) => l.join('\n');
const CAN = { headers: false, can: true };
const CAN_H = { headers: true, can: true };
const VIN = '49 02 01 31 44 34 47 50 30 30 52 35 35 42 31 32 33 34 35 36';
const ascii = (m: EcuMessage) => String.fromCharCode(...m.bytes.slice(3));

describe('readMessages', () => {
  it('CAN without headers: the VIN as length line and segments', () => {
    const out = readMessages(lines('014', '0: 49 02 01 31 44 34', '1: 47 50 30 30 52 35 35', '2: 42 31 32 33 34 35 36'), CAN);
    expect(out).toEqual([{ ecu: null, bytes: hex(VIN), complete: true }]);
    expect(ascii(out[0]!)).toBe('1D4GP00R55B123456');
  });

  it('the same with spaces off (ATS0)', () => {
    const out = readMessages(lines('014', '0:490201314434', '1:47503030523535', '2:42313233343536'), CAN);
    expect(out[0]!.bytes).toEqual(hex(VIN));
  });

  it('CAN with headers: first frame and consecutive frames by PCI', () => {
    const out = readMessages(
      lines('7E8 10 14 49 02 01 31 44 34', '7E8 21 47 50 30 30 52 35 35', '7E8 22 42 31 32 33 34 35 36'),
      CAN_H,
    );
    expect(out).toEqual([{ ecu: '7E8', bytes: hex(VIN), complete: true }]);
  });

  it('single frame with headers drops the PCI and the padding', () => {
    expect(readMessages('7E8 06 41 00 BE 3F B8 13 00', CAN_H)).toEqual([
      { ecu: '7E8', bytes: hex('41 00 BE 3F B8 13'), complete: true },
    ]);
    expect(readMessages('7E8064100BE3FB81300', CAN_H)[0]!.bytes).toEqual(hex('41 00 BE 3F B8 13'));
  });

  it('29-bit IDs, spaced or not', () => {
    const spaced = readMessages('18 DA F1 10 03 43 01 71 AA AA AA AA', CAN_H);
    const packed = readMessages('18DAF11003430171AAAAAAAA', CAN_H);
    expect(spaced).toEqual([{ ecu: '18DAF110', bytes: hex('43 01 71'), complete: true }]);
    expect(packed).toEqual(spaced);
  });

  it('two ECUs interleaved with headers: grouped by CAN ID', () => {
    const out = readMessages(
      lines(
        '7E8 10 13 49 04 01 35 36 30',
        '7E8 21 32 38 39 34 39 41 43',
        '7E9 10 13 49 04 01 35 36 30',
        '7E8 22 00 00 00 00 00 00 31',
        '7E9 21 32 38 39 35 34 41 43',
        '7E9 22 00 00 00 00 00 00 00',
      ),
      CAN_H,
    );
    expect(out.map((m) => m.ecu)).toEqual(['7E8', '7E9']);
    expect(out.every((m) => m.complete && m.bytes.length === 0x13)).toBe(true);
    expect(ascii(out[0]!).slice(0, 10)).toBe('56028949AC');
    expect(ascii(out[1]!).slice(0, 10)).toBe('56028954AC');
  });

  it('two ECUs mixed up without headers: rebuilt the same as with headers', () => {
    const noHeaders = readMessages(
      lines(
        '013',
        '0: 49 04 01 35 36 30',
        '1: 32 38 39 34 39 41 43',
        '013',
        '0: 49 04 01 35 36 30',
        '2: 00 00 00 00 00 00 31',
        '1: 32 38 39 35 34 41 43',
        '2: 00 00 00 00 00 00 00',
      ),
      CAN,
    );
    const withHeaders = readMessages(
      lines(
        '7E8 10 13 49 04 01 35 36 30',
        '7E8 21 32 38 39 34 39 41 43',
        '7E9 10 13 49 04 01 35 36 30',
        '7E8 22 00 00 00 00 00 00 31',
        '7E9 21 32 38 39 35 34 41 43',
        '7E9 22 00 00 00 00 00 00 00',
      ),
      CAN_H,
    );
    expect(noHeaders.map((m) => m.bytes)).toEqual(withHeaders.map((m) => m.bytes));
  });

  it('multiple-PID answer: only the declared length counts', () => {
    const out = readMessages(lines('00A', '0: 41 04 3F 05 44 0B', '1: 21 0C 17 B8 00 00 00'), CAN);
    expect(out[0]!.bytes).toEqual(hex('41 04 3F 05 44 0B 21 0C 17 B8'));
  });

  it('a lost consecutive frame marks the message incomplete', () => {
    const out = readMessages(lines('7E8 10 14 49 02 01 31 44 34', '7E8 22 42 31 32 33 34 35 36'), CAN_H);
    expect(out[0]!.complete).toBe(false);
    expect(out[0]!.bytes).toEqual(hex('49 02 01 31 44 34'));
  });

  it('ignores flow control frames and adapter messages between frames', () => {
    const out = readMessages(lines('7E0 30 00 00', 'CAN ERROR', '7E8 03 43 01 71'), CAN_H);
    expect(out).toEqual([{ ecu: '7E8', bytes: hex('43 01 71'), complete: true }]);
  });

  it('J1850 without headers: one message per line', () => {
    const out = readMessages(
      lines('49 02 01 00 00 00 31', '49 02 02 44 34 47 50', '49 02 03 30 30 52 35', '49 02 04 35 42 31 32', '49 02 05 33 34 35 36'),
      { headers: false, can: false },
    );
    expect(out).toHaveLength(5);
    expect(out[1]!.bytes).toEqual(hex('49 02 02 44 34 47 50'));
  });

  it('J1850 with headers: source address as the ECU, checksum dropped', () => {
    const out = readMessages(lines('48 6B 10 41 00 BE 3E B8 11 FA', '48 6B 18 41 00 80 10 80 00 C0'), {
      headers: true,
      can: false,
    });
    expect(out).toEqual([
      { ecu: '10', bytes: hex('41 00 BE 3E B8 11'), complete: true },
      { ecu: '18', bytes: hex('41 00 80 10 80 00'), complete: true },
    ]);
  });
});

describe('answersTo', () => {
  it('separates answers from refusals of the same service', () => {
    const msgs = readMessages(lines('7E8 03 7F 04 22', '7E9 01 44', '7E8 03 43 01 71'), CAN_H);
    expect(answersTo(msgs, 0x04)).toEqual({
      positive: [{ ecu: '7E9', bytes: [0x44], complete: true }],
      negative: [{ ecu: '7E8', code: 0x22 }],
    });
    expect(answersTo(msgs, 0x03).positive).toHaveLength(1);
  });
});
