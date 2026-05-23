import type { BoundingBox, DataPoint, GridCell } from "@happyplace/shared";
import type { DataSource, ScoringContext } from "@happyplace/shared";
import { queryOverpass, distanceKm, proximityScore, densityScore } from "./overpass.js";

const WALK_RADIUS_KM = 5;
const CAR_RADIUS_KM = 15;

export class HospitalSource implements DataSource {
  id = "hospital" as const;
  name = "Hospitals";
  description = "Hospitals and clinics nearby";
  defaultWeight = 1;
  category = "amenities" as const;

  async fetchData(bounds: BoundingBox): Promise<DataPoint[]> {
    return queryOverpass(
      bounds,
      `node["amenity"~"hospital|clinic"]({{bbox}});way["amenity"~"hospital|clinic"]({{bbox}});`
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
      // Still check if there's anything at all in the data, just far away
      if (nearest < Infinity) {
        const nearestKm = nearest.toFixed(1);
        return { score: Math.max(5, Math.round(20 * Math.exp(-nearest / 15))), details: `Nearest hospital ${nearestKm}km away` };
      }
      return { score: 0, details: "No hospitals found in area" };
    }

    // Having at least 1 hospital reachable is already very good
    // Closer is better but even 5km away on foot is fine
    const base = 70;
    const proxBonus = proximityScore(nearest, radius) * 0.20;
    const densBonus = Math.min(10, (countNearby - 1) * 3);
    const score = Math.min(100, Math.round(base + proxBonus + densBonus));

    const nearestM = nearest < 1 ? `${Math.round(nearest * 1000)}m` : `${nearest.toFixed(1)}km`;
    const details = `${countNearby} hospital${countNearby > 1 ? "s" : ""} within ${radius}km, nearest ${nearestM}`;
    return { score, details };
  }
}
