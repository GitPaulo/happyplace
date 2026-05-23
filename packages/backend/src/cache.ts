import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import type { BoundingBox, DataPoint } from "@happyplace/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "data", "cache.db");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

// Drop old schema if it exists without has_data column, then recreate
db.exec(`
  CREATE TABLE IF NOT EXISTS data_tiles (
    tile_key   TEXT NOT NULL,
    source_id  TEXT NOT NULL,
    points     TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    PRIMARY KEY (tile_key, source_id)
  );
`);

// Migrate cell_scores to include has_data
const tableInfo = db.prepare("PRAGMA table_info(cell_scores)").all() as any[];
const hasDataCol = tableInfo.some((c: any) => c.name === "has_data");

if (!hasDataCol && tableInfo.length > 0) {
  db.exec(`DROP TABLE cell_scores;`);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS cell_scores (
    cell_id    TEXT NOT NULL,
    source_id  TEXT NOT NULL,
    score      REAL NOT NULL,
    details    TEXT NOT NULL,
    has_data   INTEGER NOT NULL DEFAULT 1,
    scored_at  INTEGER NOT NULL,
    PRIMARY KEY (cell_id, source_id)
  );
`);

const DATA_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SCORE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ── Tile system ──
const TILE_SIZE = 0.05;

export interface Tile {
  key: string;
  bounds: BoundingBox;
}

export function getTilesForBounds(bounds: BoundingBox): Tile[] {
  const tiles: Tile[] = [];
  const startLat = Math.floor(bounds.south / TILE_SIZE) * TILE_SIZE;
  const startLng = Math.floor(bounds.west / TILE_SIZE) * TILE_SIZE;

  for (let lat = startLat; lat < bounds.north; lat += TILE_SIZE) {
    for (let lng = startLng; lng < bounds.east; lng += TILE_SIZE) {
      tiles.push({
        key: `${lat.toFixed(3)}_${lng.toFixed(3)}`,
        bounds: {
          south: lat,
          west: lng,
          north: lat + TILE_SIZE,
          east: lng + TILE_SIZE,
        },
      });
    }
  }
  return tiles;
}

// ── Data Tile Cache ──

const stmtGetTile = db.prepare(
  `SELECT points, fetched_at FROM data_tiles WHERE tile_key = ? AND source_id = ?`
);

const stmtSetTile = db.prepare(
  `INSERT OR REPLACE INTO data_tiles (tile_key, source_id, points, fetched_at) VALUES (?, ?, ?, ?)`
);

export function getCachedTile(tileKey: string, sourceId: string): DataPoint[] | null {
  const row = stmtGetTile.get(tileKey, sourceId) as any;
  if (!row) return null;
  if (Date.now() - row.fetched_at > DATA_TTL_MS) return null;
  try {
    return JSON.parse(row.points);
  } catch {
    return null;
  }
}

export function setCachedTile(tileKey: string, sourceId: string, points: DataPoint[]): void {
  stmtSetTile.run(tileKey, sourceId, JSON.stringify(points), Date.now());
}

// ── Cell Scores Cache ──

const stmtGetScore = db.prepare(
  `SELECT score, details, has_data, scored_at FROM cell_scores WHERE cell_id = ? AND source_id = ?`
);

const stmtSetScore = db.prepare(
  `INSERT OR REPLACE INTO cell_scores (cell_id, source_id, score, details, has_data, scored_at) VALUES (?, ?, ?, ?, ?, ?)`
);

export interface CachedCellScore {
  score: number;
  details: string;
  hasData: boolean;
}

export function getCachedCellScore(cellId: string, sourceId: string): CachedCellScore | null {
  const row = stmtGetScore.get(cellId, sourceId) as any;
  if (!row) return null;
  if (Date.now() - row.scored_at > SCORE_TTL_MS) return null;
  return { score: row.score, details: row.details, hasData: !!row.has_data };
}

export interface CellScoreEntry {
  cellId: string;
  sourceId: string;
  score: number;
  details: string;
  hasData: boolean;
}

const _batchInsertScores = db.transaction((entries: CellScoreEntry[]) => {
  for (const e of entries) {
    stmtSetScore.run(e.cellId, e.sourceId, e.score, e.details, e.hasData ? 1 : 0, Date.now());
  }
});

export function setCachedCellScoreBatch(entries: CellScoreEntry[]): void {
  _batchInsertScores(entries);
}

// ── Stats ──

const stmtCountTiles = db.prepare(`SELECT COUNT(*) as cnt FROM data_tiles`);
const stmtCountScores = db.prepare(`SELECT COUNT(*) as cnt FROM cell_scores`);

export function getCacheStats(): { dataTiles: number; cellScores: number } {
  return {
    dataTiles: (stmtCountTiles.get() as any).cnt,
    cellScores: (stmtCountScores.get() as any).cnt,
  };
}
