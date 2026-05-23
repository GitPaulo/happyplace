import type { BoundingBox } from "@happyplace/shared";
import { resilientJson } from "../../utils/resilient-fetch.js";

export interface CommuneInfo {
  code: string;
  name: string;
  lat: number;
  lng: number;
  population: number;
}

const PARIS_ARRONDISSEMENTS: CommuneInfo[] = [
  { code: "75101", name: "Paris 1er",  lat: 48.8602, lng: 2.3477, population: 15119 },
  { code: "75102", name: "Paris 2e",   lat: 48.8670, lng: 2.3441, population: 19584 },
  { code: "75103", name: "Paris 3e",   lat: 48.8637, lng: 2.3615, population: 33632 },
  { code: "75104", name: "Paris 4e",   lat: 48.8544, lng: 2.3578, population: 28088 },
  { code: "75105", name: "Paris 5e",   lat: 48.8448, lng: 2.3509, population: 56426 },
  { code: "75106", name: "Paris 6e",   lat: 48.8498, lng: 2.3322, population: 39920 },
  { code: "75107", name: "Paris 7e",   lat: 48.8566, lng: 2.3125, population: 48031 },
  { code: "75108", name: "Paris 8e",   lat: 48.8744, lng: 2.3106, population: 34919 },
  { code: "75109", name: "Paris 9e",   lat: 48.8766, lng: 2.3372, population: 58773 },
  { code: "75110", name: "Paris 10e",  lat: 48.8763, lng: 2.3574, population: 82726 },
  { code: "75111", name: "Paris 11e",  lat: 48.8593, lng: 2.3800, population: 142583 },
  { code: "75112", name: "Paris 12e",  lat: 48.8406, lng: 2.3876, population: 138421 },
  { code: "75113", name: "Paris 13e",  lat: 48.8322, lng: 2.3561, population: 178350 },
  { code: "75114", name: "Paris 14e",  lat: 48.8310, lng: 2.3266, population: 133965 },
  { code: "75115", name: "Paris 15e",  lat: 48.8421, lng: 2.2988, population: 226547 },
  { code: "75116", name: "Paris 16e",  lat: 48.8631, lng: 2.2768, population: 159380 },
  { code: "75117", name: "Paris 17e",  lat: 48.8867, lng: 2.3046, population: 160958 },
  { code: "75118", name: "Paris 18e",  lat: 48.8925, lng: 2.3444, population: 183113 },
  { code: "75119", name: "Paris 19e",  lat: 48.8867, lng: 2.3822, population: 181994 },
  { code: "75120", name: "Paris 20e",  lat: 48.8633, lng: 2.3982, population: 189172 },
];

const PARIS_BBOX: BoundingBox = {
  south: 48.815, north: 48.903, west: 2.224, east: 2.470,
};

function boundsOverlap(a: BoundingBox, b: BoundingBox): boolean {
  return a.south < b.north && a.north > b.south && a.west < b.east && a.east > b.west;
}

export async function getCommunesForBounds(bounds: BoundingBox): Promise<CommuneInfo[]> {
  const results: CommuneInfo[] = [];
  const seenCodes = new Set<string>();

  if (boundsOverlap(bounds, PARIS_BBOX)) {
    for (const arr of PARIS_ARRONDISSEMENTS) {
      if (arr.lat >= bounds.south && arr.lat <= bounds.north &&
          arr.lng >= bounds.west && arr.lng <= bounds.east) {
        results.push(arr);
        seenCodes.add(arr.code);
      }
    }
  }

  const points: { lat: number; lng: number }[] = [];
  const step = 0.02;
  for (let lat = bounds.south; lat <= bounds.north; lat += step) {
    for (let lng = bounds.west; lng <= bounds.east; lng += step) {
      if (lat >= PARIS_BBOX.south && lat <= PARIS_BBOX.north &&
          lng >= PARIS_BBOX.west && lng <= PARIS_BBOX.east) {
        continue;
      }
      points.push({ lat, lng });
    }
  }

  const MAX_CONCURRENCY = 3;
  for (let i = 0; i < points.length; i += MAX_CONCURRENCY) {
    const batch = points.slice(i, i + MAX_CONCURRENCY);
    const geoResults = await Promise.all(batch.map((p) => reverseGeocode(p.lat, p.lng)));
    for (const commune of geoResults) {
      if (commune && !seenCodes.has(commune.code)) {
        seenCodes.add(commune.code);
        results.push(commune);
      }
    }
  }

  return results;
}

const geoCache = new Map<string, CommuneInfo | null>();

async function reverseGeocode(lat: number, lng: number): Promise<CommuneInfo | null> {
  const key = `${lat.toFixed(3)}_${lng.toFixed(3)}`;
  if (geoCache.has(key)) return geoCache.get(key)!;

  const url = `https://api-adresse.data.gouv.fr/reverse/?lat=${lat}&lon=${lng}`;
  const data = await resilientJson<any>(url, {
    label: "[communes]",
    timeoutMs: 10000,
    maxRetries: 3,
    baseDelayMs: 1500,
  });

  if (!data) { geoCache.set(key, null); return null; }

  const features = data.features ?? [];
  if (features.length === 0) { geoCache.set(key, null); return null; }

  const props = features[0].properties;
  const code = props.citycode as string;
  if (!code) { geoCache.set(key, null); return null; }

  if (code === "75056") { geoCache.set(key, null); return null; }

  const coords = features[0].geometry?.coordinates;
  const info: CommuneInfo = {
    code,
    name: props.city ?? props.label ?? "Unknown",
    lat: coords?.[1] ?? lat,
    lng: coords?.[0] ?? lng,
    population: 0,
  };
  geoCache.set(key, info);
  return info;
}
