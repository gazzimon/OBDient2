// GeocodingPort over Photon (OpenStreetMap search, komoot).
//
// The public instance (photon.komoot.io) is fair-use only; distributed builds
// should self-host Photon or use a provider. Same API, different base URL.

import type { LatLng } from '@/domain/geo/geo';
import type { GeocodingPort, Place, SearchOptions } from '@/domain/navigation/route';

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
}

export function toPlace(f: PhotonFeature): Place {
  const p = f.properties;
  const street = [p.street, p.housenumber].filter(Boolean).join(' ');
  const name = p.name ?? (street || p.city || 'Sin nombre');
  const detail = [p.name ? street : '', p.city, p.state, p.country].filter(Boolean).join(', ');
  const [lng, lat] = f.geometry.coordinates;
  return { name, detail, location: { lat, lng }, ...(p.extent ? { bounds: p.extent } : {}) };
}
