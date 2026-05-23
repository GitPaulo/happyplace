import type { BoundingBox, DataPoint } from "@happyplace/shared";

const OVERPASS_ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

const USER_AGENT = "HappyPlace/1.0 (livability score aggregator)";
const DELAY_BETWEEN_REQUESTS_MS = 1500;

let activeEndpoint = OVERPASS_ENDPOINTS[0];

// Serialize Overpass requests with delay to avoid rate limiting
let pendingRequest: Promise<void> = Promise.resolve();

export async function queryOverpass(
  bounds: BoundingBox,
  query: string
): Promise<DataPoint[]> {
  const result = new Promise<DataPoint[]>((resolve, reject) => {
    pendingRequest = pendingRequest.then(async () => {
      try {
        const data = await doOverpassQuery(bounds, query);
        resolve(data);
        await sleep(DELAY_BETWEEN_REQUESTS_MS);
      } catch (err) {
        reject(err);
        await sleep(DELAY_BETWEEN_REQUESTS_MS);
      }
    });
  });
  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function doOverpassQuery(
  bounds: BoundingBox,
  query: string
): Promise<DataPoint[]> {
  const bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
  const fullQuery = `[out:json][timeout:60];(${query.replace(/\{\{bbox\}\}/g, bbox)});out center;`;

  console.log(`[overpass] Fetching: ${query.slice(0, 60)}...`);
  const start = Date.now();

  let lastError: Error | null = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const url = `${endpoint}?data=${encodeURIComponent(fullQuery)}`;
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(60000),
      });

      if (res.status === 429) {
        console.warn(`[overpass] Rate limited on ${endpoint}, trying next...`);
        await sleep(2000);
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        lastError = new Error(`Overpass ${res.status}: ${text.slice(0, 200)}`);
        continue;
      }

      const json = await res.json();
      activeEndpoint = endpoint;
      console.log(`[overpass] Got ${json.elements?.length ?? 0} elements in ${Date.now() - start}ms from ${endpoint}`);

      return (json.elements ?? [])
        .map((el: any) => {
          const lat = el.lat ?? el.center?.lat;
          const lng = el.lon ?? el.center?.lon;
          if (lat == null || lng == null) return null;
          return {
            lat,
            lng,
            type:
              el.tags?.amenity ??
              el.tags?.shop ??
              el.tags?.healthcare ??
              el.tags?.public_transport ??
              el.tags?.railway ??
              el.tags?.highway ??
              "unknown",
            metadata: el.tags ?? {},
          };
        })
        .filter(Boolean) as DataPoint[];
    } catch (err) {
      lastError = err as Error;
      console.warn(`[overpass] Error on ${endpoint}: ${(err as Error).message}`);
    }
  }

  throw lastError ?? new Error("All Overpass endpoints failed");
}

/** Haversine distance in km */
export function distanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
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

export function densityScore(count: number, expectedCount: number): number {
  return Math.min(100, Math.round((count / expectedCount) * 100));
}
