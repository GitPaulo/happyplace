import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../../data");

export interface CrimeEntry {
  name: string;
  hz: number;
}

export interface RealEstateEntry {
  name: string;
  pricePerSqm: number;
}

export interface KreisEntry {
  name: string;
  lat: number;
  lng: number;
  density: number;
}

let crimeData: Record<string, CrimeEntry> = {};
let realEstateData: Record<string, RealEstateEntry> = {};
let kreiseData: Record<string, KreisEntry> = {};
let lastRefresh = 0;

function loadFromDisk(): void {
  try {
    crimeData = JSON.parse(readFileSync(join(DATA_DIR, "de-crime-hz.json"), "utf-8"));
  } catch { crimeData = {}; }

  try {
    realEstateData = JSON.parse(readFileSync(join(DATA_DIR, "de-realestate.json"), "utf-8"));
  } catch { realEstateData = {}; }

  try {
    kreiseData = JSON.parse(readFileSync(join(DATA_DIR, "de-kreise.json"), "utf-8"));
  } catch { kreiseData = {}; }

  lastRefresh = Date.now();
  console.log(
    `[de-data] Loaded ${Object.keys(crimeData).length} crime, ` +
    `${Object.keys(realEstateData).length} realestate, ` +
    `${Object.keys(kreiseData).length} kreise entries`,
  );
}

loadFromDisk();

export function getCrimeData(): Record<string, CrimeEntry> {
  return crimeData;
}

export function getRealEstateData(): Record<string, RealEstateEntry> {
  return realEstateData;
}

export function getKreiseData(): Record<string, KreisEntry> {
  return kreiseData;
}

export function getLastRefreshTime(): number {
  return lastRefresh;
}

export function setCrimeData(data: Record<string, CrimeEntry>): void {
  crimeData = data;
  writeFileSync(join(DATA_DIR, "de-crime-hz.json"), JSON.stringify(data, null, 2));
}

export function reload(): void {
  loadFromDisk();
}
