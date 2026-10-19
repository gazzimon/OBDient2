import { findByText, findCorner, parseCorner } from '@/domain/navigation/places';
import type { GeocodingPort, Place, SearchOptions } from '@/domain/navigation/route';

const POSADAS = { lat: -27.3671, lng: -55.8961 };
const street = (name: string, bounds: [number, number, number, number]): Place => ({
  name,
  detail: 'Posadas, Misiones, Argentina',
  location: { lat: (bounds[1] + bounds[3]) / 2, lng: (bounds[0] + bounds[2]) / 2 },
  bounds,
});
// Pieces as Photon returned them (2026-10-19): Mitre runs east–west, Haro north–south.
const MITRE = street('Avenida Mitre', [-55.9035, -27.3736, -55.902, -27.3739]);
const HARO = street('Avenida Francisco de Haro', [-55.9022, -27.373, -55.9019, -27.3745]);
const FAR = street('Avenida Francisco de Haro', [-55.95, -27.4, -55.949, -27.41]);

function geocoder(byName: Record<string, Place[]>, seen: { q: string; o?: SearchOptions }[] = []): GeocodingPort {
  return {
    search: async (q, _near, _signal, o) => {
      seen.push({ q, ...(o ? { o } : {}) });
      return byName[q] ?? [];
    },
  };
}

describe('corners', () => {
  it.each([
    ['Uruguay y Blas Parera', ['Uruguay', 'Blas Parera']],
    ['Av. Santa Fe esquina Pueyrredón', ['Av. Santa Fe', 'Pueyrredón']],
    ['Mitre e Irigoyen', ['Mitre', 'Irigoyen']],
  ])('"%s" is a corner', (q, parts) => {
    expect(parseCorner(q)).toEqual(parts);
  });
  it.each(['Uruguay 1223', 'Hospital Madariaga', 'Y'])('"%s" is not', (q) => {
    expect(parseCorner(q)).toBeNull();
  });

  it('where the two streets touch, also trying "Avenida …", only nearby streets', async () => {
    const seen: { q: string; o?: SearchOptions }[] = [];
    const g = geocoder({ 'Avenida Mitre': [MITRE], 'Avenida Francisco de Haro': [HARO, FAR] }, seen);
    const r = await findCorner(g, 'Mitre', 'Francisco de Haro', POSADAS);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ name: 'Avenida Mitre y Avenida Francisco de Haro', corner: true });
    expect(r[0]!.location.lat).toBeCloseTo(-27.3737, 3);
    expect(seen.map((s) => s.q).sort()).toEqual(['Avenida Francisco de Haro', 'Avenida Mitre', 'Francisco de Haro', 'Mitre']);
    expect(seen.every((s) => s.o?.osmTag === 'highway' && s.o.bbox)).toBe(true);
  });

  it('streets that do not cross give nothing', async () => {
    const g = geocoder({ 'Avenida Mitre': [MITRE], 'Avenida Francisco de Haro': [FAR] });
    expect(await findCorner(g, 'Mitre', 'Francisco de Haro', POSADAS)).toEqual([]);
  });

  it('the corner comes first in a search', async () => {
    const stop = { name: 'Mitre y Francisco de Haro (Krause)', detail: 'parada', location: { lat: -27.374, lng: -55.9019 } };
    const g = geocoder({ 'Avenida Mitre': [MITRE], 'Avenida Francisco de Haro': [HARO], 'Mitre y Francisco de Haro': [stop] });
    const r = await findByText(g, 'Mitre y Francisco de Haro', POSADAS);
    expect(r.map((p) => p.name)).toEqual(['Avenida Mitre y Avenida Francisco de Haro', 'Mitre y Francisco de Haro (Krause)']);
  });
});
