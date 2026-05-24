import type { BoundingBox, DataPoint, GridCell } from "@happyplace/shared";
import type { DataSource, SourceCategory, ScoringContext } from "@happyplace/shared";
import { generateGrid } from "@happyplace/shared";
import { expandBounds } from "./geo";
import { detectCountries } from "./country";
import { getTilesForBounds, getCachedTile, setCachedTile, type Tile } from "./cache";
import { GrocerySource, TransportSource, EducationSource } from "./sources/amenities";
import { HospitalSource, PharmacySource, DoctorSource } from "./sources/health";
import { PoliceSource } from "./sources/police";
import { FrCrimeSource, GbCrimeSource, DeCrimeSource } from "./sources/crime";
import { FrRealEstateSource, GbRealEstateSource, DeRealEstateSource } from "./sources/realestate";
import { FrPopulationSource, GbPopulationSource, DePopulationSource } from "./sources/population";

export interface SourceStreamEvent {
  sourceId: string;
  sourceName: string;
  category: SourceCategory;
  weight: number;
  weightMode?: "default" | "penalty";
  cells: Record<string, { score: number; details: string; hasData: boolean }>;
  points?: { lat: number; lng: number; type: string }[];
}

const POI_SOURCES = new Set(["grocery", "transport", "education", "hospital", "police", "pharmacy", "doctor"]);

function filterNearby(data: DataPoint[], cell: GridCell, radiusDeg: number): DataPoint[] {
  const latMin = cell.centerLat - radiusDeg;
  const latMax = cell.centerLat + radiusDeg;
  const lngMin = cell.centerLng - radiusDeg;
  const lngMax = cell.centerLng + radiusDeg;
  const result: DataPoint[] = [];
  for (const p of data) {
    if (p.lat >= latMin && p.lat <= latMax && p.lng >= lngMin && p.lng <= lngMax) {
      result.push(p);
    }
  }
  return result;
}

const FILTER_RADIUS_DEG = 0.18;

class ScoringEngine {
  private sources: DataSource[] = [];

  register(source: DataSource): void {
    this.sources.push(source);
  }

  async computeScores(
    bounds: BoundingBox,
    weightOverrides: Record<string, number>,
    ctx: ScoringContext,
    onSourceReady: (event: SourceStreamEvent) => void,
  ): Promise<void> {
    const cells = generateGrid(bounds);
    const expanded = expandBounds(bounds);
    const tiles = getTilesForBounds(expanded);

    const countries = detectCountries(expanded);
    const activeSources = this.sources.filter(
      (s) => !s.country || countries.has(s.country),
    );

    await Promise.all(
      activeSources.map(async (source) => {
        const weight = weightOverrides[source.id] ?? source.defaultWeight;
        const data = await this.getDataForTiles(source, tiles, expanded);

        const isPoi = POI_SOURCES.has(source.id);
        const useFilter = data.length > 500;
        const cellResults: Record<string, { score: number; details: string; hasData: boolean }> = {};

        for (const cell of cells) {
          const nearby = useFilter ? filterNearby(data, cell, FILTER_RADIUS_DEG) : data;
          const hasData = nearby.length > 0 || data.length > 0;
          const result = source.scoreCell(cell, nearby, ctx);
          cellResults[cell.id] = { score: result.score, details: result.details, hasData };
        }

        const event: SourceStreamEvent = {
          sourceId: source.id,
          sourceName: source.name,
          category: source.category,
          weight,
          weightMode: source.weightMode ?? "default",
          cells: cellResults,
        };

        if (isPoi) {
          event.points = data.map((p) => ({ lat: p.lat, lng: p.lng, type: p.type }));
        }

        onSourceReady(event);
      }),
    );
  }

  private async getDataForTiles(source: DataSource, tiles: Tile[], expanded: BoundingBox): Promise<DataPoint[]> {
    // For static sources (crime/realestate/population), skip tile caching -
    // just fetch for the whole expanded bounds since data is already in memory
    if (source.country) {
      return source.fetchData(expanded);
    }

    // Overpass-based sources: use IndexedDB tile cache
    const allPoints: DataPoint[] = [];
    const missingTiles: Tile[] = [];

    for (const tile of tiles) {
      const cached = await getCachedTile(tile.key, source.id);
      if (cached) {
        allPoints.push(...cached);
      } else {
        missingTiles.push(tile);
      }
    }

    if (missingTiles.length === 0) {
      return allPoints;
    }

    const merged: BoundingBox = missingTiles.length === 1
      ? missingTiles[0].bounds
      : {
          south: Math.min(...missingTiles.map((t) => t.bounds.south)),
          west: Math.min(...missingTiles.map((t) => t.bounds.west)),
          north: Math.max(...missingTiles.map((t) => t.bounds.north)),
          east: Math.max(...missingTiles.map((t) => t.bounds.east)),
        };

    try {
      const fetched = await source.fetchData(merged);
      for (const tile of missingTiles) {
        await setCachedTile(tile.key, source.id, fetched);
      }
      allPoints.push(...fetched);
    } catch (err) {
      console.warn(`[${source.id}] fetch failed:`, (err as Error).message);
    }

    return allPoints;
  }
}

export const scoringEngine = new ScoringEngine();

scoringEngine.register(new GrocerySource());
scoringEngine.register(new TransportSource());
scoringEngine.register(new EducationSource());
scoringEngine.register(new HospitalSource());
scoringEngine.register(new PharmacySource());
scoringEngine.register(new DoctorSource());
scoringEngine.register(new PoliceSource());
scoringEngine.register(FrCrimeSource);
scoringEngine.register(GbCrimeSource);
scoringEngine.register(DeCrimeSource);
scoringEngine.register(FrRealEstateSource);
scoringEngine.register(GbRealEstateSource);
scoringEngine.register(DeRealEstateSource);
scoringEngine.register(FrPopulationSource);
scoringEngine.register(GbPopulationSource);
scoringEngine.register(DePopulationSource);
