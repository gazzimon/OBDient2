// Finding places for the assistant ("llevame a Uruguay 1223"), over the
// geocoder (Photon on the Z440).
//
// MVP (PLAN 0, 2026-10-18): addresses only; OSM is good at streets and weak at
// shops. findNearby (categories) is kept for later and not offered to the
// model; shops come with a places provider (docs/plans/voz-y-lugares.md).
//
// Photon matches the text against names, so a category is searched by the
// words and brands its places are called ("YPF", "Shell"…) inside a box around
// the car, filtered by its OpenStreetMap tag, and sorted by distance (tested
// in Buenos Aires: stations at 1.5–2.4 km). Free text keeps the geocoder's
// relevance but puts what is near first: a namesake 900 km away no longer wins.

import { distanceM, type LatLng } from '@/domain/geo/geo';
import type { GeocodingPort, Place } from './route';

export const PLACE_CATEGORIES = {
  fuel: { label: 'estación de servicio', osmTag: 'amenity:fuel', terms: ['YPF', 'Shell', 'Axion', 'Puma', 'Gulf', 'estacion de servicio'] },
  ev_charging: { label: 'carga de autos eléctricos', osmTag: 'amenity:charging_station', terms: ['cargador', 'carga', 'charging'] },
  parking: { label: 'estacionamiento', osmTag: 'amenity:parking', terms: ['estacionamiento', 'parking', 'garage'] },
  car_repair: { label: 'taller mecánico', osmTag: 'shop:car_repair', terms: ['taller', 'mecanica', 'gomeria', 'service'] },
  car_wash: { label: 'lavadero', osmTag: 'amenity:car_wash', terms: ['lavadero', 'lavado'] },
  pharmacy: { label: 'farmacia', osmTag: 'amenity:pharmacy', terms: ['farmacia'] },
  hospital: { label: 'hospital', osmTag: 'amenity:hospital', terms: ['hospital', 'clinica', 'sanatorio'] },
  police: { label: 'comisaría', osmTag: 'amenity:police', terms: ['comisaria', 'policia'] },
  atm: { label: 'cajero automático', osmTag: 'amenity:atm', terms: ['cajero', 'banelco', 'link'] },
  supermarket: { label: 'supermercado', osmTag: 'shop:supermarket', terms: ['supermercado', 'Coto', 'Carrefour', 'Dia', 'Jumbo', 'Disco'] },
} as const;

export type PlaceCategory = keyof typeof PLACE_CATEGORIES;
export const PLACE_CATEGORY_IDS = Object.keys(PLACE_CATEGORIES) as PlaceCategory[];

export interface FoundPlace extends Place {
  // From the car; null when the position is unknown.
  readonly distanceKm: number | null;
  // Where two streets cross ("Uruguay y Blas Parera").
  readonly corner?: true;
}

const MAX_RESULTS = 5;
// Degrees of latitude ≈ 111 km: ~5 km, then ~20 km if too few near.
const BOXES_DEG = [0.05, 0.2] as const;
const NEAR_KM = 50;

export async function findNearby(
  geocoder: GeocodingPort,
  category: PlaceCategory,
  near: LatLng,
  signal?: AbortSignal,
): Promise<FoundPlace[]> {
  const { osmTag, terms } = PLACE_CATEGORIES[category];
  let found: FoundPlace[] = [];
  for (const d of BOXES_DEG) {
    const bbox = [near.lng - d, near.lat - d, near.lng + d, near.lat + d] as const;
    const lists = await Promise.all(
      terms.map((t) => geocoder.search(t, near, signal, { osmTag, bbox, limit: 10 }).catch(() => [] as Place[])),
    );
    found = byDistance(dedupe(lists.flat()), near);
    if (found.length >= 3) break;
  }
  return found.slice(0, MAX_RESULTS);
}

export async function findByText(
  geocoder: GeocodingPort,
  query: string,
  near: LatLng | null,
  signal?: AbortSignal,
): Promise<FoundPlace[]> {
  // "Uruguay y Blas Parera": a corner, found from the two streets.
  const corner = parseCorner(query);
  const corners = corner && near ? await findCorner(geocoder, corner[0], corner[1], near, signal).catch(() => []) : [];
  const places = dedupe(await geocoder.search(query, near, signal, { limit: 8 })).map((p) => withDistance(p, near));
  const isNear = (p: FoundPlace) => p.distanceKm == null || p.distanceKm <= NEAR_KM;
  const nearOnes = places.filter(isNear);
  // An address ("Uruguay 1223") exists in many towns: the nearest is the one
  // meant (Buenos Aires: CABA at 1.2 km before Adrogué at 24). A name keeps
  // the geocoder's relevance. Another town is reached by naming it.
  if (/\d/.test(query) && near) nearOnes.sort((a, b) => a.distanceKm! - b.distanceKm!);
  return [...corners, ...nearOnes, ...places.filter((p) => !isNear(p))].slice(0, MAX_RESULTS);
}

// "A y B", "A esquina B", "A e B": two street names, no house number.
export function parseCorner(query: string): [string, string] | null {
  const m = /^(.+?)\s+(?:y|e|esq\.?|esquina)\s+(.+)$/i.exec(query.trim());
  if (!m || /\d/.test(query)) return null;
  const a = m[1]!.trim();
  const b = m[2]!.trim();
  return a.length >= 3 && b.length >= 3 ? [a, b] : null;
}

// Where two streets cross, within ~15 km. Photon gives each street piece a
// box; a piece of one touching a piece of the other is the corner (checked
// in Buenos Aires and Posadas). Each name is also tried as "Avenida …", which
// is how OSM names many of them.
const CORNER_BOX_DEG = 0.14;
const TOUCH_DEG = 0.0002; // ~20 m
const SAME_CORNER_KM = 0.1;

export async function findCorner(
  geocoder: GeocodingPort,
  a: string,
  b: string,
  near: LatLng,
  signal?: AbortSignal,
): Promise<FoundPlace[]> {
  const d = CORNER_BOX_DEG;
  const bbox = [near.lng - d, near.lat - d, near.lng + d, near.lat + d] as const;
  const pieces = async (name: string) => {
    const names = /^av(enida|\.)?\s/i.test(name) ? [name] : [name, `Avenida ${name}`];
    const lists = await Promise.all(names.map((n) => geocoder.search(n, near, signal, { osmTag: 'highway', bbox, limit: 50 })));
    const wanted = fold(name.replace(/^av(enida|\.)?\s+/i, ''));
    return lists.flat().filter((p) => p.bounds && fold(p.name).includes(wanted));
  };
  const [pa, pb] = await Promise.all([pieces(a), pieces(b)]);
  const found: FoundPlace[] = [];
  for (const x of pa) {
    for (const y of pb) {
      const [xw, xn, xe, xs] = x.bounds!;
      const [yw, yn, ye, ys] = y.bounds!;
      const w = Math.max(xw, yw);
      const e = Math.min(xe, ye);
      const n = Math.min(xn, yn);
      const s = Math.max(xs, ys);
      if (w > e + TOUCH_DEG || s > n + TOUCH_DEG) continue;
      const place: FoundPlace = {
        ...withDistance({ name: `${x.name} y ${y.name}`, detail: x.detail, location: { lat: (n + s) / 2, lng: (w + e) / 2 } }, near),
        corner: true,
      };
      if (!found.some((f) => distanceM(f.location, place.location) < SAME_CORNER_KM * 1000)) found.push(place);
    }
  }
  return found.sort((p, q) => p.distanceKm! - q.distanceKm!).slice(0, 2);
}

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export function withDistance(p: Place, near: LatLng | null): FoundPlace {
  return { ...p, distanceKm: near ? Math.round(distanceM(near, p.location) / 100) / 10 : null };
}

function byDistance(places: Place[], near: LatLng): FoundPlace[] {
  return places.map((p) => withDistance(p, near)).sort((a, b) => a.distanceKm! - b.distanceKm!);
}

// The same place found by two terms (same name, within ~20 m).
function dedupe(places: Place[]): Place[] {
  const out: Place[] = [];
  for (const p of places) {
    if (!out.some((q) => q.name === p.name && distanceM(q.location, p.location) < 20)) out.push(p);
  }
  return out;
}
