import type { BoundingBox, DataPoint, GridCell } from "@happyplace/shared";
import type { DataSource, ScoringContext } from "@happyplace/shared";
import { distanceKm } from "../overpass.js";
import { resilientJson } from "../../utils/resilient-fetch.js";
import { getPostcodesForBounds, type PostcodeInfo } from "./postcodes.js";

const PPD_API = "http://landregistry.data.gov.uk/data/ppi/address";

export class RealEstateSource implements DataSource {
  id = "realestate";
  name = "Real Estate Prices";
  description = "House prices from HM Land Registry Price Paid Data";
  defaultWeight = 2;
  category = "other" as const;
  country = "GB" as const;

  async fetchData(bounds: BoundingBox): Promise<DataPoint[]> {
    const postcodes = await getPostcodesForBounds(bounds);
    if (postcodes.length === 0) return [];

    const results: DataPoint[] = [];
    const MAX_CONCURRENCY = 3;

    for (let i = 0; i < postcodes.length; i += MAX_CONCURRENCY) {
      const batch = postcodes.slice(i, i + MAX_CONCURRENCY);
      const fetched = await Promise.all(
        batch.map((pc) => this.fetchForPostcode(pc))
      );
      for (const points of fetched) {
        results.push(...points);
      }
    }

    console.log(`[gb-realestate] ${results.length} price points from ${postcodes.length} postcodes`);
    return results;
  }

  private async fetchForPostcode(pc: PostcodeInfo): Promise<DataPoint[]> {
    const url = `${PPD_API}?postcode=${encodeURIComponent(pc.postcode)}&_pageSize=50&_sort=-transactionDate`;
    const data = await resilientJson<any>(url, {
      label: "[gb-realestate]",
      timeoutMs: 15000,
      maxRetries: 2,
    });
    if (!data) return [];

    const items = data.result?.items ?? [];
    if (items.length === 0) return [];

    const cutoff = Date.now() - 3 * 365 * 24 * 60 * 60 * 1000;
    const prices: number[] = [];
    for (const item of items) {
      const date = Date.parse(item.transactionDate);
      if (!isNaN(date) && date >= cutoff && item.pricePaid > 0) {
        prices.push(item.pricePaid);
      }
    }

    if (prices.length === 0) return [];

    prices.sort((a, b) => a - b);
    const median = prices[Math.floor(prices.length / 2)];

    console.log(`[gb-realestate] ${pc.postcode}: £${Math.round(median).toLocaleString()} median (${prices.length} sales)`);

    return [{
      lat: pc.lat,
      lng: pc.lng,
      type: "property",
      metadata: {
        priceMedian: median,
        nbSales: prices.length,
        label: pc.postcode,
      },
    }];
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
      const price = point.metadata.priceMedian as number;
      if (!price || price <= 0) continue;

      if (d < nearest) {
        nearest = d;
        nearestLabel = (point.metadata.label as string) ?? "";
      }
      if (d < 5) {
        const w = 1 / (d + 0.1);
        weightedPriceSum += price * w;
        weightSum += w;
      }
    }

    if (weightSum === 0) {
      return { score: 50, details: "No transactions nearby" };
    }

    const avgPrice = weightedPriceSum / weightSum;

    const score = Math.max(0, Math.min(100, Math.round(
      100 * Math.exp(-avgPrice / 550000)
    )));

    const priceStr = avgPrice >= 1_000_000
      ? `£${(avgPrice / 1_000_000).toFixed(1)}M`
      : `£${Math.round(avgPrice / 1000)}k`;
    const details = `${priceStr} median (${nearestLabel || "area"})`;
    return { score, details };
  }
}
