/**
 * Interpolate a score (0-100) to a color on the red-orange-yellow-green gradient.
 * Uses HSL for smooth transitions.
 */
export function scoreToColor(score: number): string {
  const clamped = Math.max(0, Math.min(100, score));
  // Map 0-100 to hue 0 (red) -> 30 (orange) -> 55 (yellow) -> 130 (green)
  // Using piecewise linear interpolation through color stops
  const stops = [
    { score: 0, hue: 0, sat: 75, light: 50 },
    { score: 25, hue: 25, sat: 80, light: 52 },
    { score: 50, hue: 45, sat: 85, light: 55 },
    { score: 75, hue: 80, sat: 65, light: 45 },
    { score: 100, hue: 140, sat: 60, light: 40 },
  ];

  let lower = stops[0];
  let upper = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (clamped >= stops[i].score && clamped <= stops[i + 1].score) {
      lower = stops[i];
      upper = stops[i + 1];
      break;
    }
  }

  const t = (clamped - lower.score) / (upper.score - lower.score || 1);
  const hue = lower.hue + (upper.hue - lower.hue) * t;
  const sat = lower.sat + (upper.sat - lower.sat) * t;
  const light = lower.light + (upper.light - lower.light) * t;

  return `hsl(${Math.round(hue)}, ${Math.round(sat)}%, ${Math.round(light)}%)`;
}

export function scoreToHex(score: number): string {
  const color = scoreToColor(score);
  const el = document.createElement("div");
  el.style.color = color;
  document.body.appendChild(el);
  const computed = getComputedStyle(el).color;
  document.body.removeChild(el);

  const match = computed.match(/(\d+)/g);
  if (!match) return "#888888";
  const [r, g, b] = match.map(Number);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
