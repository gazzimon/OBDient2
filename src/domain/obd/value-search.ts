// Finding a value the car already shows (the odometer on the dashboard) among a
// module's DIDs. The maker's odometer DID is not public (the 2026-10-28 Audi
// search found nothing), so it is looked for the other way round: the person
// reads the km on the dashboard, a sweep reads the DIDs, and this says which
// answers hold that number and how it is written. Left to the model, short
// answers were read as text ("---", "J28") and nothing was found.
//
// Only candidates: a match can be chance. The person confirms by driving a few
// km and reading those DIDs again; the odometer is the one that went up as much.

export interface ValueMatch {
  readonly did: string;
  // How the number is written, in words for the model and the person.
  readonly encoding: string;
  // Where in the DID's data it starts (byte 0 = right after 62 DID DID).
  readonly offset: number;
  // The value read with that encoding, in the person's unit (km).
  readonly value: number;
}

export const FIND_MAX = 9_999_999;
// The dashboard shows whole km and the module keeps more: a stored 87654.7 is
// "87654" on the dashboard, and some round up.
const TOLERANCE = 1;

const SCALES = [
  { factor: 1, unit: 'en km' },
  { factor: 10, unit: 'en décimas de km' },
] as const;
const WIDTHS = [2, 3, 4] as const;

const near = (v: number, target: number) => Math.abs(v - target) <= TOLERANCE;

function uint(data: readonly number[], at: number, width: number, bigEndian: boolean): number {
  let n = 0;
  for (let i = 0; i < width; i++) n = n * 256 + data[bigEndian ? at + i : at + width - 1 - i]!;
  return n;
}

// Packed BCD (0x08 0x76 0x54 → 87654), or null if a nibble is not a digit.
function bcd(data: readonly number[], at: number, width: number): number | null {
  let n = 0;
  for (let i = 0; i < width; i++) {
    const b = data[at + i]!;
    const hi = b >> 4;
    const lo = b & 0x0f;
    if (hi > 9 || lo > 9) return null;
    n = n * 100 + hi * 10 + lo;
  }
  return n;
}

export function findValue(did: string, data: readonly number[], target: number): ValueMatch[] {
  const out: ValueMatch[] = [];
  // A number with leading zero bytes matches at several widths: kept once, at the
  // narrowest (BE ends where it ends; LE starts where it starts).
  const seen = new Set<string>();
  const add = (key: string, m: ValueMatch) => {
    if (seen.has(key)) return;
    seen.add(key);
    out.push(m);
  };
  for (const { factor, unit } of SCALES) {
    for (const width of WIDTHS) {
      for (let at = 0; at + width <= data.length; at++) {
        for (const bigEndian of [true, false]) {
          const v = uint(data, at, width, bigEndian) / factor;
          if (!near(v, target)) continue;
          const order = bigEndian ? 'big-endian' : 'little-endian';
          add(`${factor}|${order}|${bigEndian ? at + width : at}`, { did, encoding: `entero de ${width} bytes, ${order}, ${unit}`, offset: at, value: v });
        }
        const b = bcd(data, at, width);
        if (b != null && near(b / factor, target)) add(`${factor}|bcd|${at + width}`, { did, encoding: `BCD de ${width} bytes, ${unit}`, offset: at, value: b / factor });
      }
    }
  }
  // As text: a run of digits ("087654").
  const text = data.map((b) => (b >= 0x30 && b <= 0x39 ? String.fromCharCode(b) : ' ')).join('');
  for (const m of text.matchAll(/\d+/g)) {
    const n = Number(m[0]);
    for (const { factor, unit } of SCALES) {
      if (near(n / factor, target)) add(`${factor}|ascii|${m.index}`, { did, encoding: `texto (${m[0].length} dígitos), ${unit}`, offset: m.index!, value: n / factor });
    }
  }
  return out;
}
