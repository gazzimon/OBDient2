// STN (OBDLink chipset family) detection.
//
// STN chips speak the full ELM327 AT set plus their own ST commands. The
// Starcharm B33 is sold as STN-compatible — UNVERIFIED until it answers here.
// Nothing downstream assumes STN: it only unlocks faster settings.

import { CommandTimeoutError, NoDataError } from '@/core/errors/obd.errors';
import type { CommandPort } from '@/data/adapters/protocol-manager';

export interface AdapterIdentity {
  // Raw ATI answer, e.g. "ELM327 v1.5" (clones lie about the version).
  readonly elm: string;
  // Raw STI answer when the chip is STN, e.g. "STN2120 r5.10.3"; else null.
  readonly stn: string | null;
}

const STN_ID = /\bSTN\s*\d{4}/i;

export async function identifyAdapter(port: CommandPort): Promise<AdapterIdentity> {
  const elm = await quiet(port, 'ATI');
  const sti = await quiet(port, 'STI');
  return { elm: elm ?? '', stn: sti != null && STN_ID.test(sti) ? sti.trim() : null };
}

// Adaptive timing: ATAT2 lets the adapter shorten its wait for ECU replies
// aggressively. Real STN firmware handles it well; on unknown clones the
// milder ATAT1 is the safe default.
export async function applyFastTiming(port: CommandPort, identity: AdapterIdentity): Promise<void> {
  await quiet(port, identity.stn ? 'ATAT2' : 'ATAT1');
}

async function quiet(port: CommandPort, command: string): Promise<string | null> {
  try {
    const res = await port.send(command, 2000);
    return res.trim() === '?' ? null : res;
  } catch (err) {
    if (err instanceof NoDataError || err instanceof CommandTimeoutError) return null;
    throw err;
  }
}
