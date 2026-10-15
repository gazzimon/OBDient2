// Brings an ELM327/STN adapter to a known protocol state.
//
// Works against a minimal CommandPort so it is testable with a scripted fake
// and independent of the transport (Bluetooth Classic or BLE).
//
// Headers stay OFF by default: the existing mappers (pid/dtc/vin) assume
// header-less responses. Turn them on explicitly for multi-ECU work.

import {
  CommandTimeoutError,
  NoDataError,
  ProtocolDetectionError,
} from '@/core/errors/obd.errors';
import type { OBDProtocol } from '@/domain/entities/vehicle';
import { atspCode, isSlowInit, parseAtdp } from './elm-protocol';

export interface CommandPort {
  send(command: string, timeoutMs?: number): Promise<string>;
}

export type DetectionMethod = 'forced' | 'auto' | 'scan';

export interface ProtocolInitOptions {
  // Skip auto-detect and use this protocol. 'AUTO' (default) lets the adapter search.
  protocol?: OBDProtocol;
  // Response headers (ATH1). Needed to tell ECUs apart, off for legacy parsers.
  headers?: boolean;
  // When auto-detect fails, also try the slow buses (J1850, ISO 9141, KWP).
  scanLegacy?: boolean;
}

export interface ProtocolInitResult {
  protocol: OBDProtocol;
  method: DetectionMethod;
  atdp: string;
}

const RESET_TIMEOUT_MS = 6000;
const QUICK_TIMEOUT_MS = 4000;
const CAN_PROBE_TIMEOUT_MS = 8000;
const SLOW_PROBE_TIMEOUT_MS = 15000;

// Order tried by the scan: modern CAN first (cheap), then legacy buses.
const SCAN_CAN: readonly OBDProtocol[] = [
  'ISO_15765_4_CAN_11BIT_500K',
  'ISO_15765_4_CAN_29BIT_500K',
  'ISO_15765_4_CAN_11BIT_250K',
  'ISO_15765_4_CAN_29BIT_250K',
];
const SCAN_LEGACY: readonly OBDProtocol[] = [
  'ISO_14230_4_KWP_FAST',
  'ISO_14230_4_KWP',
  'ISO_9141_2',
  'SAE_J1850_PWM',
  'SAE_J1850_VPW',
];

export class ProtocolManager {
  constructor(private readonly port: CommandPort) {}

  async initialize(options: ProtocolInitOptions = {}): Promise<ProtocolInitResult> {
    const { protocol = 'AUTO', headers = false, scanLegacy = false } = options;

    await this.tolerant('ATZ', RESET_TIMEOUT_MS);
    await this.tolerant('ATE0');
    await this.tolerant('ATL0');
    await this.setHeaders(headers);

    if (protocol !== 'AUTO') return this.forceProtocol(protocol);

    await this.tolerant('ATSP0');
    if (await this.probe(CAN_PROBE_TIMEOUT_MS)) {
      const atdp = await this.readAtdp();
      return { protocol: parseAtdp(atdp), method: 'auto', atdp };
    }

    const candidates = scanLegacy ? [...SCAN_CAN, ...SCAN_LEGACY] : SCAN_CAN;
    for (const candidate of candidates) {
      const result = await this.tryForce(candidate);
      if (result) return { ...result, method: 'scan' };
    }
    throw new ProtocolDetectionError(
      `No protocol answered (tried auto + ${candidates.length} forced)`,
    );
  }

  async setHeaders(on: boolean): Promise<void> {
    await this.tolerant(on ? 'ATH1' : 'ATH0');
  }

  // Addresses one ECU: ATSH sets the request header, ATCRA filters replies.
  // `txId` / `rxId` are hex (11-bit: 3 digits, 29-bit: 8 digits).
  async setTarget(txId: string, rxId?: string): Promise<void> {
    await this.port.send(`ATSH${checkHex(txId)}`, QUICK_TIMEOUT_MS);
    if (rxId) await this.port.send(`ATCRA${checkHex(rxId)}`, QUICK_TIMEOUT_MS);
  }

  // Back to functional (broadcast) addressing, with no reply filter.
  async clearTarget(protocol: OBDProtocol): Promise<void> {
    const functional = protocol.includes('29BIT') || protocol === 'SAE_J1939' ? 'DB33F1' : '7DF';
    await this.port.send(`ATSH${functional}`, QUICK_TIMEOUT_MS);
    await this.port.send('ATAR', QUICK_TIMEOUT_MS);
  }

  private async forceProtocol(protocol: OBDProtocol): Promise<ProtocolInitResult> {
    const result = await this.tryForce(protocol);
    if (!result) {
      throw new ProtocolDetectionError(`Forced protocol ${protocol} did not answer`);
    }
    return { ...result, method: 'forced' };
  }

  // ATSP<n> then verify. J1939 has no mode 01, so only ATDP can confirm it.
  private async tryForce(
    protocol: OBDProtocol,
  ): Promise<{ protocol: OBDProtocol; atdp: string } | null> {
    await this.port.send(`ATSP${atspCode(protocol)}`, QUICK_TIMEOUT_MS);
    if (protocol !== 'SAE_J1939') {
      const timeout = isSlowInit(protocol) ? SLOW_PROBE_TIMEOUT_MS : CAN_PROBE_TIMEOUT_MS;
      if (!(await this.probe(timeout))) return null;
    }
    const atdp = await this.readAtdp();
    return { protocol: parseAtdp(atdp) === 'UNKNOWN' ? protocol : parseAtdp(atdp), atdp };
  }

  // Mode 01 PID 00 — every OBD-II ECU must answer it.
  private async probe(timeoutMs: number): Promise<boolean> {
    try {
      const response = await this.port.send('0100', timeoutMs);
      return response.toUpperCase().replace(/\s/g, '').includes('4100');
    } catch (err) {
      if (err instanceof NoDataError || err instanceof CommandTimeoutError) return false;
      throw err;
    }
  }

  private async readAtdp(): Promise<string> {
    try {
      return await this.port.send('ATDP', QUICK_TIMEOUT_MS);
    } catch (err) {
      if (err instanceof NoDataError || err instanceof CommandTimeoutError) return '';
      throw err;
    }
  }

  // Some clones never answer individual AT commands but work anyway.
  private async tolerant(command: string, timeoutMs = QUICK_TIMEOUT_MS): Promise<void> {
    try {
      await this.port.send(command, timeoutMs);
    } catch (err) {
      if (err instanceof NoDataError || err instanceof CommandTimeoutError) return;
      throw err;
    }
  }
}

function checkHex(value: string): string {
  if (!/^[0-9A-Fa-f]{3}$|^[0-9A-Fa-f]{6}$|^[0-9A-Fa-f]{8}$/.test(value)) {
    throw new Error(`Invalid CAN id "${value}" (expected 3, 6 or 8 hex digits)`);
  }
  return value.toUpperCase();
}
