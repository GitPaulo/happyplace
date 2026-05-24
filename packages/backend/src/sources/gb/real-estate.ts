import type { BoundingBox, DataPoint, GridCell } from "@happyplace/shared";
import type { DataSource, ScoringContext } from "@happyplace/shared";
import { distanceKm } from "../overpass.js";
import { resilientJson } from "../../utils/resilient-fetch.js";
import { getPostcodesForBounds } from "./postcodes.js";

const UKHPI_BASE = "https://landregistry.data.gov.uk/data/ukhpi/region";

function toSlug(adminDistrict: string): string {
  return adminDistrict
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/&/g, "and")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

function getLatestMonth(): string {
  const now = new Date();
  now.setMonth(now.getMonth() - 4);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const priceCache = new Map<string, { avgPrice: number; label: string } | null>();

async function fetchRegionPrice(
  slug: string,
  label: string,
): Promise<{ avgPrice: number; label: string } | null> {
  if (priceCache.has(slug)) return priceCache.get(slug)!;

  const month = getLatestMonth();
  const months = [month];
  const d = new Date(month + "-01");
  d.setMonth(d.getMonth() - 1);
  months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);

  for (const m of months) {
    const url = `${UKHPI_BASE}/${slug}/month/${m}.json`;
    const data = await resilientJson<any>(url, {
      label: "[gb-realestate]",
      timeoutMs: 10000,
      maxRetries: 2,
      baseDelayMs: 1000,
    });

    const pt = data?.result?.primaryTopic;
    if (pt?.averagePrice) {
      const result = { avgPrice: pt.averagePrice as number, label };
      console.log(`[gb-realestate] ${label} (${slug}): £${Math.round(result.avgPrice).toLocaleString()}`);
      priceCache.set(slug, result);
      return result;
    }
  }

  priceCache.set(slug, null);
  return null;
}

export class RealEstateSource implements DataSource {
  id = "realestate";
  name = "Real Estate Prices";
  description = "Average house prices from UK House Price Index (UKHPI)";
  defaultWeight = 5;
  category = "other" as const;
  country = "GB" as const;

  async fetchData(bounds: BoundingBox): Promise<DataPoint[]> {
    const postcodes = await getPostcodesForBounds(bounds);
    if (postcodes.length === 0) return [];

    // Group postcodes by admin district to avoid duplicate UKHPI queries
    const districts = new Map<string, { slug: string; lat: number; lng: number; label: string }>();
    for (const pc of postcodes) {
      if (!pc.adminDistrict) continue;
      const slug = toSlug(pc.adminDistrict);
      if (!districts.has(slug)) {
        districts.set(slug, { slug, lat: pc.lat, lng: pc.lng, label: pc.adminDistrict });
      }
    }

    const results: DataPoint[] = [];
    const MAX_CONCURRENCY = 3;
    const entries = [...districts.values()];

    for (let i = 0; i < entries.length; i += MAX_CONCURRENCY) {
      const batch = entries.slice(i, i + MAX_CONCURRENCY);
      const fetched = await Promise.all(
        batch.map((d) => fetchRegionPrice(d.slug, d.label))
      );
      for (let j = 0; j < batch.length; j++) {
        const priceData = fetched[j];
        if (!priceData) continue;
        results.push({
          lat: batch[j].lat,
          lng: batch[j].lng,
          type: "property",
          metadata: {
            avgPrice: priceData.avgPrice,
            label: priceData.label,
          },
        });
      }
    }

    console.log(`[gb-realestate] ${results.length} price points from ${districts.size} districts`);
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
      const price = point.metadata.avgPrice as number;
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

    // Convert total price to estimated price per m² (avg UK house ~90m²)
    // to match FR metric which uses EUR/m²
    const AVG_HOUSE_SIZE_SQM = 90;
    const pricePerSqm = avgPrice / AVG_HOUSE_SIZE_SQM;

    // Same formula as FR: exp(-pricePerSqm / 6000)
    const score = Math.max(0, Math.min(100, Math.round(
      100 * Math.exp(-pricePerSqm / 6000)
    )));

    const details = `~${Math.round(pricePerSqm).toLocaleString()} GBP/m² est. (${nearestLabel || "area"})`;
    return { score, details };
  }
}
