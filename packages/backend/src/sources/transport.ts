import type { BoundingBox, DataPoint, GridCell } from "@happyplace/shared";
import type { DataSource, ScoringContext } from "@happyplace/shared";
import { queryOverpass, distanceKm, proximityScore, densityScore } from "./overpass.js";

const WALK_RADIUS_KM = 0.8;
const CAR_RADIUS_KM = 5;

export class TransportSource implements DataSource {
  id = "transport" as const;
  name = "Public Transport";
  description = "Bus, tram, metro stops and route diversity nearby";
  defaultWeight = 1;
  category = "amenities" as const;

  async fetchData(bounds: BoundingBox): Promise<DataPoint[]> {
    return queryOverpass(
      bounds,
      `node["public_transport"="stop_position"]({{bbox}});node["highway"="bus_stop"]({{bbox}});node["railway"="station"]({{bbox}});node["railway"="tram_stop"]({{bbox}});node["station"="subway"]({{bbox}});`
    );
  }

  scoreCell(cell: GridCell, data: DataPoint[], ctx: ScoringContext): { score: number; details: string } {
    const radius = ctx.hasCar ? CAR_RADIUS_KM : WALK_RADIUS_KM;
    let nearest = Infinity;
    let countNearby = 0;
    const modesNearby = new Set<string>();

    for (const point of data) {
      const d = distanceKm(cell.centerLat, cell.centerLng, point.lat, point.lng);
      if (d < nearest) nearest = d;
      if (d <= radius) {
        countNearby++;
        const mode = categorizeTransportMode(point);
        if (mode) modesNearby.add(mode);
      }
    }

    const mode = ctx.hasCar ? "drive" : "walk";
    if (countNearby === 0) {
      return { score: 0, details: `No transit stops within 10 min ${mode}` };
    }

    // 1 stop reachable = decent base, mode diversity and density add bonuses
    const base = 60;
    const proxBonus = proximityScore(nearest, radius) * 0.1;
    const densBonus = Math.min(15, countNearby);
    const modeBonus = modesNearby.size * 5;
    const score = Math.min(100, Math.round(base + proxBonus + densBonus + modeBonus));

    const modes = [...modesNearby].join(", ") || "transit";
    const nearestM = Math.round(nearest * 1000);
    const details = `${countNearby} stops within 10 min ${mode} (${modes}), nearest ${nearestM}m`;
    return { score, details };
  }
}

function categorizeTransportMode(point: DataPoint): string | null {
  const tags = point.metadata as Record<string, string>;
  if (tags.station === "subway" || tags.railway === "station") return "metro";
  if (tags.railway === "tram_stop") return "tram";
  if (tags.highway === "bus_stop" || tags.bus === "yes") return "bus";
  if (tags.public_transport === "stop_position") return "transit";
  return null;
}
