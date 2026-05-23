import type { BoundingBox, DataPoint, GridCell } from "@happyplace/shared";
import type { DataSource, ScoringContext } from "@happyplace/shared";
import { distanceKm } from "../overpass.js";
import { resilientJson } from "../../utils/resilient-fetch.js";

const API_BASE = "https://data.police.uk/api";

export class CrimeSource implements DataSource {
  id = "crime";
  name = "Crime Rate";
  description = "Street-level crime data from data.police.uk";
  defaultWeight = 2.5;
  category = "safety" as const;
  country = "GB" as const;

  async fetchData(bounds: BoundingBox): Promise<DataPoint[]> {
    const points = this.samplePoints(bounds);
    const seen = new Set<string>();
    const results: DataPoint[] = [];

    const MAX_CONCURRENCY = 3;
    for (let i = 0; i < points.length; i += MAX_CONCURRENCY) {
      const batch = points.slice(i, i + MAX_CONCURRENCY);
      const fetched = await Promise.all(
        batch.map((p) => this.fetchCrimesAt(p.lat, p.lng))
      );
      for (const crimes of fetched) {
        for (const c of crimes) {
          const key = `${c.lat}_${c.lng}_${c.type}`;
          if (seen.has(key)) continue;
          seen.add(key);
          results.push(c);
        }
      }
    }

    console.log(`[gb-crime] ${results.length} crime points from ${points.length} sample locations`);
    return results;
  }

  private samplePoints(bounds: BoundingBox): { lat: number; lng: number }[] {
    const step = 0.02;
    const points: { lat: number; lng: number }[] = [];
    for (let lat = bounds.south; lat <= bounds.north; lat += step) {
      for (let lng = bounds.west; lng <= bounds.east; lng += step) {
        points.push({ lat, lng });
      }
    }
    return points;
  }

  private async fetchCrimesAt(lat: number, lng: number): Promise<DataPoint[]> {
    const url = `${API_BASE}/crimes-street/all-crime?lat=${lat.toFixed(4)}&lng=${lng.toFixed(4)}`;
    const data = await resilientJson<any[]>(url, {
      label: "[gb-crime]",
      timeoutMs: 15000,
      maxRetries: 2,
      baseDelayMs: 2000,
    });
    if (!data || !Array.isArray(data)) return [];

    return data
      .filter((c: any) => c.location?.latitude && c.location?.longitude)
      .map((c: any) => ({
        lat: parseFloat(c.location.latitude),
        lng: parseFloat(c.location.longitude),
        type: "crime_point",
        metadata: { category: c.category },
      }));
  }

  scoreCell(cell: GridCell, data: DataPoint[], _ctx: ScoringContext): { score: number; details: string } {
    if (data.length === 0) {
      return { score: 50, details: "No crime data available" };
    }

    let countNearby = 0;
    for (const point of data) {
      const d = distanceKm(cell.centerLat, cell.centerLng, point.lat, point.lng);
      if (d < 1.5) countNearby++;
    }

    const score = Math.max(0, Math.min(100, Math.round(
      100 * Math.exp(-countNearby / 30)
    )));

    const details = `${countNearby} crime${countNearby !== 1 ? "s" : ""} reported nearby`;
    return { score, details };
  }
}
