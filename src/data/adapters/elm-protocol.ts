// ELM327/STN protocol numbers (ATSP) and ATDP parsing.
//
//   1 J1850 PWM   2 J1850 VPW   3 ISO 9141-2   4 KWP 5-baud   5 KWP fast
//   6 CAN 11/500  7 CAN 29/500  8 CAN 11/250   9 CAN 29/250   A J1939 (CAN 29/250)

import type { OBDProtocol } from '@/domain/entities/vehicle';

const CODE_BY_PROTOCOL: Partial<Record<OBDProtocol, string>> = {
  AUTO: '0',
  SAE_J1850_PWM: '1',
  SAE_J1850_VPW: '2',
  ISO_9141_2: '3',
  ISO_14230_4_KWP: '4',
  ISO_14230_4_KWP_FAST: '5',
  ISO_15765_4_CAN_11BIT_500K: '6',
  ISO_15765_4_CAN_29BIT_500K: '7',
  ISO_15765_4_CAN_11BIT_250K: '8',
  ISO_15765_4_CAN_29BIT_250K: '9',
  SAE_J1939: 'A',
};

export function atspCode(protocol: OBDProtocol): string {
  const code = CODE_BY_PROTOCOL[protocol];
  if (!code) throw new Error(`No ATSP code for protocol ${protocol}`);
  return code;
}

export function isCan(protocol: OBDProtocol): boolean {
  return protocol.startsWith('ISO_15765_4_CAN') || protocol === 'SAE_J1939';
}

// K-Line and J1850 buses need seconds to initialise; CAN answers immediately.
export function isSlowInit(protocol: OBDProtocol): boolean {
  return !isCan(protocol) && protocol !== 'AUTO' && protocol !== 'UNKNOWN';
}

// Parses an ATDP response such as "ISO 15765-4 (CAN 11/500)" or
// "AUTO, SAE J1939 (CAN 29/250)".
export function parseAtdp(response: string): OBDProtocol {
  const upper = response.toUpperCase().replace(/^AUTO,?\s*/, '');
  if (upper.includes('J1939')) return 'SAE_J1939';
  const can = /CAN\s*(11|29)\s*\/\s*(250|500)/.exec(upper);
  if (can) {
    const bits = can[1] === '29' ? '29BIT' : '11BIT';
    return `ISO_15765_4_CAN_${bits}_${can[2]}K` as OBDProtocol;
  }
  if (upper.includes('14230')) {
    return upper.includes('FAST') ? 'ISO_14230_4_KWP_FAST' : 'ISO_14230_4_KWP';
  }
  if (upper.includes('9141')) return 'ISO_9141_2';
  if (upper.includes('J1850')) return upper.includes('PWM') ? 'SAE_J1850_PWM' : 'SAE_J1850_VPW';
  if (upper === '' || upper.startsWith('AUTO') || upper.includes('SEARCHING')) return 'AUTO';
  return 'UNKNOWN';
}
