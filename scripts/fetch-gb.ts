#!/usr/bin/env npx tsx
/**
 * Fetches UK country-specific data and outputs static JSON files
 * to packages/frontend/public/data/gb/.
 *
 * Run: npx tsx scripts/fetch-gb.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sleep } from "./helpers.js";

const OUT_DIR = resolve(import.meta.dirname ?? ".", "../packages/frontend/public/data/gb");
const USER_AGENT = "HappyPlace/1.0 (data-gen)";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchJson<T>(url: string, retries = 3, delayMs = 2000): Promise<T | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(20_000),
      });
      if (resp.status === 404) return null;
      if (!resp.ok) {
        if (resp.status === 429 || resp.status >= 500) {
          if (attempt < retries) {
            const wait = delayMs * (attempt + 1);
            console.warn(`  [retry] ${resp.status} for ${url}, waiting ${wait}ms`);
            await sleep(wait);
            continue;
          }
        }
        console.warn(`  [error] ${resp.status} ${resp.statusText} — ${url}`);
        return null;
      }
      return (await resp.json()) as T;
    } catch (err: any) {
      if (attempt < retries) {
        console.warn(`  [retry] ${err.message} — ${url}`);
        await sleep(delayMs * (attempt + 1));
        continue;
      }
      console.warn(`  [fail] ${err.message} — ${url}`);
      return null;
    }
  }
  return null;
}

async function runBatched<T, R>(
  items: T[],
  concurrency: number,
  delayMs: number,
  fn: (item: T) => Promise<R>,
): Promise<(R | null)[]> {
  const results: (R | null)[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (item) => {
        try {
          return await fn(item);
        } catch {
          return null;
        }
      }),
    );
    results.push(...batchResults);
    if (i + concurrency < items.length) {
      await sleep(delayMs);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Grid generation — fine enough to hit every UK district
// ---------------------------------------------------------------------------

interface GridPoint {
  lat: number;
  lng: number;
}

function generateUKGrid(latStep = 0.12, lngStep = 0.18): GridPoint[] {
  const points: GridPoint[] = [];
  for (let lat = 49.9; lat <= 60.9; lat += latStep) {
    for (let lng = -8.0; lng <= 1.8; lng += lngStep) {
      points.push({ lat: +lat.toFixed(3), lng: +lng.toFixed(3) });
    }
  }
  return points;
}

// ---------------------------------------------------------------------------
// Postcodes.io: bulk reverse geocode grid → admin districts
// ---------------------------------------------------------------------------

interface DistrictInfo {
  name: string;
  lat: number;
  lng: number;
}

async function resolveDistricts(): Promise<Map<string, DistrictInfo>> {
  console.log("\n=== Resolving admin districts via postcodes.io (bulk) ===");
  const grid = generateUKGrid();
  console.log(`  Grid points: ${grid.length}`);

  const districts = new Map<string, DistrictInfo>();
  const BULK_SIZE = 100;

  for (let i = 0; i < grid.length; i += BULK_SIZE) {
    const batch = grid.slice(i, i + BULK_SIZE);
    const geolocations = batch.map((p) => ({
      longitude: p.lng,
      latitude: p.lat,
      limit: 1,
    }));

    try {
      const resp = await fetch("https://api.postcodes.io/postcodes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT,
        },
        body: JSON.stringify({ geolocations }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!resp.ok) {
        console.warn(`  [bulk] HTTP ${resp.status} at batch ${i}`);
        await sleep(2000);
        continue;
      }

      const data = await resp.json() as any;
      for (const entry of data?.result ?? []) {
        const r = entry?.result?.[0];
        if (!r?.admin_district) continue;
        const name = r.admin_district as string;
        if (!districts.has(name)) {
          districts.set(name, { name, lat: r.latitude, lng: r.longitude });
        }
      }
    } catch (err) {
      console.warn(`  [bulk] Error at batch ${i}: ${(err as Error).message}`);
    }

    if ((i / BULK_SIZE) % 10 === 0 && i > 0) {
      console.log(`  Progress: ${i}/${grid.length} points, ${districts.size} districts so far`);
    }
    await sleep(200);
  }

  console.log(`  Unique districts: ${districts.size}`);
  return districts;
}

// ---------------------------------------------------------------------------
// Crime data from data.police.uk
// ---------------------------------------------------------------------------

interface CrimeEntry {
  name: string;
  lat: number;
  lng: number;
  rate: number;
}

function getLatestCrimeMonth(): string {
  const now = new Date();
  now.setMonth(now.getMonth() - 3);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

async function fetchCrimeData(
  districts: Map<string, DistrictInfo>,
): Promise<Record<string, CrimeEntry>> {
  console.log("\n=== Fetching crime data from data.police.uk ===");
  const month = getLatestCrimeMonth();
  console.log(`  Using month: ${month}`);

  const entries = [...districts.values()];
  const result: Record<string, CrimeEntry> = {};
  let fetched = 0;

  const crimeResults = await runBatched(entries, 2, 1000, async (d) => {
    const url = `https://data.police.uk/api/crimes-street/all-crime?lat=${d.lat.toFixed(4)}&lng=${d.lng.toFixed(4)}&date=${month}`;
    const data = await fetchJson<any[]>(url);
    fetched++;
    if (fetched % 20 === 0) {
      console.log(`  Progress: ${fetched}/${entries.length}`);
    }
    if (!data || !Array.isArray(data)) return null;
    return { district: d, count: data.length };
  });

  for (const cr of crimeResults) {
    if (!cr) continue;
    const estPopulation = 4000;
    const rate = +(((cr.count / estPopulation) * 1000).toFixed(1));
    result[cr.district.name] = {
      name: cr.district.name,
      lat: cr.district.lat,
      lng: cr.district.lng,
      rate,
    };
    console.log(`  ${cr.district.name}: ${cr.count} crimes, rate=${rate}/1000`);
  }

  console.log(`  Total districts with crime data: ${Object.keys(result).length}`);
  return result;
}

// ---------------------------------------------------------------------------
// Real estate data from UKHPI (Land Registry)
// ---------------------------------------------------------------------------

interface RealEstateEntry {
  name: string;
  lat: number;
  lng: number;
  pricePerSqm: number;
}

function toSlug(adminDistrict: string): string {
  return adminDistrict
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/&/g, "and")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

function getLatestUKHPIMonth(): string {
  const now = new Date();
  now.setMonth(now.getMonth() - 4);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

async function fetchRealEstateData(
  districts: Map<string, DistrictInfo>,
): Promise<Record<string, RealEstateEntry>> {
  console.log("\n=== Fetching real estate data from UKHPI ===");
  const month = getLatestUKHPIMonth();
  const prevMonth = (() => {
    const d = new Date(month + "-01");
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  })();
  console.log(`  Trying months: ${month}, ${prevMonth}`);

  const entries = [...districts.entries()];
  const result: Record<string, RealEstateEntry> = {};
  let fetched = 0;

  const AVG_HOUSE_SIZE_SQM = 90;

  const realEstateResults = await runBatched(entries, 3, 500, async ([name, info]) => {
    const slug = toSlug(name);
    fetched++;
    if (fetched % 20 === 0) {
      console.log(`  Progress: ${fetched}/${entries.length}`);
    }

    for (const m of [month, prevMonth]) {
      const url = `https://landregistry.data.gov.uk/data/ukhpi/region/${slug}/month/${m}.json`;
      const data = await fetchJson<any>(url, 2, 1000);
      const pt = data?.result?.primaryTopic;
      if (pt?.averagePrice) {
        return { name, info, avgPrice: pt.averagePrice as number };
      }
    }
    return null;
  });

  for (const r of realEstateResults) {
    if (!r) continue;
    const pricePerSqm = Math.round(r.avgPrice / AVG_HOUSE_SIZE_SQM);
    result[r.name] = {
      name: r.name,
      lat: r.info.lat,
      lng: r.info.lng,
      pricePerSqm,
    };
    console.log(`  ${r.name}: £${Math.round(r.avgPrice).toLocaleString()} → ~${pricePerSqm} GBP/m²`);
  }

  console.log(`  Total districts with price data: ${Object.keys(result).length}`);
  return result;
}

// ---------------------------------------------------------------------------
// Population data via postcodes.io LSOAs + Nomis Census 2021 density (NM_2026_1)
// ---------------------------------------------------------------------------

interface PopulationOutput {
  name: string;
  lat: number;
  lng: number;
  density: number;
}

async function fetchPopulationData(
  districts: Map<string, DistrictInfo>,
): Promise<Record<string, PopulationOutput>> {
  console.log("\n=== Fetching population density via LSOA sampling ===");

  // Step 1: For each district, get an LSOA code via postcodes.io
  const districtLsoas = new Map<string, string[]>();
  const entries = [...districts.entries()];

  const lsoaResults = await runBatched(entries, 5, 500, async ([name, info]) => {
    const url = `https://api.postcodes.io/postcodes?lon=${info.lng}&lat=${info.lat}&limit=5`;
    const data = await fetchJson<any>(url);
    const results = data?.result ?? [];
    const lsoas: string[] = [];
    for (const r of results) {
      if (r?.lsoa) {
        const code = r.codes?.lsoa ?? r.lsoa_code;
        if (code && typeof code === "string" && code.startsWith("E")) {
          lsoas.push(code);
        }
      }
    }
    return { name, lsoas };
  });

  const allLsoaCodes: string[] = [];
  for (const r of lsoaResults) {
    if (!r || r.lsoas.length === 0) continue;
    districtLsoas.set(r.name, r.lsoas);
    allLsoaCodes.push(...r.lsoas);
  }

  console.log(`  Districts with LSOAs: ${districtLsoas.size}, total LSOAs: ${allLsoaCodes.length}`);

  // Step 2: Fetch density from Nomis NM_2026_1 (Census 2021 TS006) in batches
  const densityByLsoa = new Map<string, number>();
  const BATCH = 25;
  for (let i = 0; i < allLsoaCodes.length; i += BATCH) {
    const batch = allLsoaCodes.slice(i, i + BATCH);
    const geoParam = batch.join(",");
    const url = `https://www.nomisweb.co.uk/api/v01/dataset/NM_2026_1.data.json?geography=${geoParam}&select=GEOGRAPHY_CODE,OBS_VALUE&measures=20100`;
    const data = await fetchJson<any>(url, 2, 3000);
    if (data?.obs && Array.isArray(data.obs)) {
      for (const obs of data.obs) {
        const code = obs.geography?.geogcode;
        const density = obs.obs_value?.value;
        if (code && typeof density === "number") {
          densityByLsoa.set(code, density);
        }
      }
    }
    await sleep(500);
  }

  console.log(`  LSOAs with density data: ${densityByLsoa.size}`);

  // Step 3: Average density per district
  const result: Record<string, PopulationOutput> = {};
  for (const [name, info] of districts) {
    const lsoas = districtLsoas.get(name) ?? [];
    const densities = lsoas.map((l) => densityByLsoa.get(l)).filter((d): d is number => d != null);
    if (densities.length === 0) continue;
    const avgDensity = densities.reduce((a, b) => a + b, 0) / densities.length;
    result[name] = {
      name,
      lat: info.lat,
      lng: info.lng,
      density: Math.round(avgDensity * 100) / 100,
    };
  }

  console.log(`  Districts with density: ${Object.keys(result).length}`);
  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== GB Data Fetch Script ===");
  console.log(`Output directory: ${OUT_DIR}`);
  mkdirSync(OUT_DIR, { recursive: true });

  const districts = await resolveDistricts();

  const [crimeData, realEstateData, populationData] = await Promise.all([
    fetchCrimeData(districts),
    fetchRealEstateData(districts),
    fetchPopulationData(districts),
  ]);

  writeFileSync(resolve(OUT_DIR, "crime.json"), JSON.stringify(crimeData));
  console.log(`\n✓ Wrote crime.json (${Object.keys(crimeData).length} districts)`);

  writeFileSync(resolve(OUT_DIR, "realestate.json"), JSON.stringify(realEstateData));
  console.log(`✓ Wrote realestate.json (${Object.keys(realEstateData).length} districts)`);

  writeFileSync(resolve(OUT_DIR, "population.json"), JSON.stringify(populationData));
  console.log(`✓ Wrote population.json (${Object.keys(populationData).length} authorities)`);

  console.log("\n=== Done ===");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
