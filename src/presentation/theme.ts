// Raw colour values for places NativeWind classes cannot reach (SVG, map
// layers, icon tints). Must match tailwind.config.js `brand` palette.

export const COLORS = {
  bg: '#0D0D0D',
  surface: '#1C1C1E',
  border: '#2C2C2E',
  mint: '#2DE1A5',
  mintDark: '#1D9E75',
  red: '#F26D6D',
  amber: '#F5A623',
  text: '#F5F5F5',
  muted: '#9A9A9A',
  pill: '#E8E8E8',
} as const;
