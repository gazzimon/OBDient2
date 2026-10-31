// A read answer as the app shows it: frames assembled, and the text in it when
// it is text (part numbers, the VIN). Used by scan_modules and obd_command.

import { readMessages, type EcuMessage } from '@/core/utils/obdFrames';

// A module's identify answer as a person reads it: the part number's text
// ("04E906032AB"), else the assembled bytes; never the raw frames, which the
// 2026-10-28 scan showed as "7E8100E62F187…". A cut answer says so.
export function identifyText(raw: string, can: boolean): string {
  const m = frameMessages(raw, can).find((x) => x.bytes.startsWith('62'));
  if (!m) return raw;
  return `${m.text ?? m.bytes}${m.complete ? '' : ' (incompleta)'}`;
}

// The answers in a reply, assembled: [{ ecu, bytes: "62 F1 90 38 41…", complete, text? }].
// `text`: the ASCII after "62 DID DID" (a read-DID answer) or "49 02 01" (the VIN).
export function frameMessages(raw: string, can: boolean): { ecu: string | null; bytes: string; complete: boolean; text?: string }[] {
  let messages: EcuMessage[];
  try {
    messages = readMessages(raw, { headers: true, can });
  } catch {
    return [];
  }
  return messages
    .filter((m) => m.bytes.length > 0)
    .map((m) => {
      const hex = m.bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0'));
      const data = m.bytes[0] === 0x62 && m.bytes.length > 4 ? m.bytes.slice(3) : m.bytes[0] === 0x49 && m.bytes[1] === 0x02 ? m.bytes.slice(3) : [];
      const text = data.length >= 4 && data.every((b) => b >= 0x20 && b <= 0x7e) ? String.fromCharCode(...data) : null;
      return { ecu: m.ecu, bytes: hex.join(' '), complete: m.complete, ...(text ? { text } : {}) };
    });
}
