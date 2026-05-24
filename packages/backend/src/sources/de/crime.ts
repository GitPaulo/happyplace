import type { BoundingBox, DataPoint, GridCell } from "@happyplace/shared";
import type { DataSource, ScoringContext } from "@happyplace/shared";
import { distanceKm } from "../overpass.js";
import { getKreiseForBounds } from "./geocode.js";
import { getCrimeData } from "./data-store.js";

export class CrimeSource implements DataSource {
  id = "crime";
  name = "Crime Rate";
  description = "Crime rates from BKA PKS (Häufigkeitszahl per 100k inhabitants)";
  defaultWeight = 4;
  category = "safety" as const;
  country = "DE" as const;

  async fetchData(bounds: BoundingBox): Promise<DataPoint[]> {
    const kreise = await getKreiseForBounds(bounds);
    if (kreise.length === 0) return [];

    const crimeHzData = getCrimeData();
    const results: DataPoint[] = [];
    for (const kreis of kreise) {
      const entry = crimeHzData[kreis.kreisKey];
      if (!entry) continue;

      const ratePer1k = entry.hz / 100;

      console.log(`[de-crime] ${entry.name} (${kreis.kreisKey}): HZ=${entry.hz}, rate=${ratePer1k.toFixed(1)}/1000`);
      results.push({
        lat: kreis.lat,
        lng: kreis.lng,
        type: "crime_zone",
        metadata: { rate: ratePer1k, label: entry.name },
      });
    }

    console.log(`[de-crime] ${results.length} crime data points from ${kreise.length} Kreise`);
    return results;
  }

  scoreCell(cell: GridCell, data: DataPoint[], _ctx: ScoringContext): { score: number; details: string } {
    if (data.length === 0) {
      return { score: 50, details: "No crime data available" };
    }

    let nearest = Infinity;
    let nearestRate = 0;
    let nearestLabel = "";
    let weightedRateSum = 0;
    let weightSum = 0;

    for (const point of data) {
      const d = distanceKm(cell.centerLat, cell.centerLng, point.lat, point.lng);
      const rate = (point.metadata.rate as number) ?? 0;
      if (d < nearest) {
        nearest = d;
        nearestRate = rate;
        nearestLabel = (point.metadata.label as string) ?? "";
      }
      if (d < 5) {
        const w = 1 / (d + 0.05);
        weightedRateSum += rate * w;
        weightSum += w;
      }
    }

    const avgRate = weightSum > 0 ? weightedRateSum / weightSum : nearestRate;

    const score = Math.max(0, Math.min(100, Math.round(
      100 * Math.exp(-avgRate / 40)
    )));

    const details = `Crime rate ~${avgRate.toFixed(0)}/1000 (${nearestLabel || "area"})`;
    return { score, details };
  }
}
