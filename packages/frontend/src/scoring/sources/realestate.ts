import type { BoundingBox, DataPoint, GridCell } from "@happyplace/shared";
import type { DataSource, ScoringContext } from "@happyplace/shared";
import { distanceKm } from "../geo";

interface RealEstateEntry {
  name: string;
  lat: number;
  lng: number;
  pricePerSqm?: number;
  avgPrice?: number;
}

type RealEstateData = Record<string, RealEstateEntry>;

const dataCache = new Map<string, RealEstateData>();

async function loadRealEstateData(country: string): Promise<RealEstateData> {
  const cached = dataCache.get(country);
  if (cached) return cached;

  const url = `${import.meta.env.BASE_URL}data/${country.toLowerCase()}/realestate.json`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`[realestate] Failed to load ${url}: ${res.status}`);
    return {};
  }
  const data = await res.json() as RealEstateData;
  dataCache.set(country, data);
  return data;
}

function filterByBounds(data: RealEstateData, bounds: BoundingBox, country: string): DataPoint[] {
  const points: DataPoint[] = [];
  for (const [_key, entry] of Object.entries(data)) {
    if (
      entry.lat >= bounds.south &&
      entry.lat <= bounds.north &&
      entry.lng >= bounds.west &&
      entry.lng <= bounds.east
    ) {
      const pricePerSqm = entry.pricePerSqm ?? (entry.avgPrice ? entry.avgPrice / 90 : 0);
      if (pricePerSqm <= 0) continue;

      points.push({
        lat: entry.lat,
        lng: entry.lng,
        type: "property",
        metadata: {
          pricePerSqm,
          label: entry.name,
          avgPrice: entry.avgPrice,
          country,
        },
      });
    }
  }
  return points;
}

function scoreRealEstateCell(cell: GridCell, data: DataPoint[], country: string): { score: number; details: string } {
  if (data.length === 0) {
    return { score: 50, details: "No real estate data available" };
  }

  let nearest = Infinity;
  let nearestLabel = "";
  let weightedPriceSum = 0;
  let weightSum = 0;
  const searchRadius = country === "GB" || country === "CA" ? 10 : 5;

  for (const point of data) {
    const d = distanceKm(cell.centerLat, cell.centerLng, point.lat, point.lng);
    const ppsm = point.metadata.pricePerSqm as number;
    if (!ppsm || ppsm <= 0) continue;

    if (d < nearest) {
      nearest = d;
      nearestLabel = (point.metadata.label as string) ?? "";
    }
    if (d < searchRadius) {
      const w = 1 / (d + 0.1);
      weightedPriceSum += ppsm * w;
      weightSum += w;
    }
  }

  if (weightSum === 0) {
    return { score: 50, details: "No transactions nearby" };
  }

  const avgPrice = weightedPriceSum / weightSum;
  const score = Math.max(0, Math.min(100, Math.round(
    100 * Math.exp(-avgPrice / 6000),
  )));

  const currencyMap: Record<string, string> = { GB: "GBP", US: "USD", CA: "CAD" };
  const currency = currencyMap[country] ?? "EUR";
  const details = `~${Math.round(avgPrice).toLocaleString()} ${currency}/m² (${nearestLabel || "area"})`;
  return { score, details };
}

function makeRealEstateSource(country: string, description: string, weight: number): DataSource {
  return {
    id: "realestate",
    name: "Real Estate Prices",
    description,
    defaultWeight: weight,
    category: "other",
    country,
    async fetchData(bounds: BoundingBox): Promise<DataPoint[]> {
      const data = await loadRealEstateData(country);
      return filterByBounds(data, bounds, country);
    },
    scoreCell(cell: GridCell, data: DataPoint[], _ctx: ScoringContext) {
      return scoreRealEstateCell(cell, data, country);
    },
  };
}

export const FrRealEstateSource = makeRealEstateSource("FR", "Median prices from DVF open data", 5);
export const GbRealEstateSource = makeRealEstateSource("GB", "Average prices from UK HPI", 5);
export const DeRealEstateSource = makeRealEstateSource("DE", "Prices from empirica-regio / Von Poll (2024)", 3.5);
export const UsRealEstateSource = makeRealEstateSource("US", "Home values from Zillow ZHVI", 5);
export const CaRealEstateSource = makeRealEstateSource("CA", "Average dwelling values from Census 2021", 5);
