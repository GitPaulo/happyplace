import type { DataPoint, BoundingBox } from "@happyplace/shared";

const DB_NAME = "happyplace";
const DB_VERSION = 1;
const STORE_TILES = "data_tiles";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface TileEntry {
  key: string;
  sourceId: string;
  data: DataPoint[];
  timestamp: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_TILES)) {
        db.createObjectStore(STORE_TILES, { keyPath: ["key", "sourceId"] });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function compositeKey(tileKey: string, sourceId: string): [string, string] {
  return [tileKey, sourceId];
}

export async function getCachedTile(tileKey: string, sourceId: string): Promise<DataPoint[] | null> {
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_TILES, "readonly");
      const store = tx.objectStore(STORE_TILES);
      const req = store.get(compositeKey(tileKey, sourceId));
      req.onsuccess = () => {
        const entry = req.result as TileEntry | undefined;
        if (!entry) return resolve(null);
        if (Date.now() - entry.timestamp > TTL_MS) return resolve(null);
        resolve(entry.data);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function setCachedTile(tileKey: string, sourceId: string, data: DataPoint[]): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_TILES, "readwrite");
    const store = tx.objectStore(STORE_TILES);
    store.put({ key: tileKey, sourceId, data, timestamp: Date.now() } satisfies TileEntry);
  } catch {
    // cache write failure is non-fatal
  }
}

const TILE_SIZE_DEG = 0.05;

export interface Tile {
  key: string;
  bounds: BoundingBox;
}

export function getTilesForBounds(bounds: BoundingBox): Tile[] {
  const tiles: Tile[] = [];
  const startLat = Math.floor(bounds.south / TILE_SIZE_DEG) * TILE_SIZE_DEG;
  const startLng = Math.floor(bounds.west / TILE_SIZE_DEG) * TILE_SIZE_DEG;

  for (let lat = startLat; lat < bounds.north; lat += TILE_SIZE_DEG) {
    for (let lng = startLng; lng < bounds.east; lng += TILE_SIZE_DEG) {
      const key = `${lat.toFixed(4)}_${lng.toFixed(4)}`;
      tiles.push({
        key,
        bounds: {
          south: lat,
          west: lng,
          north: lat + TILE_SIZE_DEG,
          east: lng + TILE_SIZE_DEG,
        },
      });
    }
  }
  return tiles;
}
