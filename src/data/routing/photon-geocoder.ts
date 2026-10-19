// GeocodingPort over Photon (OpenStreetMap search, komoot).
//
// The public instance (photon.komoot.io) is fair-use only; distributed builds
// should self-host Photon or use a provider. Same API, different base URL.

import type { LatLng } from '@/domain/geo/geo';
import type { GeocodingPort, Place, SearchOptions, Whereabouts } from '@/domain/navigation/route';

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    street?: string;
    housenumber?: string;
    city?: string;
    state?: string;
    country?: string;
    extent?: [number, number, number, number];
  };
}

type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class PhotonGeocoder implements GeocodingPort {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchFn: Fetch = fetch,
  ) {}

  async search(query: string, near: LatLng | null, signal?: AbortSignal, options: SearchOptions = {}): Promise<Place[]> {
    const q = query.trim();
    if (q.length < 3) return [];
    const params = [`q=${encodeURIComponent(q)}`, `limit=${options.limit ?? 6}`];
    // Bias results toward where the driver is, not toward the whole planet.
    if (near) params.push(`lat=${near.lat.toFixed(5)}`, `lon=${near.lng.toFixed(5)}`);
    if (options.osmTag) params.push(`osm_tag=${encodeURIComponent(options.osmTag)}`);
    if (options.bbox) params.push(`bbox=${options.bbox.map((v) => v.toFixed(5)).join(',')}`);
    const res = await this.fetchFn(`${this.baseUrl.replace(/\/$/, '')}/api/?${params.join('&')}`, signal ? { signal } : undefined);
    if (!res.ok) throw new Error(`Geocoder HTTP ${res.status}`);
    const body = (await res.json()) as { features?: PhotonFeature[] };
    return (body.features ?? []).map(toPlace);
  }

  // The nearest features; the first with a street names it (the nearest one
  // can be a city block or a shop).
  async reverse(point: LatLng, signal?: AbortSignal): Promise<Whereabouts | null> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/reverse?lat=${point.lat.toFixed(5)}&lon=${point.lng.toFixed(5)}&limit=5&radius=0.3`;
    const res = await this.fetchFn(url, signal ? { signal } : undefined);
    if (!res.ok) throw new Error(`Geocoder HTTP ${res.status}`);
    const features = ((await res.json()) as { features?: (PhotonFeature & { properties: { osm_key?: string } })[] }).features ?? [];
    if (features.length === 0) return null;
    const p0 = features[0]!.properties;
    const withStreet = features.find((f) => f.properties.street) ?? features.find((f) => f.properties.osm_key === 'highway');
    const sp = withStreet?.properties;
    const street = sp ? (sp.street ? [sp.street, sp.housenumber].filter(Boolean).join(' ') : (sp.name ?? null)) : null;
    return { street, city: p0.city ?? sp?.city ?? null, state: p0.state ?? sp?.state ?? null };
  }
}

export function toPlace(f: PhotonFeature): Place {
  const p = f.properties;
  const street = [p.street, p.housenumber].filter(Boolean).join(' ');
  const name = p.name ?? (street || p.city || 'Sin nombre');
  const detail = [p.name ? street : '', p.city, p.state, p.country].filter(Boolean).join(', ');
  const [lng, lat] = f.geometry.coordinates;
  return { name, detail, location: { lat, lng }, ...(p.extent ? { bounds: p.extent } : {}) };
}
