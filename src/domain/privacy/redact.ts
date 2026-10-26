// What leaves the phone, or is shown to anyone but the owner, does not carry the
// car's identity (ADR-0011). The owner sees the full VIN on their own screen;
// every export, share, model prompt and shared-lab upload goes through here.
//
// The VIN names one car, and with the account its owner. Its first 11 characters
// say what the car is (maker, model line, engine, year, plant) and are enough for
// the lab; the last 6 are the serial of that one car and are what is hidden.
//
// A VIN reaches a text in three forms, and all three are covered:
//   - written ("8AGEA76C0RR000043"),
//   - as the reply bytes ("49 02 01 38 41 47 …", spaced or not),
//   - as its serial bytes alone inside a frame dump ("30 30 30 30 34 33"), once
//     the VIN is known from one of the other two or from `knownVins`.
// A serial split across two frames of a multi-frame dump is not found by itself.

export const VIN_MASK = '••••••';

const VIN_CHARS = '[A-HJ-NPR-Z0-9]';
const VIN_WORD = new RegExp(`(?<![A-Z0-9])(?=${VIN_CHARS}*\\d)(?=${VIN_CHARS}*[A-HJ-NPR-Z])${VIN_CHARS}{17}(?![A-Z0-9])`, 'gi');
// Mode 09 PID 02 reply (49 02 01 + 17 bytes) and UDS DID F190 reply (62 F1 90 + 17 bytes).
const VIN_REPLY = /(?<![0-9A-F])(?:49 ?02 ?01|62 ?F1 ?90)((?: ?[0-9A-F]{2}){17})(?![0-9A-F])/gi;
const MAC = /(?<![0-9A-F:])[0-9A-F]{2}(?::[0-9A-F]{2}){5}(?![0-9A-F:])/gi;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const COORDS = /(-?\d{1,3}\.\d{3,})\s*[,;]\s*(-?\d{1,3}\.\d{3,})/g;

// 8AGEA76C0RR000043 → 8AGEA76C0RR••••••
export function maskVin(vin: string): string {
  const v = vin.trim();
  return v.length === 17 ? `${v.slice(0, 11)}${VIN_MASK}` : VIN_MASK;
}

// The ASCII bytes of a reply as a VIN, or null when they are not one.
export function vinFromBytes(bytes: readonly number[]): string | null {
  const s = String.fromCharCode(...bytes);
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(s) ? s : null;
}

// The VIN in the raw lines of a Mode 09 PID 02 answer as the adapter framed it
// ("014", "0:490201384147", "1:…"), when the frame reader could not assemble it.
export function vinFromRaw(raw: readonly string[]): string | null {
  const hex = raw
    .flatMap((r) => r.split('\n'))
    .map((l) => l.trim().replace(/(?:^|\s)[0-9A-F]:\s*/gi, ' ').replace(/^[0-9A-F]{3}(?=\s|$)/i, ''))
    .join('')
    .replace(/[^0-9A-F]/gi, '');
  const at = hex.toUpperCase().indexOf('490201');
  if (at < 0) return null;
  const bytes = hex.slice(at + 6, at + 6 + 34);
  return bytes.length === 34 ? vinFromBytes((bytes.match(/../g) ?? []).map((h) => parseInt(h, 16))) : null;
}

const pairs = (text: string): string[] => text.match(/[0-9A-F]{2}/gi) ?? [];
const hexOf = (s: string): string[] => [...s].map((c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));

// The same text with every VIN hidden but its first 11 characters, and with the
// owner's other traces (adapter MAC, e-mail, a precise position) blurred.
// `knownVins` are VINs the caller has: their serial is also found inside hex dumps.
export function redactText(text: string, knownVins: readonly string[] = []): string {
  const vins = new Set(knownVins.map((v) => v.toUpperCase()).filter((v) => v.length === 17));
  for (const m of text.matchAll(VIN_WORD)) vins.add(m[0].toUpperCase());
  for (const m of text.matchAll(VIN_REPLY)) {
    const vin = vinFromBytes(pairs(m[1]!).map((h) => parseInt(h, 16)));
    if (vin) vins.add(vin);
  }

  let out = text.replace(VIN_WORD, (v) => maskVin(v));
  // The last 6 bytes of every VIN reply, even when the VIN itself is not valid.
  out = out.replace(VIN_REPLY, (whole, bytes: string) => {
    const all = pairs(bytes).length;
    let seen = 0;
    const masked = bytes.replace(/[0-9A-F]{2}/gi, (b) => (++seen > all - 6 ? '**' : b));
    return whole.slice(0, whole.length - bytes.length) + masked;
  });
  // The serial of a known VIN wherever its bytes appear (a frame dump). No
  // boundary check: unspaced, it follows the byte before it ("…52303030303433").
  for (const vin of vins) {
    const serial = new RegExp(hexOf(vin.slice(11)).join(' ?'), 'gi');
    out = out.replace(serial, (m) => m.replace(/[0-9A-F]{2}/gi, '**'));
  }
  return out
    .replace(MAC, '[MAC]')
    .replace(EMAIL, '[correo]')
    .replace(COORDS, (_, lat: string, lng: string) => `${Number(lat).toFixed(2)}, ${Number(lng).toFixed(2)}`);
}

// A position to ~1 km: enough for "near here", not to find a house.
export const coarseCoord = (n: number): number => Math.round(n * 100) / 100;
