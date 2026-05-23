import type { BoundingBox, CellScore, DataPoint, ScoresResponse } from "@happyplace/shared";
import type { DataSource, SourceCategory, ScoringContext } from "@happyplace/shared";
import { generateGrid, expandBounds } from "./grid.js";
import {
  getTilesForBounds,
  getCachedTile,
  setCachedTile,
  getCachedCellScore,
  setCachedCellScoreBatch,
  getCacheStats,
  type Tile,
  type CellScoreEntry,
} from "./cache.js";
import { GrocerySource, TransportSource, EducationSource } from "./sources/amenities.js";
import { HospitalSource, PharmacySource, DoctorSource } from "./sources/health.js";
import { PoliceSource } from "./sources/police.js";
import { CrimeSource } from "./sources/crime.js";
import { RealEstateSource } from "./sources/real-estate.js";
import { PopulationDensitySource } from "./sources/population.js";

export interface SourceStreamEvent {
  sourceId: string;
  sourceName: string;
  category: SourceCategory;
  weight: number;
  cells: Record<string, { score: number; details: string; hasData: boolean }>;
  points?: { lat: number; lng: number; type: string }[];
}

class ScoringEngine {
  private sources: DataSource[] = [];

  register(source: DataSource): void {
    this.sources.push(source);
  }

  async computeScoresStream(
    bounds: BoundingBox,
    weightOverrides: Record<string, number> = {},
    ctx: ScoringContext = { hasCar: false },
    onSourceReady: (event: SourceStreamEvent) => void,
  ): Promise<void> {
    const cells = generateGrid(bounds);
    const expanded = expandBounds(bounds);
    const tiles = getTilesForBounds(expanded);
    const cacheKey = ctx.hasCar ? "car" : "walk";

    await Promise.all(
      this.sources.map(async (source) => {
        const weight = weightOverrides[source.id] ?? source.defaultWeight;
        const data = await this.getDataForTiles(source, tiles);
        const scoreBatch: CellScoreEntry[] = [];
        const cellResults: Record<string, { score: number; details: string; hasData: boolean }> = {};

        for (const cell of cells) {
          const cellScoreId = `${cell.id}:${cacheKey}`;
          const cached = getCachedCellScore(cellScoreId, source.id);

          if (cached) {
            cellResults[cell.id] = {
              score: cached.score,
              details: cached.details,
              hasData: cached.hasData,
            };
          } else {
            const hasData = data.length > 0;
            const result = source.scoreCell(cell, data, ctx);
            cellResults[cell.id] = { score: result.score, details: result.details, hasData };
            scoreBatch.push({
              cellId: cellScoreId,
              sourceId: source.id,
              score: result.score,
              details: result.details,
              hasData,
            });
          }
        }

        if (scoreBatch.length > 0) {
          setCachedCellScoreBatch(scoreBatch);
        }

        const event: SourceStreamEvent = {
          sourceId: source.id,
          sourceName: source.name,
          category: source.category,
          weight,
          cells: cellResults,
        };

        // Include POI locations for sources with physical markers
        const poiSources = ["grocery", "transport", "education", "hospital", "police", "pharmacy", "doctor"];
        if (poiSources.includes(source.id)) {
          event.points = data.map((p) => ({ lat: p.lat, lng: p.lng, type: p.type }));
        }

        onSourceReady(event);
      })
    );

    const stats = getCacheStats();
    console.log(`[cache] DB: ${stats.dataTiles} tiles, ${stats.cellScores} cell scores`);
  }

  private async getDataForTiles(source: DataSource, tiles: Tile[]): Promise<DataPoint[]> {
    const allPoints: DataPoint[] = [];
    const missingTiles: Tile[] = [];

    for (const tile of tiles) {
      const cached = getCachedTile(tile.key, source.id);
      if (cached) {
        allPoints.push(...cached);
      } else {
        missingTiles.push(tile);
      }
    }

    if (missingTiles.length === 0) {
      console.log(`[${source.id}] all ${tiles.length} tiles cached (${allPoints.length} points)`);
      return allPoints;
    }

    console.log(`[${source.id}] ${tiles.length - missingTiles.length}/${tiles.length} tiles cached, fetching ${missingTiles.length} from API`);

    if (missingTiles.length === 1) {
      try {
        const fetched = await source.fetchData(missingTiles[0].bounds);
        setCachedTile(missingTiles[0].key, source.id, fetched);
        allPoints.push(...fetched);
      } catch (err) {
        console.warn(`[${source.id}] fetch failed:`, (err as Error).message);
      }
    } else {
      const merged: BoundingBox = {
        south: Math.min(...missingTiles.map((t) => t.bounds.south)),
        west: Math.min(...missingTiles.map((t) => t.bounds.west)),
        north: Math.max(...missingTiles.map((t) => t.bounds.north)),
        east: Math.max(...missingTiles.map((t) => t.bounds.east)),
      };

      try {
        const fetched = await source.fetchData(merged);

        const tilePoints = new Map<string, DataPoint[]>();
        for (const tile of missingTiles) {
          tilePoints.set(tile.key, []);
        }

        for (const point of fetched) {
          for (const tile of missingTiles) {
            const b = tile.bounds;
            if (point.lat >= b.south && point.lat < b.north &&
                point.lng >= b.west && point.lng < b.east) {
              tilePoints.get(tile.key)!.push(point);
              break;
            }
          }
        }

        for (const tile of missingTiles) {
          const pts = tilePoints.get(tile.key)!;
          setCachedTile(tile.key, source.id, pts);
        }

        allPoints.push(...fetched);
      } catch (err) {
        console.warn(`[${source.id}] fetch failed:`, (err as Error).message);
      }
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
scoringEngine.register(new CrimeSource());
scoringEngine.register(new RealEstateSource());
scoringEngine.register(new PopulationDensitySource());
