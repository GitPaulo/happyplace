import type { BoundingBox, DataPoint, GridCell } from "@happyplace/shared";
import type { DataSource, ScoringContext } from "@happyplace/shared";
import { queryOverpass } from "./overpass";
import { distanceKm, proximityScore } from "../geo";

const HEALTH_QUERY =
  `node["amenity"~"hospital|clinic|pharmacy|doctors"]({{bbox}});` +
  `way["amenity"~"hospital|clinic|pharmacy|doctors"]({{bbox}});` +
  `node["healthcare"="doctor"]({{bbox}});` +
  `way["healthcare"="doctor"]({{bbox}});`;

const inflight = new Map<string, Promise<DataPoint[]>>();

function boundsKey(b: BoundingBox): string {
  return `${b.south.toFixed(5)},${b.west.toFixed(5)},${b.north.toFixed(5)},${b.east.toFixed(5)}`;
}

async function fetchHealthPOIs(bounds: BoundingBox): Promise<DataPoint[]> {
  const key = boundsKey(bounds);
  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = queryOverpass(bounds, HEALTH_QUERY).finally(() => {
    setTimeout(() => inflight.delete(key), 60_000);
  });
  inflight.set(key, promise);
  return promise;
}

const HOSPITAL_TYPES = new Set(["hospital", "clinic"]);
const PHARMACY_TYPES = new Set(["pharmacy"]);
const DOCTOR_TYPES = new Set(["doctors", "doctor"]);

// ── Hospital Source ──

const HOSPITAL_WALK_KM = 5;
const HOSPITAL_CAR_KM = 15;

export class HospitalSource implements DataSource {
  id = "hospital" as const;
  name = "Hospitals";
  description = "Hospitals and clinics nearby";
  defaultWeight = 1;
  category = "health" as const;

  async fetchData(bounds: BoundingBox): Promise<DataPoint[]> {
    const all = await fetchHealthPOIs(bounds);
    return all.filter((p) => HOSPITAL_TYPES.has(p.type));
  }

  scoreCell(cell: GridCell, data: DataPoint[], ctx: ScoringContext): { score: number; details: string } {
    const radius = ctx.hasCar ? HOSPITAL_CAR_KM : HOSPITAL_WALK_KM;
    let nearest = Infinity;
    let countNearby = 0;

    for (const point of data) {
      const d = distanceKm(cell.centerLat, cell.centerLng, point.lat, point.lng);
      if (d < nearest) nearest = d;
      if (d <= radius) countNearby++;
    }

    if (countNearby === 0) {
      if (nearest < Infinity) {
        return { score: Math.max(5, Math.round(20 * Math.exp(-nearest / 15))), details: `Nearest hospital ${nearest.toFixed(1)}km away` };
      }
      return { score: 0, details: "No hospitals found in area" };
    }

    const base = 70;
    const proxBonus = proximityScore(nearest, radius) * 0.20;
    const densBonus = Math.min(10, (countNearby - 1) * 3);
    const score = Math.min(100, Math.round(base + proxBonus + densBonus));

    const nearestM = nearest < 1 ? `${Math.round(nearest * 1000)}m` : `${nearest.toFixed(1)}km`;
    const details = `${countNearby} hospital${countNearby > 1 ? "s" : ""} within ${radius}km, nearest ${nearestM}`;
    return { score, details };
  }
}

// ── Pharmacy Source ──

const PHARMACY_WALK_KM = 1.5;
const PHARMACY_CAR_KM = 8;

export class PharmacySource implements DataSource {
  id = "pharmacy" as const;
  name = "Pharmacies";
  description = "Pharmacies nearby";
  defaultWeight = 1;
  category = "health" as const;

  async fetchData(bounds: BoundingBox): Promise<DataPoint[]> {
    const all = await fetchHealthPOIs(bounds);
    return all.filter((p) => PHARMACY_TYPES.has(p.type));
  }

  scoreCell(cell: GridCell, data: DataPoint[], ctx: ScoringContext): { score: number; details: string } {
    const radius = ctx.hasCar ? PHARMACY_CAR_KM : PHARMACY_WALK_KM;
    let nearest = Infinity;
    let countNearby = 0;

    for (const point of data) {
      const d = distanceKm(cell.centerLat, cell.centerLng, point.lat, point.lng);
      if (d < nearest) nearest = d;
      if (d <= radius) countNearby++;
    }

    if (countNearby === 0) {
      if (nearest < Infinity) {
        return { score: Math.max(5, Math.round(25 * Math.exp(-nearest / 5))), details: `Nearest pharmacy ${nearest.toFixed(1)}km away` };
      }
      return { score: 0, details: "No pharmacies found in area" };
    }

    const base = 75;
    const proxBonus = proximityScore(nearest, radius) * 0.15;
    const densBonus = Math.min(10, (countNearby - 1) * 2);
    const score = Math.min(100, Math.round(base + proxBonus + densBonus));

    const nearestM = nearest < 1 ? `${Math.round(nearest * 1000)}m` : `${nearest.toFixed(1)}km`;
    const details = `${countNearby} pharmac${countNearby > 1 ? "ies" : "y"} within ${radius}km, nearest ${nearestM}`;
    return { score, details };
  }
}

// ── Doctor Source ──

const DOCTOR_WALK_KM = 2;
const DOCTOR_CAR_KM = 10;

export class DoctorSource implements DataSource {
  id = "doctor" as const;
  name = "Doctors";
  description = "Doctors and medical practices nearby";
  defaultWeight = 1;
  category = "health" as const;

  async fetchData(bounds: BoundingBox): Promise<DataPoint[]> {
    const all = await fetchHealthPOIs(bounds);
    return all.filter((p) => DOCTOR_TYPES.has(p.type));
  }

  scoreCell(cell: GridCell, data: DataPoint[], ctx: ScoringContext): { score: number; details: string } {
    const radius = ctx.hasCar ? DOCTOR_CAR_KM : DOCTOR_WALK_KM;
    let nearest = Infinity;
    let countNearby = 0;

    for (const point of data) {
      const d = distanceKm(cell.centerLat, cell.centerLng, point.lat, point.lng);
      if (d < nearest) nearest = d;
      if (d <= radius) countNearby++;
    }

    if (countNearby === 0) {
      if (nearest < Infinity) {
        return { score: Math.max(5, Math.round(25 * Math.exp(-nearest / 8))), details: `Nearest doctor ${nearest.toFixed(1)}km away` };
      }
      return { score: 0, details: "No doctors found in area" };
    }

    const base = 70;
    const proxBonus = proximityScore(nearest, radius) * 0.15;
    const densBonus = Math.min(15, (countNearby - 1) * 2);
    const score = Math.min(100, Math.round(base + proxBonus + densBonus));

    const nearestM = nearest < 1 ? `${Math.round(nearest * 1000)}m` : `${nearest.toFixed(1)}km`;
    const details = `${countNearby} doctor${countNearby > 1 ? "s" : ""} within ${radius}km, nearest ${nearestM}`;
    return { score, details };
  }
}
