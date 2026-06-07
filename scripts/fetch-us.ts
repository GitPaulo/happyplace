import path from "node:path";
import {
  loadEnv,
  fetchJson,
  fetchText,
  parseCsvLine,
  writeOutputFiles,
} from "./helpers.js";

loadEnv();

const OUT_DIR = path.resolve(
  import.meta.dirname,
  "../packages/frontend/public/data/us"
);

const CENSUS_API_KEY = process.env.CENSUS_API_KEY ?? "";

const TIGERWEB_BASE =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer";
const ZILLOW_ZHVI_URL =
  "https://files.zillowstatic.com/research/public_csvs/zhvi/Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv";

const TYPICAL_HOME_SQM = 150;

// FBI UCR 2023 estimated total crime rates (violent + property) per 1000 population.
// Source: FBI Crime in the United States 2023.
const STATE_CRIME_RATES: Record<string, number> = {
  AL: 27.5, AK: 37.8, AZ: 30.1, AR: 30.9, CA: 27.6,
  CO: 33.2, CT: 14.2, DE: 25.3, DC: 48.7, FL: 22.6,
  GA: 24.8, HI: 24.5, ID: 14.8, IL: 20.5, IN: 22.3,
  IA: 17.1, KS: 23.4, KY: 17.6, LA: 33.5, ME: 11.4,
  MD: 23.1, MA: 13.5, MI: 22.7, MN: 19.8, MS: 26.1,
  MO: 30.3, MT: 22.5, NE: 18.5, NV: 27.4, NH: 9.8,
  NJ: 14.1, NM: 41.2, NY: 18.9, NC: 25.8, ND: 22.6,
  OH: 22.0, OK: 29.8, OR: 29.4, PA: 16.5, RI: 15.6,
  SC: 30.2, SD: 21.4, TN: 29.1, TX: 27.2, UT: 22.8,
  VT: 11.8, VA: 15.4, WA: 31.0, WV: 18.2, WI: 17.3, WY: 15.9,
  PR: 12.1,
};


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ZctaInfo {
  lat: number;
  lng: number;
  landSqKm: number;
}

interface CountyInfo {
  name: string;
  stateAbbr: string;
  lat: number;
  lng: number;
}

// FIPS → state abbreviation mapping (derived from county data)
const FIPS_TO_STATE: Record<string, string> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA",
  "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL",
  "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN",
  "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME",
  "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS",
  "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
  "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND",
  "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI",
  "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT",
  "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI",
  "56": "WY", "72": "PR",
};

// ---------------------------------------------------------------------------
// 1. TIGERweb REST API for geographic data
// ---------------------------------------------------------------------------

async function loadZctaData(): Promise<Map<string, ZctaInfo>> {
  console.log("Loading ZCTA data from TIGERweb…");

  const url = `${TIGERWEB_BASE}/2/query?where=1%3D1&outFields=ZCTA5,INTPTLAT,INTPTLON,AREALAND&returnGeometry=false&f=json&resultRecordCount=100000`;
  const data = await fetchJson<{
    features: { attributes: { ZCTA5: string; INTPTLAT: string; INTPTLON: string; AREALAND: string } }[];
  }>(url);

  const map = new Map<string, ZctaInfo>();
  for (const f of data.features ?? []) {
    const a = f.attributes;
    const lat = Number(a.INTPTLAT);
    const lng = Number(a.INTPTLON);
    const aland = Number(a.AREALAND);
    if (!a.ZCTA5 || isNaN(lat) || isNaN(lng) || isNaN(aland)) continue;
    map.set(a.ZCTA5, { lat, lng, landSqKm: aland / 1_000_000 });
  }

  console.log(`  ${map.size} ZCTAs loaded`);
  return map;
}

async function loadCountyData(): Promise<Map<string, CountyInfo>> {
  console.log("Loading county data from TIGERweb…");

  const url = `${TIGERWEB_BASE}/82/query?where=1%3D1&outFields=GEOID,STATE,NAME,INTPTLAT,INTPTLON&returnGeometry=false&f=json&resultRecordCount=100000`;
  const data = await fetchJson<{
    features: { attributes: { GEOID: string; STATE: string; NAME: string; INTPTLAT: string; INTPTLON: string } }[];
  }>(url);

  const map = new Map<string, CountyInfo>();
  for (const f of data.features ?? []) {
    const a = f.attributes;
    const lat = Number(a.INTPTLAT);
    const lng = Number(a.INTPTLON);
    if (!a.GEOID || isNaN(lat) || isNaN(lng)) continue;
    const stateAbbr = FIPS_TO_STATE[a.STATE] ?? a.STATE;
    map.set(a.GEOID, { name: a.NAME || a.GEOID, stateAbbr, lat, lng });
  }

  console.log(`  ${map.size} counties loaded`);
  return map;
}

// ---------------------------------------------------------------------------
// 2. Real estate — Zillow ZHVI
// ---------------------------------------------------------------------------

async function fetchRealEstateData(
  zctas: Map<string, ZctaInfo>,
): Promise<
  Record<string, { name: string; lat: number; lng: number; pricePerSqm: number }>
> {
  console.log("Downloading Zillow ZHVI CSV…");
  const csv = await fetchText(ZILLOW_ZHVI_URL);
  console.log(
    `  Downloaded ${(csv.length / 1024 / 1024).toFixed(1)} MB CSV`,
  );

  const lines = csv.split("\n");
  const header = parseCsvLine(lines[0]);

  const dateColStart = header.findIndex((h) => /^\d{4}-\d{2}-\d{2}$/.test(h));
  if (dateColStart === -1) throw new Error("No date columns in ZHVI CSV");

  const regionNameIdx = header.indexOf("RegionName");
  const stateNameIdx = header.indexOf("StateName");
  const cityIdx = header.indexOf("City");
  if (regionNameIdx === -1) throw new Error("RegionName column not found");

  const result: Record<
    string,
    { name: string; lat: number; lng: number; pricePerSqm: number }
  > = {};

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCsvLine(line);
    const zip = cols[regionNameIdx]?.trim().padStart(5, "0");
    if (!zip || zip.length !== 5) continue;

    let zhvi = 0;
    for (let j = cols.length - 1; j >= dateColStart; j--) {
      const val = Number(cols[j]);
      if (val > 0) {
        zhvi = val;
        break;
      }
    }
    if (zhvi <= 0) continue;

    const zcta = zctas.get(zip);
    if (!zcta) continue;

    const city = cols[cityIdx] ?? "";
    const state = cols[stateNameIdx] ?? "";
    const name = city && state ? `${city}, ${state}` : zip;

    result[zip] = {
      name,
      lat: zcta.lat,
      lng: zcta.lng,
      pricePerSqm: Math.round(zhvi / TYPICAL_HOME_SQM),
    };
  }

  console.log(`  ${Object.keys(result).length} ZIPs with ZHVI data`);
  return result;
}

// ---------------------------------------------------------------------------
// 3. Population — Census ACS 5-Year
// ---------------------------------------------------------------------------

async function fetchPopulationData(
  zctas: Map<string, ZctaInfo>,
): Promise<
  Record<string, { name: string; lat: number; lng: number; density: number }>
> {
  if (!CENSUS_API_KEY) {
    console.warn("  CENSUS_API_KEY not set — skipping population data");
    return {};
  }

  console.log("Fetching Census ACS population data…");

  let data: string[][] | null = null;

  for (const year of [2023, 2022]) {
    try {
      const url = `https://api.census.gov/data/${year}/acs/acs5?get=NAME,B01003_001E&for=zip%20code%20tabulation%20area:*&key=${CENSUS_API_KEY}`;
      console.log(`  Trying ACS ${year}…`);
      data = await fetchJson<string[][]>(url);
      console.log(`  Got ${data.length - 1} rows from ACS ${year}`);
      break;
    } catch (err) {
      console.warn(`  ACS ${year} failed: ${(err as Error).message}`);
    }
  }

  if (!data || data.length < 2) {
    console.warn("  No ACS data available");
    return {};
  }

  const result: Record<
    string,
    { name: string; lat: number; lng: number; density: number }
  > = {};

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const name = row[0];
    const pop = Number(row[1]);
    const zcta5 = row[2];
    if (!zcta5 || isNaN(pop) || pop <= 0) continue;

    const info = zctas.get(zcta5);
    if (!info || info.landSqKm <= 0) continue;

    const density = pop / info.landSqKm;
    result[zcta5] = {
      name: name || zcta5,
      lat: info.lat,
      lng: info.lng,
      density: Math.round(density * 100) / 100,
    };
  }

  console.log(`  ${Object.keys(result).length} ZCTAs with density`);
  return result;
}

// ---------------------------------------------------------------------------
// 4. Crime — embedded FBI UCR 2023 state rates → mapped to county centroids
// ---------------------------------------------------------------------------

function buildCrimeData(
  counties: Map<string, CountyInfo>,
): Record<string, { name: string; lat: number; lng: number; rate: number }> {
  console.log("Building crime data from UCR 2023 state rates…");

  const result: Record<
    string,
    { name: string; lat: number; lng: number; rate: number }
  > = {};

  for (const [fips, county] of counties) {
    const rate = STATE_CRIME_RATES[county.stateAbbr];
    if (rate == null) continue;
    result[fips] = {
      name: `${county.name}, ${county.stateAbbr}`,
      lat: county.lat,
      lng: county.lng,
      rate,
    };
  }

  console.log(`  ${Object.keys(result).length} counties with crime rate`);
  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== fetch-us: US data generator ===\n");

  const [zctas, counties] = await Promise.all([
    loadZctaData(),
    loadCountyData(),
  ]);

  const crimeData = buildCrimeData(counties);

  const [realEstateData, populationData] = await Promise.all([
    fetchRealEstateData(zctas),
    fetchPopulationData(zctas),
  ]);

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
