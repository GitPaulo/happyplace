import type { BoundingBox } from "@happyplace/shared";

const CELL_SIZE_KM = 1;
const EARTH_RADIUS_KM = 6371;

function kmToLat(km: number): number {
  return (km / EARTH_RADIUS_KM) * (180 / Math.PI);
}

function kmToLng(km: number, lat: number): number {
  return (km / (EARTH_RADIUS_KM * Math.cos((lat * Math.PI) / 180))) * (180 / Math.PI);
}

export function expandBounds(bounds: BoundingBox, km: number = CELL_SIZE_KM): BoundingBox {
  const centerLat = (bounds.north + bounds.south) / 2;
  const latPad = kmToLat(km);
  const lngPad = kmToLng(km, centerLat);
  return {
    north: bounds.north + latPad,
    south: bounds.south - latPad,
    east: bounds.east + lngPad,
    west: bounds.west - lngPad,
  };
}

export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function proximityScore(distKm: number, maxDistKm: number = 3): number {
  if (distKm <= 0) return 100;
  if (distKm >= maxDistKm) return 0;
  return Math.round((1 - distKm / maxDistKm) * 100);
}
