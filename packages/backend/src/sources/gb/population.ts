import type { BoundingBox, DataPoint, GridCell } from "@happyplace/shared";
import type { DataSource, ScoringContext } from "@happyplace/shared";
import { distanceKm } from "../overpass.js";
import { resilientJson } from "../../utils/resilient-fetch.js";
import { getLsoasForBounds } from "./postcodes.js";

const NOMIS_DATASET = "NM_2026_1";

const densityCache = new Map<string, number>();

async function fetchLsoaDensity(lsoaCodes: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const missing: string[] = [];

  for (const code of lsoaCodes) {
    const cached = densityCache.get(code);
    if (cached !== undefined) {
      result.set(code, cached);
    } else {
      missing.push(code);
    }
  }

  if (missing.length === 0) return result;

  const BATCH_SIZE = 25;
  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE);
    const geoParam = batch.join(",");
    const url = `https://www.nomisweb.co.uk/api/v01/dataset/${NOMIS_DATASET}.data.json?geography=${geoParam}&select=GEOGRAPHY_CODE,OBS_VALUE&measures=20100`;

    const data = await resilientJson<any>(url, {
      label: "[gb-population]",
      timeoutMs: 15000,
      maxRetries: 2,
      baseDelayMs: 2000,
    });

    if (data?.obs && Array.isArray(data.obs)) {
      for (const obs of data.obs) {
        const code = obs.geography?.geogcode;
        const density = obs.obs_value?.value;
        if (code && typeof density === "number") {
          densityCache.set(code, density);
          result.set(code, density);
        }
      }
    }
  }

  return result;
}

export class PopulationDensitySource implements DataSource {
  id = "population";
  name = "Population Density";
  description = "Population density from ONS Census 2021 (LSOA level)";
  defaultWeight = 1;
  category = "other" as const;
  country = "GB" as const;

  async fetchData(bounds: BoundingBox): Promise<DataPoint[]> {
    const lsoas = await getLsoasForBounds(bounds);
    if (lsoas.length === 0) return [];

    const lsoaCodes = lsoas.map((l) => l.lsoa);
    const densities = await fetchLsoaDensity(lsoaCodes);

    const results: DataPoint[] = [];
    for (const l of lsoas) {
      const density = densities.get(l.lsoa);
      if (density === undefined) continue;
      results.push({
        lat: l.lat,
        lng: l.lng,
        type: "density",
        metadata: {
          lsoa: l.lsoa,
          density,
          adminDistrict: l.adminDistrict,
        },
      });
    }

    console.log(`[gb-population] ${results.length} density points from ${lsoas.length} LSOAs`);
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
