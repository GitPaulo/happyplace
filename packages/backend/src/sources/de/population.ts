import type { BoundingBox, DataPoint, GridCell } from "@happyplace/shared";
import type { DataSource, ScoringContext } from "@happyplace/shared";
import { distanceKm } from "../overpass.js";
import { getMunicipalitiesForBounds } from "./geocode.js";

export class PopulationDensitySource implements DataSource {
  id = "population";
  name = "Population Density";
  description = "Population density from Gemeindeverzeichnis (municipality level)";
  defaultWeight = 1;
  category = "other" as const;
  country = "DE" as const;

  async fetchData(bounds: BoundingBox): Promise<DataPoint[]> {
    const municipalities = await getMunicipalitiesForBounds(bounds);
    if (municipalities.length === 0) return [];

    const results: DataPoint[] = [];
    for (const m of municipalities) {
      results.push({
        lat: m.lat,
        lng: m.lng,
        type: "density",
        metadata: {
          density: m.density,
          name: m.name,
          kreisKey: m.kreisKey,
        },
      });
    }

    console.log(`[de-population] ${results.length} density points from ${municipalities.length} municipalities`);
    return results;
  }

  scoreCell(cell: GridCell, data: DataPoint[], _ctx: ScoringContext): { score: number; details: string } {
    if (data.length === 0) {
      return { score: 50, details: "No population data available" };
    }

    let weightedDensity = 0;
    let weightSum = 0;

    for (const point of data) {
      const d = distanceKm(cell.centerLat, cell.centerLng, point.lat, point.lng);
      const density = point.metadata.density as number;
      if (d < 5) {
        const w = 1 / (d + 0.1);
        weightedDensity += density * w;
        weightSum += w;
      }
    }

    if (weightSum === 0) {
      return { score: 50, details: "No density data nearby" };
    }

    const avgDensity = weightedDensity / weightSum;

    let score: number;
    const ideal = 5000;
    if (avgDensity <= ideal) {
      score = Math.min(100, (avgDensity / ideal) * 100);
      if (avgDensity < 200) score = Math.max(15, score);
    } else {
      const excess = avgDensity - ideal;
      score = Math.max(0, 100 - (excess / 200));
    }

    score = Math.max(0, Math.min(100, Math.round(score)));
    const densityStr = avgDensity >= 1000
      ? `${(avgDensity / 1000).toFixed(1)}k`
      : Math.round(avgDensity).toString();
    const details = `${densityStr} residents/km²`;
    return { score, details };
  }
}
