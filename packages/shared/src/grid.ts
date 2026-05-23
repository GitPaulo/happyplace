import type { BoundingBox, GridCell } from "./types.js";

const CELL_SIZE_KM = 1;
const EARTH_RADIUS_KM = 6371;

function kmToLat(km: number): number {
  return (km / EARTH_RADIUS_KM) * (180 / Math.PI);
}

function kmToLng(km: number, lat: number): number {
  return (km / (EARTH_RADIUS_KM * Math.cos((lat * Math.PI) / 180))) * (180 / Math.PI);
}

export function generateGrid(bounds: BoundingBox): GridCell[] {
  const centerLat = (bounds.north + bounds.south) / 2;
  const latStep = kmToLat(CELL_SIZE_KM);
  const lngStep = kmToLng(CELL_SIZE_KM, centerLat);

  const startLat = Math.floor(bounds.south / latStep) * latStep;
  const startLng = Math.floor(bounds.west / lngStep) * lngStep;

  const cells: GridCell[] = [];

  for (let lat = startLat; lat < bounds.north; lat += latStep) {
    for (let lng = startLng; lng < bounds.east; lng += lngStep) {
      cells.push({
        id: `${lat.toFixed(5)}_${lng.toFixed(5)}`,
        south: lat,
        west: lng,
        north: lat + latStep,
        east: lng + lngStep,
        centerLat: lat + latStep / 2,
        centerLng: lng + lngStep / 2,
      });
    }
  }

  return cells;
}
