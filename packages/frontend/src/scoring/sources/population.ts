import type { BoundingBox, DataPoint, GridCell } from "@happyplace/shared";
import type { DataSource, ScoringContext } from "@happyplace/shared";
import { distanceKm } from "../geo";

interface PopulationEntry {
  name: string;
  lat: number;
  lng: number;
  density: number;
}

type PopulationData = Record<string, PopulationEntry>;

const dataCache = new Map<string, PopulationData>();

async function loadPopulationData(country: string): Promise<PopulationData> {
  const cached = dataCache.get(country);
  if (cached) return cached;

  const file = country === "DE" ? "kreise.json" : "population.json";
  const url = `${import.meta.env.BASE_URL}data/${country.toLowerCase()}/${file}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`[population] Failed to load ${url}: ${res.status}`);
    return {};
  }
  const data = await res.json() as PopulationData;
  dataCache.set(country, data);
  return data;
}

function filterByBounds(data: PopulationData, bounds: BoundingBox): DataPoint[] {
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
        type: "density",
        metadata: { density: entry.density, label: entry.name },
      });
    }
  }
  return points;
}

function scoreFrPopulation(cell: GridCell, data: DataPoint[]): { score: number; details: string } {
  if (data.length === 0) {
    return { score: 50, details: "No population data available" };
  }

  let weightedDensity = 0;
  let weightSum = 0;
  let nearestLabel = "";
  let nearest = Infinity;

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

function scoreGbDePopulation(cell: GridCell, data: DataPoint[]): { score: number; details: string } {
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
    score = Math.max(0, 100 - excess / 200);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const densityStr = avgDensity >= 1000
    ? `${(avgDensity / 1000).toFixed(1)}k`
    : Math.round(avgDensity).toString();
  const details = `${densityStr} residents/km²`;
  return { score, details };
}

function makePopulationSource(country: string, description: string): DataSource {
  return {
    id: "population",
    name: "Population Density",
    description,
    defaultWeight: 1,
    category: "other",
    country,
    async fetchData(bounds: BoundingBox): Promise<DataPoint[]> {
      const data = await loadPopulationData(country);
      return filterByBounds(data, bounds);
    },
    scoreCell(cell: GridCell, data: DataPoint[], _ctx: ScoringContext) {
      return country === "FR"
        ? scoreFrPopulation(cell, data)
        : scoreGbDePopulation(cell, data);
    },
  };
}

export const FrPopulationSource = makePopulationSource("FR", "Population density from INSEE commune data");
export const GbPopulationSource = makePopulationSource("GB", "Population density from ONS Census 2021");
export const DePopulationSource = makePopulationSource("DE", "Population density from Gemeindeverzeichnis");
