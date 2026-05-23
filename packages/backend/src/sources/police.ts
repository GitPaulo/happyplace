import type { BoundingBox, DataPoint, GridCell } from "@happyplace/shared";
import type { DataSource, ScoringContext } from "@happyplace/shared";
import { queryOverpass, distanceKm, proximityScore, densityScore } from "./overpass.js";

const WALK_RADIUS_KM = 5;
const CAR_RADIUS_KM = 15;

export class PoliceSource implements DataSource {
  id = "police" as const;
  name = "Police Stations";
  description = "Police stations and gendarmeries nearby";
  defaultWeight = 0.8;
  category = "safety" as const;

  async fetchData(bounds: BoundingBox): Promise<DataPoint[]> {
    return queryOverpass(
      bounds,
      `node["amenity"="police"]({{bbox}});way["amenity"="police"]({{bbox}});`
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

    if (countNearby === 0) {
      if (nearest < Infinity) {
        const nearestKm = nearest.toFixed(1);
        return { score: Math.max(5, Math.round(20 * Math.exp(-nearest / 15))), details: `Nearest police station ${nearestKm}km away` };
      }
      return { score: 0, details: "No police stations found in area" };
    }

    const base = 70;
    const proxBonus = proximityScore(nearest, radius) * 0.20;
    const densBonus = Math.min(10, (countNearby - 1) * 4);
    const score = Math.min(100, Math.round(base + proxBonus + densBonus));

    const nearestM = nearest < 1 ? `${Math.round(nearest * 1000)}m` : `${nearest.toFixed(1)}km`;
    const details = `${countNearby} station${countNearby > 1 ? "s" : ""} within ${radius}km, nearest ${nearestM}`;
    return { score, details };
  }
}
