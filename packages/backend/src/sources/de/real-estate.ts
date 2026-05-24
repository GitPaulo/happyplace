import type { BoundingBox, DataPoint, GridCell } from "@happyplace/shared";
import type { DataSource, ScoringContext } from "@happyplace/shared";
import { distanceKm } from "../overpass.js";
import { getKreiseForBounds } from "./geocode.js";
import { getRealEstateData } from "./data-store.js";

export class RealEstateSource implements DataSource {
  id = "realestate";
  name = "Real Estate Prices";
  description = "Average property prices per m² from empirica-regio / Von Poll (2024)";
  defaultWeight = 3.5;
  category = "other" as const;
  country = "DE" as const;

  async fetchData(bounds: BoundingBox): Promise<DataPoint[]> {
    const kreise = await getKreiseForBounds(bounds);
    if (kreise.length === 0) return [];

    const priceData = getRealEstateData();
    const results: DataPoint[] = [];
    for (const kreis of kreise) {
      const entry = priceData[kreis.kreisKey];
      if (!entry) continue;

      console.log(`[de-realestate] ${entry.name} (${kreis.kreisKey}): ${entry.pricePerSqm} EUR/m²`);
      results.push({
        lat: kreis.lat,
        lng: kreis.lng,
        type: "property",
        metadata: { pricePerSqm: entry.pricePerSqm, label: entry.name },
      });
    }

    console.log(`[de-realestate] ${results.length} price points from ${kreise.length} Kreise`);
    return results;
  }

  scoreCell(cell: GridCell, data: DataPoint[], _ctx: ScoringContext): { score: number; details: string } {
    if (data.length === 0) {
      return { score: 50, details: "No real estate data available" };
    }

    let nearest = Infinity;
    let nearestLabel = "";
    let weightedPriceSum = 0;
    let weightSum = 0;

    for (const point of data) {
      const d = distanceKm(cell.centerLat, cell.centerLng, point.lat, point.lng);
      const price = point.metadata.pricePerSqm as number;
      if (!price || price <= 0) continue;

      if (d < nearest) {
        nearest = d;
        nearestLabel = (point.metadata.label as string) ?? "";
      }
      if (d < 10) {
        const w = 1 / (d + 0.1);
        weightedPriceSum += price * w;
        weightSum += w;
      }
    }

    if (weightSum === 0) {
      return { score: 50, details: "No price data nearby" };
    }

    const avgPrice = weightedPriceSum / weightSum;

    const score = Math.max(0, Math.min(100, Math.round(
      100 * Math.exp(-avgPrice / 6000)
    )));

    const details = `~${Math.round(avgPrice).toLocaleString()} EUR/m² (${nearestLabel || "area"})`;
    return { score, details };
  }
}
