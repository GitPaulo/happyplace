import type { SourceCategory } from "./data-source.js";

export interface BoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface GridCell {
  id: string;
  south: number;
  west: number;
  north: number;
  east: number;
  centerLat: number;
  centerLng: number;
}

export interface DataPoint {
  lat: number;
  lng: number;
  type: string;
  metadata: Record<string, unknown>;
}

export interface SourceScore {
  sourceId: string;
  sourceName: string;
  score: number;
  details: string;
  hasData: boolean;
  category: SourceCategory;
}

export interface CellScore {
  cell: GridCell;
  score: number;
  breakdown: SourceScore[];
}

export interface ScoresResponse {
  cells: CellScore[];
  sources: { id: string; name: string; weight: number; category: SourceCategory }[];
}
