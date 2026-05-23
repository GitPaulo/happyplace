import type { BoundingBox, DataPoint, GridCell } from "@happyplace/shared";
import type { DataSource, ScoringContext } from "@happyplace/shared";
import { distanceKm } from "../overpass.js";
import { getCommunesForBounds, type CommuneInfo } from "./communes.js";
import { resilientJson } from "../../utils/resilient-fetch.js";

const TABULAR_API = "https://tabular-api.data.gouv.fr/api/resources";
const DVF_STATS_RESOURCE_ID = "851d342f-9c96-41c1-924a-11a7a7aae8a6";

export class RealEstateSource implements DataSource {
  id = "realestate";
  name = "Real Estate Prices";
  description = "Median apartment/house prices from official DVF open data";
  defaultWeight = 2;
  category = "other" as const;
  country = "FR" as const;

  async fetchData(bounds: BoundingBox): Promise<DataPoint[]> {
    const communes = await getCommunesForBounds(bounds);
    if (communes.length === 0) return [];

    const communeMap = new Map<string, CommuneInfo>();
    for (const c of communes) communeMap.set(c.code, c);

    const codes = communes.map((c) => c.code).join(",");

    const url = `${TABULAR_API}/${DVF_STATS_RESOURCE_ID}/data/?page_size=${communes.length + 5}&code_geo__in=${codes}&echelle_geo__exact=commune`;
    const json = await resilientJson<any>(url, {
      label: "[realestate]",
      timeoutMs: 20000,
      maxRetries: 3,
    });
    if (!json) return [];
    const rows = json.data ?? [];

    const results: DataPoint[] = [];
    for (const row of rows) {
      const code = row.code_geo as string;
      const commune = communeMap.get(code);
      if (!commune) continue;

      const medianApt = row.med_prix_m2_whole_appartement as number | null;
      const medianHouse = row.med_prix_m2_whole_maison as number | null;
      const medianAll = row.med_prix_m2_whole_apt_maison as number | null;
      const nbSales = row.nb_ventes_whole_apt_maison as number | null;

      const pricePerSqm = medianApt ?? medianAll ?? medianHouse;
      if (pricePerSqm == null) continue;

      console.log(`[realestate] ${code} ${commune.name}: ${pricePerSqm} EUR/m² (${nbSales ?? "?"} sales)`);
      results.push({
        lat: commune.lat,
        lng: commune.lng,
        type: "property",
        metadata: { pricePerSqm, nbSales: nbSales ?? 0, label: commune.name },
      });
    }

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
      const ppsm = point.metadata.pricePerSqm as number;
      if (!ppsm || ppsm <= 0) continue;

      if (d < nearest) {
        nearest = d;
        nearestLabel = (point.metadata.label as string) ?? "";
      }
      if (d < 5) {
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
      100 * Math.exp(-avgPrice / 6000)
    )));

    const details = `~${Math.round(avgPrice).toLocaleString()} EUR/m² median (${nearestLabel || "area"})`;
    return { score, details };
  }
}
