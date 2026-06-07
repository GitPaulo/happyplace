import fs from "node:fs";
import path from "node:path";
import {
  loadEnv,
  sleep,
  fetchWithRetry,
  fetchJson,
  downloadAndExtractZip,
  parseCsvLine,
  writeOutputFiles,
} from "./helpers.js";

loadEnv();

const OUT_DIR = path.resolve(
  import.meta.dirname,
  "../packages/frontend/public/data/ca"
);

const CRIME_CSV_URL =
  "https://www150.statcan.gc.ca/n1/tbl/csv/35100026-eng.zip";

// ---------------------------------------------------------------------------
// CMA geocoding via Photon
// ---------------------------------------------------------------------------

interface GeoResult {
  lat: number;
  lng: number;
}

async function geocodeCma(name: string): Promise<GeoResult | null> {
  const cleanName = name
    .replace(/\s*\[.*?\]\s*/g, "")
    .replace(/\s*\(.*?\)\s*/g, "")
    .split(",")[0]
    .trim();
  const query = encodeURIComponent(`${cleanName}, Canada`);
  const url = `https://photon.komoot.io/api/?q=${query}&limit=1&lang=en`;

  try {
    const data = await fetchJson<{
      features: { geometry: { coordinates: [number, number] } }[];
    }>(url, 2);
    const coords = data.features?.[0]?.geometry?.coordinates;
    if (coords) {
      return { lat: coords[1], lng: coords[0] };
    }
  } catch {
    // ignore
  }
  return null;
}

// ---------------------------------------------------------------------------
// 1. Crime — StatCan Crime Severity Index by CMA
// ---------------------------------------------------------------------------

interface CrimeOutput {
  name: string;
  lat: number;
  lng: number;
  rate: number;
}

function findCol(header: string[], ...candidates: string[]): number {
  for (const c of candidates) {
    const idx = header.findIndex(
      (h) => h.trim().replace(/^\uFEFF/, "") === c,
    );
    if (idx !== -1) return idx;
  }
  return -1;
}

async function fetchCrimeData(): Promise<Record<string, CrimeOutput>> {
  console.log("Fetching StatCan Crime Severity Index…");

  const files = await downloadAndExtractZip(CRIME_CSV_URL, "ca_crime");
  const csvFile = files.find(
    (f) => f.endsWith(".csv") && !f.includes("MetaData"),
  );
  if (!csvFile) throw new Error("No data CSV found in crime ZIP");

  const content = fs.readFileSync(csvFile, "utf-8");
  const lines = content.split("\n");
  const header = parseCsvLine(lines[0]).map((h) =>
    h.trim().replace(/^\uFEFF/, ""),
  );

  const refDateIdx = findCol(header, "REF_DATE");
  const geoIdx = findCol(header, "GEO");
  const statisticsIdx = findCol(header, "Statistics");
  const valueIdx = findCol(header, "VALUE");

  if (refDateIdx === -1 || geoIdx === -1 || valueIdx === -1) {
    throw new Error(`Unexpected CSV header: ${header.join(", ")}`);
  }

  const csiByGeo = new Map<string, { year: number; csi: number }>();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCsvLine(line);

    const refDate = cols[refDateIdx]?.trim();
    const geo = cols[geoIdx]?.trim();
    const stat = cols[statisticsIdx]?.trim();
    const value = Number(cols[valueIdx]?.trim());

    if (!refDate || !geo || isNaN(value)) continue;
    if (stat !== "Crime severity index") continue;
    if (!geo.match(/\[\d+\]/)) continue;

    const year = Number(refDate);
    if (isNaN(year)) continue;

    const existing = csiByGeo.get(geo);
    if (!existing || year > existing.year) {
      csiByGeo.set(geo, { year, csi: value });
    }
  }

  console.log(`  ${csiByGeo.size} CMAs with CSI data`);

  // CSI 100 = 2006 Canadian baseline. Normalize: rate = csi / 3
  // puts national avg (~75 → 25) in a range that works with exp(-rate/40)
  const result: Record<string, CrimeOutput> = {};
  let geocoded = 0;

  for (const [geo, data] of csiByGeo) {
    const coords = await geocodeCma(geo);
    geocoded++;
    if (geocoded % 10 === 0) {
      console.log(`  Geocoded ${geocoded}/${csiByGeo.size} CMAs`);
    }
    await sleep(300);

    if (!coords) {
      console.warn(`  Could not geocode: ${geo}`);
      continue;
    }

    const cleanName = geo
      .replace(/\s*\[.*?\]\s*/g, "")
      .replace(/\s*\(.*?\)\s*/g, "")
      .trim();
    const ratePer1000 = Math.round((data.csi / 3) * 100) / 100;

    result[cleanName] = {
      name: cleanName,
      lat: coords.lat,
      lng: coords.lng,
      rate: ratePer1000,
    };
  }

  console.log(`  ${Object.keys(result).length} CMAs in crime output`);
  return result;
}

// ---------------------------------------------------------------------------
// 2. Population & Real estate — derive from NHPI and CMA metadata
// ---------------------------------------------------------------------------

// Major Canadian CMAs with population (2021 Census) and land area (km²)
const CMA_META: Record<
  string,
  { pop: number; areaSqKm: number; lat: number; lng: number; avgPrice: number }
> = {
  "Toronto, Ontario": { pop: 6202225, areaSqKm: 5905, lat: 43.6532, lng: -79.3832, avgPrice: 1100000 },
  "Montréal, Quebec": { pop: 4291732, areaSqKm: 4604, lat: 45.5017, lng: -73.5673, avgPrice: 530000 },
  "Vancouver, British Columbia": { pop: 2642825, areaSqKm: 2883, lat: 49.2827, lng: -123.1207, avgPrice: 1200000 },
  "Ottawa–Gatineau, Ontario/Quebec": { pop: 1488307, areaSqKm: 6287, lat: 45.4215, lng: -75.6972, avgPrice: 620000 },
  "Calgary, Alberta": { pop: 1481806, areaSqKm: 5110, lat: 51.0447, lng: -114.0719, avgPrice: 550000 },
  "Edmonton, Alberta": { pop: 1418118, areaSqKm: 9427, lat: 53.5461, lng: -113.4938, avgPrice: 400000 },
  "Winnipeg, Manitoba": { pop: 834678, areaSqKm: 5303, lat: 49.8951, lng: -97.1384, avgPrice: 340000 },
  "Québec, Quebec": { pop: 839311, areaSqKm: 3349, lat: 46.8139, lng: -71.2080, avgPrice: 350000 },
  "Hamilton, Ontario": { pop: 785184, areaSqKm: 1372, lat: 43.2557, lng: -79.8711, avgPrice: 780000 },
  "Kitchener–Cambridge–Waterloo, Ontario": { pop: 575847, areaSqKm: 827, lat: 43.4516, lng: -80.4925, avgPrice: 700000 },
  "London, Ontario": { pop: 543551, areaSqKm: 2665, lat: 42.9849, lng: -81.2453, avgPrice: 510000 },
  "Halifax, Nova Scotia": { pop: 465703, areaSqKm: 5496, lat: 44.6488, lng: -63.5752, avgPrice: 440000 },
  "Victoria, British Columbia": { pop: 397237, areaSqKm: 696, lat: 48.4284, lng: -123.3656, avgPrice: 870000 },
  "Oshawa, Ontario": { pop: 415311, areaSqKm: 903, lat: 43.8971, lng: -78.8658, avgPrice: 800000 },
  "Windsor, Ontario": { pop: 422630, areaSqKm: 1023, lat: 42.3149, lng: -83.0364, avgPrice: 440000 },
  "Saskatoon, Saskatchewan": { pop: 317480, areaSqKm: 5193, lat: 52.1332, lng: -106.6700, avgPrice: 350000 },
  "Regina, Saskatchewan": { pop: 249431, areaSqKm: 3408, lat: 50.4452, lng: -104.6189, avgPrice: 320000 },
  "St. John's, Newfoundland and Labrador": { pop: 212579, areaSqKm: 805, lat: 47.5615, lng: -52.7126, avgPrice: 310000 },
  "Barrie, Ontario": { pop: 212856, areaSqKm: 894, lat: 44.3894, lng: -79.6903, avgPrice: 690000 },
  "Kelowna, British Columbia": { pop: 222162, areaSqKm: 2904, lat: 49.8880, lng: -119.4960, avgPrice: 750000 },
  "Abbotsford–Mission, British Columbia": { pop: 195826, areaSqKm: 622, lat: 49.0504, lng: -122.3045, avgPrice: 750000 },
  "Sherbrooke, Quebec": { pop: 227398, areaSqKm: 1445, lat: 45.4042, lng: -71.8929, avgPrice: 300000 },
  "Trois-Rivières, Quebec": { pop: 161858, areaSqKm: 881, lat: 46.3432, lng: -72.5418, avgPrice: 260000 },
  "Guelph, Ontario": { pop: 165588, areaSqKm: 379, lat: 43.5448, lng: -80.2482, avgPrice: 720000 },
  "Moncton, New Brunswick": { pop: 157717, areaSqKm: 2406, lat: 46.0878, lng: -64.7782, avgPrice: 280000 },
  "Brantford, Ontario": { pop: 164580, areaSqKm: 1073, lat: 43.1394, lng: -80.2644, avgPrice: 580000 },
  "Saint John, New Brunswick": { pop: 130613, areaSqKm: 3362, lat: 45.2733, lng: -66.0633, avgPrice: 240000 },
  "Thunder Bay, Ontario": { pop: 123258, areaSqKm: 2556, lat: 48.3809, lng: -89.2477, avgPrice: 280000 },
  "Sudbury, Ontario": { pop: 170614, areaSqKm: 3238, lat: 46.4917, lng: -80.9930, avgPrice: 350000 },
  "Saguenay, Quebec": { pop: 161643, areaSqKm: 1754, lat: 48.4279, lng: -71.0548, avgPrice: 240000 },
  "Peterborough, Ontario": { pop: 127032, areaSqKm: 1507, lat: 44.3091, lng: -78.3197, avgPrice: 550000 },
  "Lethbridge, Alberta": { pop: 123722, areaSqKm: 2975, lat: 49.6935, lng: -112.8418, avgPrice: 330000 },
  "Fredericton, New Brunswick": { pop: 108610, areaSqKm: 5992, lat: 45.9636, lng: -66.6431, avgPrice: 280000 },
  "Kingston, Ontario": { pop: 172546, areaSqKm: 1819, lat: 44.2312, lng: -76.4860, avgPrice: 530000 },
  "Belleville–Quinte West, Ontario": { pop: 111490, areaSqKm: 969, lat: 44.1628, lng: -77.3832, avgPrice: 450000 },
};

function buildPopulationAndRealEstate(): {
  population: Record<string, { name: string; lat: number; lng: number; density: number }>;
  realestate: Record<string, { name: string; lat: number; lng: number; pricePerSqm: number }>;
} {
  console.log("Building population and real estate from CMA metadata…");

  const population: Record<string, { name: string; lat: number; lng: number; density: number }> = {};
  const realestate: Record<string, { name: string; lat: number; lng: number; pricePerSqm: number }> = {};

  const TYPICAL_HOME_SQM = 130;

  for (const [name, meta] of Object.entries(CMA_META)) {
    const shortName = name.split(",")[0].trim();
    const density = meta.pop / meta.areaSqKm;

    population[shortName] = {
      name: shortName,
      lat: meta.lat,
      lng: meta.lng,
      density: Math.round(density * 100) / 100,
    };

    realestate[shortName] = {
      name: shortName,
      lat: meta.lat,
      lng: meta.lng,
      pricePerSqm: Math.round(meta.avgPrice / TYPICAL_HOME_SQM),
    };
  }

  console.log(`  ${Object.keys(population).length} CMAs with population`);
  console.log(`  ${Object.keys(realestate).length} CMAs with real estate`);
  return { population, realestate };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== fetch-ca: Canadian data generator ===\n");

  const crimeData = await fetchCrimeData();
  const censusData = buildPopulationAndRealEstate();

  const files: [string, object][] = [
    ["crime.json", crimeData],
    ["realestate.json", censusData.realestate],
    ["population.json", censusData.population],
  ];

  writeOutputFiles(OUT_DIR, files);

  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
