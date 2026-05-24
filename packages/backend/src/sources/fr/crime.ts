import type { BoundingBox, DataPoint, GridCell } from "@happyplace/shared";
import type { DataSource, ScoringContext } from "@happyplace/shared";
import { distanceKm } from "../overpass.js";
import { getCommunesForBounds, type CommuneInfo } from "./communes.js";
import { resilientJson } from "../../utils/resilient-fetch.js";

const TABULAR_API = "https://tabular-api.data.gouv.fr/api/resources";
const CRIME_RESOURCE_ID = "44ef4323-1097-48d5-8719-3c544b55d294";

const SAFETY_INDICATORS = [
  "Vols violents sans arme",
  "Vols avec armes",
  "Violences physiques hors cadre familial",
  "Violences physiques intrafamiliales",
  "Violences sexuelles",
  "Vols sans violence contre des personnes",
  "Cambriolages de logement",
  "Destructions et dégradations volontaires",
];

export class CrimeSource implements DataSource {
  id = "crime";
  name = "Crime Rate";
  description = "Crime rates from French Ministry of Interior (SSMSI) open data";
  defaultWeight = 25;
  category = "safety" as const;
  country = "FR" as const;
  weightMode = "penalty" as const;

  async fetchData(bounds: BoundingBox): Promise<DataPoint[]> {
    const communes = await getCommunesForBounds(bounds);
    if (communes.length === 0) return [];

    const communeMap = new Map<string, CommuneInfo>();
    for (const c of communes) communeMap.set(c.code, c);

    const codes = communes.map((c) => c.code).join(",");
    const pageSize = 200;

    let rows = await this.fetchBatch(codes, 2024, pageSize);
    if (rows.length === 0) {
      rows = await this.fetchBatch(codes, 2023, pageSize);
    }

    const byCommune = new Map<string, any[]>();
    for (const row of rows) {
      const code = row.CODGEO_2025 as string;
      if (!byCommune.has(code)) byCommune.set(code, []);
      byCommune.get(code)!.push(row);
    }

    const results: DataPoint[] = [];
    for (const [code, communeRows] of byCommune) {
      const commune = communeMap.get(code);
      if (!commune) continue;

      let compositeRate = 0;
      for (const row of communeRows) {
        const indicator = row.indicateur as string;
        const rate = row.taux_pour_mille as number | null;
        if (rate != null && SAFETY_INDICATORS.includes(indicator)) {
          compositeRate += rate;
        }
      }

      console.log(`[crime] ${code} ${commune.name}: composite rate=${compositeRate.toFixed(1)}/1000`);
      results.push({
        lat: commune.lat,
        lng: commune.lng,
        type: "crime_zone",
        metadata: { rate: compositeRate, label: commune.name },
      });
    }

    return results;
  }

  private async fetchBatch(codes: string, year: number, pageSize: number): Promise<any[]> {
    const allRows: any[] = [];
    let page = 1;
    while (true) {
      const url = `${TABULAR_API}/${CRIME_RESOURCE_ID}/data/?page_size=${pageSize}&page=${page}&CODGEO_2025__in=${codes}&annee__exact=${year}`;
      const json = await resilientJson<any>(url, {
        label: "[crime]",
        timeoutMs: 20000,
        maxRetries: 3,
      });
      if (!json) break;
      const rows = json.data ?? [];
      allRows.push(...rows);
      const total = json.meta?.total ?? 0;
      if (allRows.length >= total || rows.length < pageSize) break;
      page++;
    }
    return allRows;
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
