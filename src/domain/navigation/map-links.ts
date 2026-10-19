// Map links pasted in the chat (Google Maps, Waze, geo:): the destination is
// read from the link by the app, never left to the model.
//
// What a link carries varies. Some have the pin's coordinates (`!3d…!4d…`,
// `@lat,lng`, `q=lat,lng`, `geo:`); a shared place often has only its name and
// address as text ("/maps/place/Taller X, C. 127, N3300 Posadas, Misiones/"),
// and Google gives its coordinates only through its paid API. Then the address
// is searched like any other, and the result is marked approximate.

import type { LatLng } from '@/domain/geo/geo';

const LINK = /\b(?:https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|(?:www\.|maps\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|(?:www\.)?waze\.com\/ul)[^\s]*|geo:-?\d[^\s]*)/i;

// Short links that have to be followed to see the real one.
export const isShortLink = (url: string): boolean => /^https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(url);

export function findMapLink(text: string): string | null {
  return text.match(LINK)?.[0]?.replace(/[).,;]+$/, '') ?? null;
}

export interface MapLink {
  // The pin, when the link has it.
  readonly location: LatLng | null;
  // The place's name ("Taller aire brys y mecánica ligera").
  readonly name: string | null;
  // An address to search when there is no pin ("Calle 127, Posadas, Misiones").
  readonly query: string | null;
}

const NUM = String.raw`(-?\d{1,3}(?:\.\d+)?)`;

export function parseMapLink(url: string): MapLink | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.replace(/\+/g, ' '));
  } catch {
    decoded = url;
  }
  const place = /\/maps\/place\/([^/@?]+)/.exec(decoded)?.[1]?.trim() ?? null;
  const textQuery = /[?&](?:q|query|destination|daddr)=([^&]+)/.exec(decoded)?.[1]?.trim() ?? null;
  const location = pin(decoded);
  const parts = splitPlace(place ?? (textQuery && !location ? textQuery : null));
  if (!location && !parts.query && !parts.name) return null;
  return { location, name: parts.name, query: location ? null : parts.query };
}

function pin(s: string): LatLng | null {
  const patterns = [
    // The place's own pin; "@lat,lng" is only the map's center.
    new RegExp(String.raw`!3d${NUM}!4d${NUM}`),
    new RegExp(String.raw`^geo:${NUM},${NUM}`),
    new RegExp(String.raw`[?&](?:q|query|ll|destination|daddr)=${NUM},\s*${NUM}`),
    new RegExp(String.raw`@${NUM},${NUM}`),
  ];
  for (const re of patterns) {
    const m = re.exec(s);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) return { lat, lng };
  }
  return null;
}

// "Name, free text, C. 127, N3300 Posadas, Misiones" → the name, and the last
// segments as an address the geocoder understands.
function splitPlace(text: string | null): { name: string | null; query: string | null } {
  if (!text) return { name: null, query: null };
  const segments = text.split(',').map((s) => s.trim()).filter(Boolean);
  if (segments.length === 1) return { name: segments[0]!, query: segments[0]! };
  const [name, ...rest] = segments;
  const address = rest
    .slice(-3)
    .map((s) =>
      s
        .replace(/^C\.\s*/i, 'Calle ')
        .replace(/^Av(?:da)?\.\s*/i, 'Avenida ')
        // Argentine postal codes (N3300, C1425ABC) and plain ones.
        .replace(/\b[A-Z]\d{4}(?:[A-Z]{3})?\b\s*/g, '')
        .replace(/^\d{4,5}\s+/, '')
        .trim(),
    )
    .filter(Boolean);
  return { name: name ?? null, query: address.join(', ') || name || null };
}
