import type { BoundingBox } from "@happyplace/shared";

interface CountryBounds {
  code: string;
  south: number;
  north: number;
  west: number;
  east: number;
}

const SUPPORTED_COUNTRIES: CountryBounds[] = [
  { code: "FR", south: 41.3, north: 51.1, west: -5.2, east: 9.6 },
  { code: "GB", south: 49.9, north: 60.9, west: -8.2, east: 1.8 },
];

function overlaps(a: BoundingBox, b: CountryBounds): boolean {
  return a.south < b.north && a.north > b.south && a.west < b.east && a.east > b.west;
}

/**
 * Returns the set of supported country codes whose territory overlaps
 * the given bounding box. Global (Overpass-based) sources always run
 * regardless of this result.
 */
export function detectCountries(bounds: BoundingBox): Set<string> {
  const result = new Set<string>();
  for (const c of SUPPORTED_COUNTRIES) {
    if (overlaps(bounds, c)) result.add(c.code);
  }
  return result;
}
