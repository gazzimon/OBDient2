// The web search behind the tool: SearXNG on this machine (server/searxng).

export function searxng({ baseUrl, fetchFn = fetch, timeoutMs = 8_000 }) {
  return async function search(query) {
    const url = `${baseUrl.replace(/\/$/, '')}/search?format=json&language=es-AR&safesearch=1&q=${encodeURIComponent(query)}`;
    // SearXNG's bot detection wants to know the client; it is always us.
    const res = await fetchFn(url, { headers: { 'X-Real-IP': '127.0.0.1' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`SearXNG HTTP ${res.status}`);
    const body = await res.json();
    return Array.isArray(body.results) ? body.results : [];
  };
}
