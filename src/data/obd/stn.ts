// STN (OBDLink chipset family) detection and the settings it unlocks.
//
// STN chips speak the full ELM327 AT set plus their own ST commands. The
// Starcharm vendor manual is the OBDLink "OBD Family Reference and Programming
// Manual" (rev D, 2020) with the brand removed: STN1110/1170/2100/2120 are
// renamed ARM1110/… and STI is documented as "ARM<id> vX.Y.Z". So both
// prefixes count as STN. Nothing downstream assumes STN: it only unlocks
// faster request styles (see telemetry-poller.ts).

import { CommandTimeoutError, NoDataError } from '@/core/errors/obd.errors';
import type { CommandPort } from '@/data/adapters/protocol-manager';

export interface AdapterIdentity {
  // Raw ATI answer, e.g. "ELM327 v1.4b" (clones lie about the version).
  readonly elm: string;
  // Raw STI answer when the chip is STN-family, e.g. "STN2120 v5.10.3" or
  // "ARM2120 v5.10.3"; else null.
  readonly stn: string | null;
}

const STN_ID = /\b(?:STN|ARM)\s*\d{4}\b/i;

export function isStnId(sti: string | null): boolean {
  return sti != null && STN_ID.test(sti);
}

export async function identifyAdapter(port: CommandPort): Promise<AdapterIdentity> {
  const elm = await quiet(port, 'ATI');
  const sti = await quiet(port, 'STI');
  return { elm: elm ?? '', stn: isStnId(sti) ? sti!.trim() : null };
}

// Settings applied after the protocol is up:
//   ATS0  – no spaces in replies: ~30 % fewer bytes over BLE (parsers accept both)
//   ATAT2 – aggressive adaptive timing; real STN firmware handles it well, on
//           unknown clones the milder ATAT1 is the safe default.
export async function applyFastSettings(port: CommandPort, identity: AdapterIdentity): Promise<void> {
  await quiet(port, 'ATS0');
  await quiet(port, identity.stn ? 'ATAT2' : 'ATAT1');
}

// Sends a command whose failure is acceptable ("?" = not supported by this
// chip). Returns null instead of throwing, except when the link itself fails.
export async function quiet(port: CommandPort, command: string, timeoutMs = 2000): Promise<string | null> {
  try {
    const res = await port.send(command, timeoutMs);
    return res.trim() === '?' ? null : res;
  } catch (err) {
    if (err instanceof NoDataError || err instanceof CommandTimeoutError) return null;
    throw err;
  }
}
