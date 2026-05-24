import type { BoundingBox, DataPoint } from "@happyplace/shared";

const OVERPASS_ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

const DELAY_BETWEEN_REQUESTS_MS = 1500;

let pendingRequest: Promise<void> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function queryOverpass(
  bounds: BoundingBox,
  query: string,
): Promise<DataPoint[]> {
  return new Promise<DataPoint[]>((resolve, reject) => {
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
}

async function doOverpassQuery(
  bounds: BoundingBox,
  query: string,
): Promise<DataPoint[]> {
  const bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
  const fullQuery = `[out:json][timeout:60];(${query.replace(/\{\{bbox\}\}/g, bbox)});out center;`;

  let lastError: Error | null = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(fullQuery)}`,
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
      console.log(`[overpass] Got ${json.elements?.length ?? 0} elements from ${endpoint}`);

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
