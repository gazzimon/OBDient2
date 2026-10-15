import { atspCode, isCan, isSlowInit, parseAtdp } from '@/data/adapters/elm-protocol';

describe('parseAtdp', () => {
  it.each([
    ['ISO 15765-4 (CAN 11/500)', 'ISO_15765_4_CAN_11BIT_500K'],
    ['ISO 15765-4 (CAN 29/500)', 'ISO_15765_4_CAN_29BIT_500K'],
    ['ISO 15765-4 (CAN 11/250)', 'ISO_15765_4_CAN_11BIT_250K'],
    ['ISO 15765-4 (CAN 29/250)', 'ISO_15765_4_CAN_29BIT_250K'],
    ['AUTO, ISO 15765-4 (CAN 11/500)', 'ISO_15765_4_CAN_11BIT_500K'],
    ['SAE J1939 (CAN 29/250)', 'SAE_J1939'],
    ['AUTO, SAE J1939 (CAN 29/250)', 'SAE_J1939'],
    ['ISO 14230-4 (KWP FAST)', 'ISO_14230_4_KWP_FAST'],
    ['ISO 14230-4 (KWP 5BAUD)', 'ISO_14230_4_KWP'],
    ['ISO 9141-2', 'ISO_9141_2'],
    ['SAE J1850 PWM', 'SAE_J1850_PWM'],
    ['SAE J1850 VPW', 'SAE_J1850_VPW'],
    ['AUTO', 'AUTO'],
    ['', 'AUTO'],
    ['???', 'UNKNOWN'],
  ])('%s -> %s', (input, expected) => {
    expect(parseAtdp(input)).toBe(expected);
  });
});

describe('atspCode', () => {
  it('maps every protocol to its ATSP digit', () => {
    expect(atspCode('SAE_J1850_PWM')).toBe('1');
    expect(atspCode('ISO_14230_4_KWP_FAST')).toBe('5');
    expect(atspCode('ISO_15765_4_CAN_11BIT_500K')).toBe('6');
    expect(atspCode('ISO_15765_4_CAN_29BIT_250K')).toBe('9');
    expect(atspCode('SAE_J1939')).toBe('A');
  });

  it('rejects UNKNOWN', () => {
    expect(() => atspCode('UNKNOWN')).toThrow();
  });

  it('round-trips with parseAtdp for the CAN family', () => {
    expect(parseAtdp('ISO 15765-4 (CAN 29/250)')).toBe('ISO_15765_4_CAN_29BIT_250K');
  });
});

describe('bus classification', () => {
  it('flags CAN and J1939 as fast, legacy buses as slow-init', () => {
    expect(isCan('SAE_J1939')).toBe(true);
    expect(isCan('ISO_9141_2')).toBe(false);
    expect(isSlowInit('ISO_9141_2')).toBe(true);
    expect(isSlowInit('ISO_15765_4_CAN_11BIT_500K')).toBe(false);
    expect(isSlowInit('AUTO')).toBe(false);
  });
});
