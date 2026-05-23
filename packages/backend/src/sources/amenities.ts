import type { BoundingBox, DataPoint, GridCell } from "@happyplace/shared";
import type { DataSource, ScoringContext } from "@happyplace/shared";
import { queryOverpass, distanceKm, proximityScore } from "./overpass.js";

// ── Shared Overpass query for all amenity POIs ──

const AMENITIES_QUERY =
  `node["shop"~"supermarket|convenience|grocery|greengrocer"]({{bbox}});` +
  `way["shop"~"supermarket|convenience|grocery|greengrocer"]({{bbox}});` +
  `node["public_transport"="stop_position"]({{bbox}});` +
  `node["highway"="bus_stop"]({{bbox}});` +
  `node["railway"="station"]({{bbox}});` +
  `node["railway"="tram_stop"]({{bbox}});` +
  `node["station"="subway"]({{bbox}});` +
  `node["amenity"="school"]({{bbox}});` +
  `way["amenity"="school"]({{bbox}});`;

const inflight = new Map<string, Promise<DataPoint[]>>();

function boundsKey(b: BoundingBox): string {
  return `${b.south.toFixed(5)},${b.west.toFixed(5)},${b.north.toFixed(5)},${b.east.toFixed(5)}`;
}

async function fetchAmenityPOIs(bounds: BoundingBox): Promise<DataPoint[]> {
  const key = boundsKey(bounds);
  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = queryOverpass(bounds, AMENITIES_QUERY).finally(() => {
    setTimeout(() => inflight.delete(key), 60_000);
  });
  inflight.set(key, promise);
  return promise;
}

const GROCERY_TYPES = new Set(["supermarket", "convenience", "grocery", "greengrocer"]);
const SCHOOL_TYPES = new Set(["school"]);

function isGrocery(p: DataPoint): boolean {
  return GROCERY_TYPES.has(p.type);
}

function isTransport(p: DataPoint): boolean {
  return !GROCERY_TYPES.has(p.type) && !SCHOOL_TYPES.has(p.type);
}

function isSchool(p: DataPoint): boolean {
  return SCHOOL_TYPES.has(p.type);
}

// ── Grocery Source ──

const GROCERY_WALK_KM = 0.8;
const GROCERY_CAR_KM = 5;

export class GrocerySource implements DataSource {
  id = "grocery" as const;
  name = "Grocery Stores";
  description = "Supermarkets, convenience stores, and grocery shops nearby";
  defaultWeight = 1;
  category = "amenities" as const;

  async fetchData(bounds: BoundingBox): Promise<DataPoint[]> {
    const all = await fetchAmenityPOIs(bounds);
    return all.filter(isGrocery);
  }

  scoreCell(cell: GridCell, data: DataPoint[], ctx: ScoringContext): { score: number; details: string } {
    const radius = ctx.hasCar ? GROCERY_CAR_KM : GROCERY_WALK_KM;
    let nearest = Infinity;
    let countNearby = 0;

    for (const point of data) {
      const d = distanceKm(cell.centerLat, cell.centerLng, point.lat, point.lng);
      if (d < nearest) nearest = d;
      if (d <= radius) countNearby++;
    }

    const mode = ctx.hasCar ? "drive" : "walk";
    if (countNearby === 0) {
      return { score: 0, details: `No grocery stores within 10 min ${mode}` };
    }

    const base = 65;
    const proxBonus = proximityScore(nearest, radius) * 0.15;
    const densBonus = Math.min(20, countNearby * 2);
    const score = Math.min(100, Math.round(base + proxBonus + densBonus));

    const nearestM = Math.round(nearest * 1000);
    const details = `${countNearby} store${countNearby > 1 ? "s" : ""} within 10 min ${mode}, nearest ${nearestM}m`;
    return { score, details };
  }
}

// ── Transport Source ──

const TRANSPORT_WALK_KM = 0.8;
const TRANSPORT_CAR_KM = 5;

export class TransportSource implements DataSource {
  id = "transport" as const;
  name = "Public Transport";
  description = "Bus, tram, metro stops and route diversity nearby";
  defaultWeight = 1;
  category = "amenities" as const;

  async fetchData(bounds: BoundingBox): Promise<DataPoint[]> {
    const all = await fetchAmenityPOIs(bounds);
    return all.filter(isTransport);
  }

  scoreCell(cell: GridCell, data: DataPoint[], ctx: ScoringContext): { score: number; details: string } {
    const radius = ctx.hasCar ? TRANSPORT_CAR_KM : TRANSPORT_WALK_KM;
    let nearest = Infinity;
    let countNearby = 0;
    const modesNearby = new Set<string>();

    for (const point of data) {
      const d = distanceKm(cell.centerLat, cell.centerLng, point.lat, point.lng);
      if (d < nearest) nearest = d;
      if (d <= radius) {
        countNearby++;
        const m = categorizeTransportMode(point);
        if (m) modesNearby.add(m);
      }
    }

    const mode = ctx.hasCar ? "drive" : "walk";
    if (countNearby === 0) {
      return { score: 0, details: `No transit stops within 10 min ${mode}` };
    }

    const base = 60;
    const proxBonus = proximityScore(nearest, radius) * 0.1;
    const densBonus = Math.min(15, countNearby);
    const modeBonus = modesNearby.size * 5;
    const score = Math.min(100, Math.round(base + proxBonus + densBonus + modeBonus));

    const modes = [...modesNearby].join(", ") || "transit";
    const nearestM = Math.round(nearest * 1000);
    const details = `${countNearby} stops within 10 min ${mode} (${modes}), nearest ${nearestM}m`;
    return { score, details };
  }
}

function categorizeTransportMode(point: DataPoint): string | null {
  const tags = point.metadata as Record<string, string>;
  if (tags.station === "subway" || tags.railway === "station") return "metro";
  if (tags.railway === "tram_stop") return "tram";
  if (tags.highway === "bus_stop" || tags.bus === "yes") return "bus";
  if (tags.public_transport === "stop_position") return "transit";
  return null;
}

// ── Education Source ──

const EDUCATION_WALK_KM = 2;
const EDUCATION_CAR_KM = 10;

const SCHOOL_LEVEL_KEYWORDS: Record<string, string[]> = {
  primary: ["primaire", "élémentaire", "elementaire", "maternelle", "primary", "elementary"],
  secondary: ["collège", "college", "secondary", "middle"],
  high: ["lycée", "lycee", "high school"],
};

function classifySchoolLevel(point: DataPoint): string {
  const name = ((point.metadata as Record<string, string>).name ?? "").toLowerCase();
  for (const [level, keywords] of Object.entries(SCHOOL_LEVEL_KEYWORDS)) {
    if (keywords.some((kw) => name.includes(kw))) return level;
  }
  return "unknown";
}

export class EducationSource implements DataSource {
  id = "education" as const;
  name = "Schools";
  description = "Primary, secondary, and high schools nearby";
  defaultWeight = 1;
  category = "amenities" as const;

  async fetchData(bounds: BoundingBox): Promise<DataPoint[]> {
    const all = await fetchAmenityPOIs(bounds);
    return all.filter(isSchool);
  }

  scoreCell(cell: GridCell, data: DataPoint[], ctx: ScoringContext): { score: number; details: string } {
    const radius = ctx.hasCar ? EDUCATION_CAR_KM : EDUCATION_WALK_KM;
    let nearest = Infinity;
    let countNearby = 0;
    const levelsFound = new Set<string>();

    for (const point of data) {
      const d = distanceKm(cell.centerLat, cell.centerLng, point.lat, point.lng);
      if (d < nearest) nearest = d;
      if (d <= radius) {
        countNearby++;
        levelsFound.add(classifySchoolLevel(point));
      }
    }

    if (countNearby === 0) {
      if (nearest < Infinity) {
        return { score: Math.max(5, Math.round(20 * Math.exp(-nearest / 8))), details: `Nearest school ${nearest.toFixed(1)}km away` };
      }
      return { score: 0, details: "No schools found in area" };
    }

    // Reward having at least one school, bonus for covering multiple levels
    const knownLevels = [...levelsFound].filter((l) => l !== "unknown").length;
    const base = 60;
    const proxBonus = proximityScore(nearest, radius) * 0.15;
    const levelBonus = Math.min(25, knownLevels * 10);
    const densBonus = Math.min(5, (countNearby - 1));
    const score = Math.min(100, Math.round(base + proxBonus + levelBonus + densBonus));

    const levelNames = [...levelsFound].filter((l) => l !== "unknown");
    const levelStr = levelNames.length > 0 ? ` (${levelNames.join(", ")})` : "";
    const nearestM = nearest < 1 ? `${Math.round(nearest * 1000)}m` : `${nearest.toFixed(1)}km`;
    const details = `${countNearby} school${countNearby > 1 ? "s" : ""} within ${radius}km${levelStr}, nearest ${nearestM}`;
    return { score, details };
  }
}
