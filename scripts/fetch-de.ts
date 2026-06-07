import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { fetchWithRetry, writeOutputFiles } from "./helpers.js";

const OUT_DIR = path.resolve(
  import.meta.dirname,
  "../packages/frontend/public/data/de"
);

const KREISE_PATH = path.resolve(
  import.meta.dirname,
  "data/de-kreise.json"
);

const REALESTATE_PATH = path.resolve(
  import.meta.dirname,
  "data/de-realestate.json"
);

const CRIME_XLSX_URL =
  "https://www.bka.de/SharedDocs/Downloads/DE/Publikationen/PolizeilicheKriminalstatistik/2024/Kreis/Faelle/KR-F-01-T01-Kreise-Faelle-HZ_xls.xlsx?__blob=publicationFile&v=4";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface KreisInfo {
  name: string;
  lat: number;
  lng: number;
  density: number;
}

interface RealEstateEntry {
  name: string;
  pricePerSqm: number;
}

// ---------------------------------------------------------------------------
// 1. Crime data from BKA XLSX
// ---------------------------------------------------------------------------

async function fetchCrimeData(
  kreise: Record<string, KreisInfo>
): Promise<Record<string, { name: string; lat: number; lng: number; hz: number }>> {
  console.log("Downloading BKA PKS 2024 XLSX…");
  const buffer = await fetchWithRetry(CRIME_XLSX_URL);
  console.log(`  Downloaded ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB`);

  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = "T01_Kreise";
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(
      `Sheet "${sheetName}" not found. Available: ${workbook.SheetNames.join(", ")}`
    );
  }

  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const result: Record<string, { name: string; lat: number; lng: number; hz: number }> = {};

  for (let i = 8; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 7) continue;

    const straftat = String(row[1] ?? "").trim();
    if (straftat !== "Straftaten insgesamt") continue;

    const rawKey = String(row[2] ?? "").trim();
    if (!rawKey) continue;
    const kreisKey = rawKey.padStart(5, "0");

    const hz = Number(row[6]);
    if (!hz || isNaN(hz)) continue;

    const kreis = kreise[kreisKey];
    const name = String(row[3] ?? "").trim() || kreis?.name || kreisKey;

    if (kreis) {
      result[kreisKey] = { name, lat: kreis.lat, lng: kreis.lng, hz: Math.round(hz) };
    } else {
      result[kreisKey] = { name, lat: 0, lng: 0, hz: Math.round(hz) };
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// 2. Real estate data
// ---------------------------------------------------------------------------

function buildRealEstateData(
  kreise: Record<string, KreisInfo>
): Record<string, { name: string; lat: number; lng: number; pricePerSqm: number }> {
  console.log("Processing real estate data…");
  const raw: Record<string, RealEstateEntry> = JSON.parse(
    fs.readFileSync(REALESTATE_PATH, "utf-8")
  );

  const result: Record<string, { name: string; lat: number; lng: number; pricePerSqm: number }> = {};

  for (const [key, entry] of Object.entries(raw)) {
    const kreis = kreise[key];
    result[key] = {
      name: entry.name,
      lat: kreis?.lat ?? 0,
      lng: kreis?.lng ?? 0,
      pricePerSqm: entry.pricePerSqm,
    };
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== fetch-de: German data generator ===\n");

  console.log("Loading kreise data…");
  const kreise: Record<string, KreisInfo> = JSON.parse(
    fs.readFileSync(KREISE_PATH, "utf-8")
  );
  console.log(`  ${Object.keys(kreise).length} Kreise loaded`);

  const crimeData = await fetchCrimeData(kreise);
  console.log(`  ${Object.keys(crimeData).length} Kreise with crime data`);

  const realEstateData = buildRealEstateData(kreise);
  console.log(`  ${Object.keys(realEstateData).length} Kreise with real estate data`);

  const files: [string, object][] = [
    ["crime.json", crimeData],
    ["realestate.json", realEstateData],
    ["kreise.json", kreise],
  ];

  writeOutputFiles(OUT_DIR, files);

  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
