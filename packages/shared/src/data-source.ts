import type { BoundingBox, DataPoint, GridCell } from "./types.js";

export type SourceCategory = "amenities" | "health" | "safety" | "other";

export interface ScoringContext {
  hasCar: boolean;
}

export interface DataSource {
  id: string;
  name: string;
  description: string;
  defaultWeight: number;
  category: SourceCategory;
  /** ISO country code (e.g. "FR", "GB"). Omit for global sources (OSM/Overpass). */
  country?: string;

  fetchData(bounds: BoundingBox): Promise<DataPoint[]>;

  scoreCell(
    cell: GridCell,
    data: DataPoint[],
    ctx: ScoringContext
  ): { score: number; details: string };
}
