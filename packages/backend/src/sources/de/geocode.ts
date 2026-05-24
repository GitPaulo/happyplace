import type { BoundingBox } from "@happyplace/shared";
import { getKreiseData } from "./data-store.js";

export interface KreisInfo {
  kreisKey: string;
  name: string;
  lat: number;
  lng: number;
  density: number;
}

const PADDING = 0.3;

export function getKreiseForBounds(bounds: BoundingBox): Promise<KreisInfo[]> {
  const kreiseData = getKreiseData();
  const padded = {
    south: bounds.south - PADDING,
    north: bounds.north + PADDING,
    west: bounds.west - PADDING,
    east: bounds.east + PADDING,
  };

  const results: KreisInfo[] = [];
  for (const [kreisKey, entry] of Object.entries(kreiseData)) {
    if (
      entry.lat >= padded.south &&
      entry.lat <= padded.north &&
      entry.lng >= padded.west &&
      entry.lng <= padded.east
    ) {
      results.push({
        kreisKey,
        name: entry.name,
        lat: entry.lat,
        lng: entry.lng,
        density: entry.density,
      });
    }
  }

  console.log(`[de-geocode] found ${results.length} Kreise overlapping bounds`);
  return Promise.resolve(results);
}

export function getMunicipalitiesForBounds(
  bounds: BoundingBox,
): Promise<{ lat: number; lng: number; density: number; name: string; kreisKey: string }[]> {
  const kreise = getKreiseForBounds(bounds);
  return kreise.then((k) =>
    k
      .filter((entry) => entry.density > 0)
      .map((entry) => ({
        lat: entry.lat,
        lng: entry.lng,
        density: entry.density,
        name: entry.name,
        kreisKey: entry.kreisKey,
      }))
  );
}
