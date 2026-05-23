import type { BoundingBox, DataPoint, GridCell } from "@happyplace/shared";
import type { DataSource, ScoringContext } from "@happyplace/shared";
import { queryOverpass, distanceKm, proximityScore, densityScore } from "./overpass.js";

const WALK_RADIUS_KM = 0.8;
const CAR_RADIUS_KM = 5;

export class GrocerySource implements DataSource {
  id = "grocery" as const;
  name = "Grocery Stores";
  description = "Supermarkets, convenience stores, and grocery shops nearby";
  defaultWeight = 1;
  category = "amenities" as const;

  async fetchData(bounds: BoundingBox): Promise<DataPoint[]> {
    return queryOverpass(
      bounds,
      `node["shop"~"supermarket|convenience|grocery|greengrocer"]({{bbox}});way["shop"~"supermarket|convenience|grocery|greengrocer"]({{bbox}});`
    );
  }

  scoreCell(cell: GridCell, data: DataPoint[], ctx: ScoringContext): { score: number; details: string } {
    const radius = ctx.hasCar ? CAR_RADIUS_KM : WALK_RADIUS_KM;
    let nearest = Infinity;
    let countNearby = 0;

    for (const point of data) {
      const d = distanceKm(cell.centerLat, cell.centerLng, point.lat, point.lng);
      if (d < nearest) nearest = d;
      if (d <= radius) countNearby++;
    }

    const mode = ctx.hasCar ? "drive" : "walk";
    if (countNearby === 0) {
      return { score: 0, details: `No grocery stores within 10 min ${mode}` };
    }

    // 1 store reachable = solid base, more stores add convenience bonus
    const base = 65;
    const proxBonus = proximityScore(nearest, radius) * 0.15;
    const densBonus = Math.min(20, countNearby * 2);
    const score = Math.min(100, Math.round(base + proxBonus + densBonus));

    const nearestM = Math.round(nearest * 1000);
    const details = `${countNearby} store${countNearby > 1 ? "s" : ""} within 10 min ${mode}, nearest ${nearestM}m`;
    return { score, details };
  }
}
