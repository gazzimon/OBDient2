// Follows a short map link (maps.app.goo.gl/…) to the long one, which says
// where it points. HEAD first: the Google Maps page itself weighs ~1 MB.

type Fetch = (url: string, init?: { method?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; url: string }>;

const TIMEOUT_MS = 8_000;

export async function followLink(url: string, signal?: AbortSignal, fetchFn: Fetch = fetch as unknown as Fetch): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    for (const method of ['HEAD', 'GET']) {
      const res = await fetchFn(url, { method, signal: controller.signal });
      if (res.url && res.url !== url) return res.url;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }
    return url;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
