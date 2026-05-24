import type { BoundingBox, DataPoint, GridCell } from "@happyplace/shared";
import type { DataSource, ScoringContext } from "@happyplace/shared";
import { distanceKm } from "../geo";

interface CrimeEntry {
  name: string;
  lat: number;
  lng: number;
  rate?: number;
  hz?: number;
}

type CrimeData = Record<string, CrimeEntry>;

const dataCache = new Map<string, CrimeData>();

async function loadCrimeData(country: string): Promise<CrimeData> {
  const cached = dataCache.get(country);
  if (cached) return cached;

  const url = `${import.meta.env.BASE_URL}data/${country.toLowerCase()}/crime.json`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`[crime] Failed to load ${url}: ${res.status}`);
    return {};
  }
  const data = await res.json() as CrimeData;
  dataCache.set(country, data);
  return data;
}

function getRate(entry: CrimeEntry): number {
  if (entry.rate != null) return entry.rate;
  if (entry.hz != null) return entry.hz / 100;
  return 0;
}

function filterByBounds(data: CrimeData, bounds: BoundingBox): DataPoint[] {
  const points: DataPoint[] = [];
  for (const [_key, entry] of Object.entries(data)) {
    if (
      entry.lat >= bounds.south &&
      entry.lat <= bounds.north &&
      entry.lng >= bounds.west &&
      entry.lng <= bounds.east
    ) {
      points.push({
        lat: entry.lat,
        lng: entry.lng,
        type: "crime_zone",
        metadata: { rate: getRate(entry), label: entry.name },
      });
    }
  }
  return points;
}

function scoreCrimeCell(cell: GridCell, data: DataPoint[]): { score: number; details: string } {
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
    100 * Math.exp(-avgRate / 40),
  )));

  const details = `Crime rate ~${avgRate.toFixed(0)}/1000 (${nearestLabel || "area"})`;
  return { score, details };
}

function makeCrimeSource(country: string, description: string, weight: number): DataSource {
  return {
    id: "crime",
    name: "Crime Rate",
    description,
    defaultWeight: weight,
    category: "safety",
    country,
    weightMode: "penalty",
    async fetchData(bounds: BoundingBox): Promise<DataPoint[]> {
      const data = await loadCrimeData(country);
      return filterByBounds(data, bounds);
    },
    scoreCell(cell: GridCell, data: DataPoint[], _ctx: ScoringContext) {
      return scoreCrimeCell(cell, data);
    },
  };
}

export const FrCrimeSource = makeCrimeSource("FR", "Crime rates from French Ministry of Interior (SSMSI)", 25);
export const GbCrimeSource = makeCrimeSource("GB", "Crime rates from data.police.uk (per 1000 inhabitants)", 25);
export const DeCrimeSource = makeCrimeSource("DE", "Crime rates from BKA PKS (per 100k inhabitants)", 4);
