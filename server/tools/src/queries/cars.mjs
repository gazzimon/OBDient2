// Car prices from the CCA list: versions matching the words asked
// ("onix 1.4 ltz"), with the price for a year or for every year.

const MAX_RESULTS = 8;

const fold = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/(\d)[.,](\d)/g, '$1,$2');

export function findCars(data, query, year = null) {
  const words = fold(query).split(/\s+/).filter((w) => w.length > 0 && !/^\d{4}$/.test(w));
  const y = year ?? (/\b(19|20)\d\d\b/.exec(query)?.[0] ?? null);
  const yearKey = y && Number(y) >= new Date().getFullYear() ? null : y;
  if (words.length === 0) return { results: [], month: data?.month ?? null };
  const results = [];
  for (const c of data?.cars ?? []) {
    const text = fold(`${c.brand} ${c.model} ${c.version}`);
    if (!words.every((w) => text.includes(w))) continue;
    if (yearKey && !(yearKey in c.prices)) continue;
    results.push({
      brand: c.brand,
      model: c.model,
      version: c.version,
      prices: yearKey ? { [yearKey]: c.prices[yearKey] } : c.prices,
    });
    if (results.length >= MAX_RESULTS) break;
  }
  return { results, month: data?.month ?? null, unit: data?.unit ?? 'miles de pesos', source: data?.source ?? null };
}
