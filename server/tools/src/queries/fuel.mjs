// The stations nearest to a point, with their prices (and how old they are),
// and the cheapest nearby for a product.

import { distanceKm } from './geo.mjs';

export const FUEL_PRODUCTS = ['nafta', 'nafta_premium', 'gasoil', 'gasoil_premium', 'gnc'];
const MAX_KM = 30;
const NEAR_KM = 10;
const SHOWN = 5;

export function nearestStations(data, here, product = null, now = Date.now()) {
  const stations = (data?.stations ?? [])
    .map((s) => ({ s, km: distanceKm(here, s) }))
    .filter((x) => x.km <= MAX_KM)
    .sort((a, b) => a.km - b.km);
  const view = ({ s, km }) => ({
    brand: s.brand,
    company: s.company,
    address: s.address,
    town: s.town,
    distanceKm: Math.round(km * 10) / 10,
    location: { lat: s.lat, lng: s.lng },
    prices: Object.fromEntries(
      Object.entries(s.prices)
        .filter(([p]) => !product || p === product)
        .map(([p, v]) => [p, { price: v.price, daysOld: Math.floor((now - v.at) / 86_400_000) }]),
    ),
  });
  const nearest = stations.slice(0, SHOWN).map(view);
  const priced = product ? stations.filter((x) => x.km <= NEAR_KM && x.s.prices[product]) : [];
  const cheapest = priced.length ? view(priced.reduce((a, b) => (b.s.prices[product].price < a.s.prices[product].price ? b : a))) : null;
  return { nearest, cheapest, updated: data?.updated ?? null, source: data?.source ?? null };
}
