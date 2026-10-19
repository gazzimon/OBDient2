// Weather now and in the next hours at a point (Open-Meteo, free, no key).

const WMO = {
  0: 'despejado', 1: 'mayormente despejado', 2: 'parcialmente nublado', 3: 'nublado',
  45: 'niebla', 48: 'niebla con escarcha',
  51: 'llovizna débil', 53: 'llovizna', 55: 'llovizna intensa', 56: 'llovizna helada', 57: 'llovizna helada intensa',
  61: 'lluvia débil', 63: 'lluvia', 65: 'lluvia intensa', 66: 'lluvia helada', 67: 'lluvia helada intensa',
  71: 'nevada débil', 73: 'nevada', 75: 'nevada intensa', 77: 'granizo fino',
  80: 'chaparrones débiles', 81: 'chaparrones', 82: 'chaparrones intensos', 85: 'chaparrones de nieve', 86: 'chaparrones de nieve intensos',
  95: 'tormenta', 96: 'tormenta con granizo', 99: 'tormenta fuerte con granizo',
};
const HOURS = 6;

export function weatherUrl(p) {
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${p.lat.toFixed(3)}&longitude=${p.lng.toFixed(3)}` +
    '&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,visibility' +
    `&hourly=precipitation_probability,precipitation,weather_code&forecast_hours=${HOURS}&timezone=auto`
  );
}

export function weatherFromApi(body) {
  const c = body?.current ?? {};
  const h = body?.hourly ?? {};
  const next = (h.time ?? []).map((t, i) => ({
    hour: String(t).slice(11, 16),
    rainChance: h.precipitation_probability?.[i] ?? null,
    rainMm: h.precipitation?.[i] ?? null,
    sky: WMO[h.weather_code?.[i]] ?? null,
  }));
  return {
    now: {
      sky: WMO[c.weather_code] ?? null,
      temperatureC: c.temperature_2m ?? null,
      feelsLikeC: c.apparent_temperature ?? null,
      rainMm: c.precipitation ?? null,
      windKmh: c.wind_speed_10m ?? null,
      gustsKmh: c.wind_gusts_10m ?? null,
      visibilityKm: c.visibility != null ? Math.round(c.visibility / 100) / 10 : null,
    },
    nextHours: next,
    maxRainChance: next.reduce((m, x) => Math.max(m, x.rainChance ?? 0), 0),
    source: 'Open-Meteo',
  };
}
