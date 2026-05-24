import type { BoundingBox, DataPoint, GridCell } from "@happyplace/shared";
import type { DataSource, ScoringContext } from "@happyplace/shared";
import { distanceKm } from "../overpass.js";
import { resilientJson } from "../../utils/resilient-fetch.js";
import { getPostcodesForBounds } from "./postcodes.js";

const API_BASE = "https://data.police.uk/api";

interface AreaCrime {
  lat: number;
  lng: number;
  totalCrimes: number;
  population: number;
  label: string;
}

function getLatestMonth(): string {
  const now = new Date();
  now.setMonth(now.getMonth() - 3);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export class CrimeSource implements DataSource {
  id = "crime";
  name = "Crime Rate";
  description = "Crime rates from data.police.uk (per 1000 inhabitants)";
  defaultWeight = 25;
  category = "safety" as const;
  country = "GB" as const;

  async fetchData(bounds: BoundingBox): Promise<DataPoint[]> {
    const postcodes = await getPostcodesForBounds(bounds);
    if (postcodes.length === 0) return [];

    // Group by admin district to aggregate crime at local authority level
    // (mirrors the FR commune-level approach)
    const districts = new Map<string, { lat: number; lng: number; label: string }>();
    for (const pc of postcodes) {
      if (!pc.adminDistrict) continue;
      if (!districts.has(pc.adminDistrict)) {
        districts.set(pc.adminDistrict, { lat: pc.lat, lng: pc.lng, label: pc.adminDistrict });
      }
    }

    const results: DataPoint[] = [];
    const month = getLatestMonth();
    const entries = [...districts.values()];

    // Low concurrency to stay under 15 req/s rate limit
    const MAX_CONCURRENCY = 2;
    for (let i = 0; i < entries.length; i += MAX_CONCURRENCY) {
      const batch = entries.slice(i, i + MAX_CONCURRENCY);
      const fetched = await Promise.all(
        batch.map((d) => this.fetchCrimesForArea(d.lat, d.lng, month))
      );
      for (let j = 0; j < batch.length; j++) {
        const crimeCount = fetched[j];
        if (crimeCount === null) continue;

        // Estimate rate per 1000 inhabitants.
        // Average LSOA population is ~1700. The API returns crimes within ~1 mile
        // (~2.6 km²), covering roughly 2-4 LSOAs, so ~4000 people.
        const estPopulation = 4000;
        const rate = (crimeCount / estPopulation) * 1000;

        console.log(`[gb-crime] ${batch[j].label}: ${crimeCount} crimes, est. rate=${rate.toFixed(1)}/1000`);
        results.push({
          lat: batch[j].lat,
          lng: batch[j].lng,
          type: "crime_zone",
          metadata: { rate, label: batch[j].label },
        });
      }
    }

    console.log(`[gb-crime] ${results.length} crime data points from ${districts.size} districts`);
    return results;
  }

  private async fetchCrimesForArea(lat: number, lng: number, month: string): Promise<number | null> {
    const url = `${API_BASE}/crimes-street/all-crime?lat=${lat.toFixed(4)}&lng=${lng.toFixed(4)}&date=${month}`;
    const data = await resilientJson<any[]>(url, {
      label: "[gb-crime]",
      timeoutMs: 20000,
      maxRetries: 3,
      baseDelayMs: 5000,
    });
    if (!data || !Array.isArray(data)) return null;
    return data.length;
  }

  scoreCell(cell: GridCell, data: DataPoint[], _ctx: ScoringContext): { score: number; details: string } {
    if (data.length === 0) {
      return { score: 50, details: "No crime data available" };
    }

    // Same scoring logic as FR crime source: distance-weighted rate, exp(-rate/40)
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
