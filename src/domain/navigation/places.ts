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
  const places = dedupe(await geocoder.search(query, near, signal, { limit: 8 })).map((p) => withDistance(p, near));
  const isNear = (p: FoundPlace) => p.distanceKm == null || p.distanceKm <= NEAR_KM;
  const nearOnes = places.filter(isNear);
  // An address ("Uruguay 1223") exists in many towns: the nearest is the one
  // meant (Buenos Aires: CABA at 1.2 km before Adrogué at 24). A name keeps
  // the geocoder's relevance. Another town is reached by naming it.
  if (/\d/.test(query) && near) nearOnes.sort((a, b) => a.distanceKm! - b.distanceKm!);
  return [...nearOnes, ...places.filter((p) => !isNear(p))].slice(0, MAX_RESULTS);
}

function withDistance(p: Place, near: LatLng | null): FoundPlace {
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
