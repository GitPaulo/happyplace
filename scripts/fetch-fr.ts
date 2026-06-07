import path from "node:path";
import { fetchJson, writeOutputFiles } from "./helpers.js";

const OUT_DIR = path.resolve(
  import.meta.dirname,
  "../packages/frontend/public/data/fr"
);

const CRIME_INDICATORS = [
  "Vols violents sans arme",
  "Vols avec armes",
  "Violences physiques hors cadre familial",
  "Violences physiques intrafamiliales",
  "Violences sexuelles",
  "Vols sans violence contre des personnes",
  "Cambriolages de logement",
  "Destructions et dégradations volontaires",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Paginate through all pages of a tabular-api.data.gouv.fr resource.
 * Returns every row concatenated.
 */
async function fetchAllPages<T = any>(
  baseUrl: string,
  filters: string
): Promise<T[]> {
  const PAGE_SIZE = 200;
  const rows: T[] = [];
  let page = 1;
  let total = Infinity;

  while ((page - 1) * PAGE_SIZE < total) {
    const url = `${baseUrl}?page_size=${PAGE_SIZE}&page=${page}${filters}`;
    const body = await fetchJson<{ data: T[]; meta: { total: number } }>(url);
    total = body.meta.total;
    rows.push(...body.data);

    if (page === 1) console.log(`  Total rows: ${total}`);
    if (page % 50 === 0) console.log(`  Fetched page ${page}/${Math.ceil(total / PAGE_SIZE)}`);
    page++;
  }

  console.log(`  Done — ${rows.length} rows fetched`);
  return rows;
}

// ---------------------------------------------------------------------------
// 1. Communes
// ---------------------------------------------------------------------------

interface CommuneRaw {
  nom: string;
  code: string;
  population?: number;
  surface?: number;
  centre?: { type: string; coordinates: [number, number] };
}

interface CommuneInfo {
  name: string;
  code: string;
  population: number;
  surface: number; // hectares
  lat: number;
  lng: number;
}

async function fetchCommunes(): Promise<Map<string, CommuneInfo>> {
  console.log("Fetching communes…");
  const mainUrl =
    "https://geo.api.gouv.fr/communes?fields=nom,code,population,surface,centre&boost=population";
  const parisUrl =
    "https://geo.api.gouv.fr/communes?type=arrondissement-municipal&codeParent=75056&fields=nom,code,population,surface,centre";

  const [mainData, parisData] = await Promise.all([
    fetchJson<CommuneRaw[]>(mainUrl),
    fetchJson<CommuneRaw[]>(parisUrl),
  ]);

  const map = new Map<string, CommuneInfo>();

  for (const c of [...mainData, ...parisData]) {
    if (!c.centre || c.population == null || c.surface == null) continue;
    map.set(c.code, {
      name: c.nom,
      code: c.code,
      population: c.population,
      surface: c.surface,
      lat: c.centre.coordinates[1],
      lng: c.centre.coordinates[0],
    });
  }

  console.log(`  ${map.size} communes loaded`);
  return map;
}

// ---------------------------------------------------------------------------
// 2. Crime
// ---------------------------------------------------------------------------

interface CrimeRow {
  CODGEO_2025: string;
  indicateur: string;
  taux_pour_mille: number | null;
  annee: number;
}

async function fetchCrime(
  communes: Map<string, CommuneInfo>
): Promise<Record<string, { name: string; lat: number; lng: number; rate: number }>> {
  console.log("Fetching crime data…");

  const baseUrl =
    "https://tabular-api.data.gouv.fr/api/resources/44ef4323-1097-48d5-8719-3c544b55d294/data/";

  // Try 2024 first
  console.log("  Trying year=2024…");
  let rows = await fetchAllPages<CrimeRow>(baseUrl, "&annee__exact=2024");

  if (rows.length === 0) {
    console.log("  No 2024 data, falling back to 2023…");
    rows = await fetchAllPages<CrimeRow>(baseUrl, "&annee__exact=2023");
  }

  // Aggregate: sum taux_pour_mille per commune for the target indicators
  const indicatorSet = new Set(CRIME_INDICATORS);
  const rateByCommune = new Map<string, number>();

  for (const row of rows) {
    if (!indicatorSet.has(row.indicateur)) continue;
    const rate = row.taux_pour_mille ?? 0;
    if (rate <= 0) continue;
    rateByCommune.set(
      row.CODGEO_2025,
      (rateByCommune.get(row.CODGEO_2025) ?? 0) + rate
    );
  }

  const result: Record<string, { name: string; lat: number; lng: number; rate: number }> = {};

  for (const [code, rate] of rateByCommune) {
    if (rate <= 0) continue;
    const c = communes.get(code);
    if (!c) continue;
    result[code] = {
      name: c.name,
      lat: c.lat,
      lng: c.lng,
      rate: Math.round(rate * 100) / 100,
    };
  }

  return result;
}

// ---------------------------------------------------------------------------
// 3. Real estate
// ---------------------------------------------------------------------------

interface RealEstateRow {
  code_geo: string;
  med_prix_m2_whole_appartement: number | null;
  med_prix_m2_whole_apt_maison: number | null;
  med_prix_m2_whole_maison: number | null;
}

async function fetchRealEstate(
  communes: Map<string, CommuneInfo>
): Promise<Record<string, { name: string; lat: number; lng: number; pricePerSqm: number }>> {
  console.log("Fetching real estate data…");

  const baseUrl =
    "https://tabular-api.data.gouv.fr/api/resources/851d342f-9c96-41c1-924a-11a7a7aae8a6/data/";

  const rows = await fetchAllPages<RealEstateRow>(
    baseUrl,
    "&echelle_geo__exact=commune"
  );

  const result: Record<string, { name: string; lat: number; lng: number; pricePerSqm: number }> = {};

  for (const row of rows) {
    const price =
      row.med_prix_m2_whole_appartement ??
      row.med_prix_m2_whole_apt_maison ??
      row.med_prix_m2_whole_maison;
    if (price == null || price <= 0) continue;

    const c = communes.get(row.code_geo);
    if (!c) continue;

    result[row.code_geo] = {
      name: c.name,
      lat: c.lat,
      lng: c.lng,
      pricePerSqm: Math.round(price),
    };
  }

  return result;
}

// ---------------------------------------------------------------------------
// 4. Population density
// ---------------------------------------------------------------------------

function buildPopulation(
  communes: Map<string, CommuneInfo>
): Record<string, { name: string; lat: number; lng: number; density: number }> {
  console.log("Building population density…");

  const result: Record<string, { name: string; lat: number; lng: number; density: number }> = {};

  for (const [code, c] of communes) {
    if (c.population <= 0 || c.surface <= 0) continue;
    const densityKm2 = c.population / (c.surface / 100);
    result[code] = {
      name: c.name,
      lat: c.lat,
      lng: c.lng,
      density: Math.round(densityKm2 * 100) / 100,
    };
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== fetch-fr: French data generator ===\n");

  const communes = await fetchCommunes();

  const [crimeData, realEstateData] = await Promise.all([
    fetchCrime(communes),
    fetchRealEstate(communes),
  ]);

  const populationData = buildPopulation(communes);

  const files: [string, object][] = [
    ["crime.json", crimeData],
    ["realestate.json", realEstateData],
    ["population.json", populationData],
  ];

  writeOutputFiles(OUT_DIR, files);

  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
