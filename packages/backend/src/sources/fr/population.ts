import type { BoundingBox, DataPoint, GridCell } from "@happyplace/shared";
import type { DataSource, ScoringContext } from "@happyplace/shared";
import { distanceKm } from "../overpass.js";
import { getCommunesForBounds, type CommuneInfo } from "./communes.js";
import { resilientJson } from "../../utils/resilient-fetch.js";

const GEO_API = "https://geo.api.gouv.fr";

interface CommuneDensity {
  code: string;
  name: string;
  lat: number;
  lng: number;
  population: number;
  surfaceKm2: number;
  density: number;
}

export class PopulationDensitySource implements DataSource {
  id = "population";
  name = "Population Density";
  description = "Population density from INSEE commune data";
  defaultWeight = 1;
  category = "other" as const;
  country = "FR" as const;

  async fetchData(bounds: BoundingBox): Promise<DataPoint[]> {
    const communes = await getCommunesForBounds(bounds);
    if (communes.length === 0) return [];

    const densityData = await this.fetchDensities(communes);
    return densityData.map((d) => ({
      lat: d.lat,
      lng: d.lng,
      type: "population_zone",
      metadata: {
        density: d.density,
        population: d.population,
        surfaceKm2: d.surfaceKm2,
        label: d.name,
      },
    }));
  }

  private async fetchDensities(communes: CommuneInfo[]): Promise<CommuneDensity[]> {
    const results: CommuneDensity[] = [];
    const parisArrCodes = communes.filter((c) => c.code.startsWith("751"));
    const otherCodes = communes.filter((c) => !c.code.startsWith("751"));

    if (parisArrCodes.length > 0) {
      const url = `${GEO_API}/communes?type=arrondissement-municipal&codeParent=75056&fields=nom,population,surface`;
      const data = await resilientJson<any[]>(url, {
        label: "[population]",
        timeoutMs: 10000,
        maxRetries: 3,
      });
      if (data) {
        const byCode = new Map<string, any>();
        for (const d of data) byCode.set(d.code, d);

        for (const c of parisArrCodes) {
          const info = byCode.get(c.code);
          if (info && info.population && info.surface > 0) {
            const surfaceKm2 = info.surface / 100;
            const density = info.population / surfaceKm2;
            results.push({
              code: c.code, name: c.name,
              lat: c.lat, lng: c.lng,
              population: info.population, surfaceKm2, density,
            });
            console.log(`[population] ${c.code} ${c.name}: ${Math.round(density)}/km²`);
          }
        }
      }
    }

    const BATCH_SIZE = 10;
    for (let i = 0; i < otherCodes.length; i += BATCH_SIZE) {
      const batch = otherCodes.slice(i, i + BATCH_SIZE);
      const fetched = await Promise.all(
        batch.map((c) => this.fetchSingleCommune(c))
      );
      for (const d of fetched) {
        if (d) results.push(d);
      }
    }

    return results;
  }

  private async fetchSingleCommune(commune: CommuneInfo): Promise<CommuneDensity | null> {
    const url = `${GEO_API}/communes/${commune.code}?fields=nom,population,surface`;
    const data = await resilientJson<any>(url, {
      label: "[population]",
      timeoutMs: 10000,
      maxRetries: 3,
    });
    if (!data || !data.population || !data.surface) return null;

    const surfaceKm2 = data.surface / 100;
    const density = data.population / surfaceKm2;
    console.log(`[population] ${commune.code} ${commune.name}: ${Math.round(density)}/km²`);

    return {
      code: commune.code, name: commune.name,
      lat: commune.lat, lng: commune.lng,
      population: data.population, surfaceKm2, density,
    };
  }

  scoreCell(cell: GridCell, data: DataPoint[], _ctx: ScoringContext): { score: number; details: string } {
    if (data.length === 0) {
      return { score: 50, details: "No population data available" };
    }

    let nearest = Infinity;
    let nearestLabel = "";
    let weightedDensity = 0;
    let weightSum = 0;

    for (const point of data) {
      const d = distanceKm(cell.centerLat, cell.centerLng, point.lat, point.lng);
      const density = point.metadata.density as number;
      if (d < nearest) {
        nearest = d;
        nearestLabel = (point.metadata.label as string) ?? "";
      }
      if (d < 5) {
        const w = 1 / (d + 0.1);
        weightedDensity += density * w;
        weightSum += w;
      }
    }

    if (weightSum === 0) {
      return { score: 50, details: "No nearby population data" };
    }

    const density = weightedDensity / weightSum;

    let score: number;
    if (density < 200) {
      score = 20 + (density / 200) * 30;
    } else if (density < 1000) {
      score = 50 + ((density - 200) / 800) * 35;
    } else if (density <= 5000) {
      score = 85 + ((density - 1000) / 4000) * 15;
      if (density > 3000) score = 100 - ((density - 3000) / 2000) * 10;
    } else if (density <= 15000) {
      score = 90 - ((density - 5000) / 10000) * 50;
    } else {
      score = Math.max(15, 40 - ((density - 15000) / 15000) * 25);
    }

    score = Math.max(0, Math.min(100, Math.round(score)));
    const label = density >= 1000
      ? `${(density / 1000).toFixed(1)}k/km²`
      : `${Math.round(density)}/km²`;
    const details = `Density ~${label} (${nearestLabel || "area"})`;
    return { score, details };
  }
}
