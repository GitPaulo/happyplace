import { resilientFetch } from "../../utils/resilient-fetch.js";
import { setCrimeData, reload, getLastRefreshTime, type CrimeEntry } from "./data-store.js";

const BKA_XLSX_URL =
  "https://www.bka.de/SharedDocs/Downloads/DE/Publikationen/PolizeilicheKriminalstatistik/2024/Kreis/Faelle/KR-F-01-T01-Kreise-Faelle-HZ_xls.xlsx?__blob=publicationFile&v=4";

const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

let refreshTimer: ReturnType<typeof setInterval> | null = null;

async function fetchAndParseBkaCrime(): Promise<Record<string, CrimeEntry> | null> {
  console.log("[de-refresh] Downloading BKA PKS XLSX...");

  const res = await resilientFetch(BKA_XLSX_URL, {
    label: "[de-refresh]",
    timeoutMs: 60000,
    maxRetries: 2,
    baseDelayMs: 5000,
  });

  if (!res || !res.ok) {
    console.warn("[de-refresh] Failed to download BKA XLSX");
    return null;
  }

  let XLSX: typeof import("xlsx");
  try {
    XLSX = await import("xlsx");
  } catch {
    console.warn("[de-refresh] xlsx package not available, skipping BKA parse");
    return null;
  }

  const buffer = await res.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) {
    console.warn("[de-refresh] BKA XLSX has no sheets");
    return null;
  }

  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const result: Record<string, CrimeEntry> = {};

  for (let i = 9; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 7) continue;
    if (row[1] !== "Straftaten insgesamt") continue;

    const kreisKey = String(row[2] ?? "").trim().padStart(5, "0");
    const name = String(row[3] ?? "").trim();
    const hz = row[6];

    if (!kreisKey || kreisKey.length < 4 || !name || typeof hz !== "number") continue;
    result[kreisKey] = { name, hz: Math.round(hz) };
  }

  if (Object.keys(result).length < 100) {
    console.warn(`[de-refresh] BKA parse returned only ${Object.keys(result).length} entries, skipping update`);
    return null;
  }

  return result;
}

async function runRefresh(): Promise<void> {
  console.log("[de-refresh] Starting data refresh...");

  const newCrime = await fetchAndParseBkaCrime();
  if (newCrime) {
    setCrimeData(newCrime);
    console.log(`[de-refresh] Updated crime data: ${Object.keys(newCrime).length} Kreise`);
  }

  reload();
  console.log("[de-refresh] Refresh complete");
}

export function startPeriodicRefresh(): void {
  if (refreshTimer) return;

  const msSinceLastRefresh = Date.now() - getLastRefreshTime();
  if (msSinceLastRefresh > REFRESH_INTERVAL_MS) {
    runRefresh().catch((e) => console.error("[de-refresh] Error:", e));
  } else {
    console.log(
      `[de-refresh] Data is fresh (${Math.round(msSinceLastRefresh / 3600000)}h old), ` +
      `next refresh in ${Math.round((REFRESH_INTERVAL_MS - msSinceLastRefresh) / 3600000)}h`,
    );
  }

  refreshTimer = setInterval(() => {
    runRefresh().catch((e) => console.error("[de-refresh] Error:", e));
  }, REFRESH_INTERVAL_MS);
}

export function stopPeriodicRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}
