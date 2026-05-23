// SVG path data for each source type icon (designed for a 16x16 viewBox)
const ICON_PATHS: Record<string, string> = {
  grocery:
    // Shopping cart
    "M2 3h2l.5 2h9l-1.5 5H6L4.5 5M6 13a1 1 0 110 2 1 1 0 010-2m6 0a1 1 0 110 2 1 1 0 010-2",
  transport:
    // Bus
    "M4 2h8a1 1 0 011 1v8a2 2 0 01-2 2H5a2 2 0 01-2-2V3a1 1 0 011-1m0 4h8m-6 5h1m3 0h1M5 4h6",
  hospital:
    // Medical cross
    "M6 3h4v3h3v4h-3v3H6v-3H3V6h3V3z",
  police:
    // Shield
    "M8 1L3 3v4c0 3.5 2.3 6.5 5 8 2.7-1.5 5-4.5 5-8V3L8 1z",
  crime:
    // Lock
    "M5 7V5a3 3 0 016 0v2h1a1 1 0 011 1v5a1 1 0 01-1 1H4a1 1 0 01-1-1V8a1 1 0 011-1h1m2-2v2h2V5a1 1 0 00-2 0",
  realestate:
    // House
    "M8 2L2 7h2v6h3V9h2v4h3V7h2L8 2z",
  population:
    // People
    "M5 7a2 2 0 110-4 2 2 0 010 4m6 0a2 2 0 110-4 2 2 0 010 4M2 13c0-2 2-3 3-3s3 1 3 3m1 0c0-2 2-3 3-3s3 1 3 3",
};

/**
 * Returns an inline SVG string for a source icon.
 * White icon in a black circle with gray outline.
 * `size` is the outer diameter in pixels.
 */
export function amenityIconSvg(sourceId: string, size: number = 24): string {
  const path = ICON_PATHS[sourceId] ?? ICON_PATHS.grocery;
  const r = size / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${r}" cy="${r}" r="${r - 1}" fill="#111" stroke="#555" stroke-width="1.5"/>
    <g transform="translate(${(size - 16) / 2},${(size - 16) / 2})">
      <path d="${path}" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
  </svg>`;
}

/**
 * Map a DataPoint type string to a source ID for icon lookup.
 * OSM returns types like "supermarket", "convenience", "bus_stop", etc.
 */
export function typeToSourceId(type: string, sourceId: string): string {
  return sourceId;
}

/**
 * Returns an HTML string for use in a Leaflet DivIcon.
 */
export function amenityMarkerHtml(sourceId: string): string {
  return amenityIconSvg(sourceId, 20);
}

/**
 * Returns an inline SVG string for use in the score panel / score bar.
 */
export function amenityPanelIcon(sourceId: string): string {
  return amenityIconSvg(sourceId, 20);
}
