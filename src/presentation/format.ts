// Display formatting shared by the map and the AR HUD.

export function formatDistance(meters: number): string {
  if (meters >= 10_000) return `${Math.round(meters / 1000)} km`;
  if (meters >= 1000) return `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
  if (meters >= 100) return `${Math.round(meters / 10) * 10} m`;
  return `${Math.max(0, Math.round(meters))} m`;
}

export function formatDuration(seconds: number): string {
  const min = Math.round(seconds / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

export function formatEta(remainingS: number, now = new Date()): string {
  const eta = new Date(now.getTime() + remainingS * 1000);
  return `${String(eta.getHours()).padStart(2, '0')}:${String(eta.getMinutes()).padStart(2, '0')}`;
}
