import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import os from "node:os";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const HEADERS = { "User-Agent": "HappyPlace/1.0 (data-gen)" };

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

export function loadEnv(): void {
  const envPath = path.resolve(import.meta.dirname, "../.env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
      const m = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchWithRetry(
  url: string,
  maxRetries = 3
): Promise<ArrayBuffer> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`HTTP ${res.status}`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);

      return await res.arrayBuffer();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      console.log(`  Retry ${attempt + 1}/${maxRetries} in 5s…`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  throw new Error("unreachable");
}

export async function fetchJson<T = any>(url: string, maxRetries = 3): Promise<T> {
  const buf = await fetchWithRetry(url, maxRetries);
  return JSON.parse(Buffer.from(buf).toString("utf-8")) as T;
}

export async function fetchText(url: string, maxRetries = 3): Promise<string> {
  const buf = await fetchWithRetry(url, maxRetries);
  return Buffer.from(buf).toString("utf-8");
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ---------------------------------------------------------------------------
// ZIP download + extraction
// ---------------------------------------------------------------------------

export async function downloadAndExtractZip(
  url: string,
  label: string,
): Promise<string[]> {
  const tmpDir = path.join(os.tmpdir(), `hp_${label}_${Date.now()}`);
  const tmpZip = tmpDir + ".zip";

  console.log(`  Downloading ${url.split("/").pop()}…`);
  const buf = Buffer.from(await fetchWithRetry(url));
  fs.writeFileSync(tmpZip, buf);
  console.log(`  Downloaded ${(buf.byteLength / 1024 / 1024).toFixed(1)} MB`);

  fs.mkdirSync(tmpDir, { recursive: true });
  execSync(`unzip -o "${tmpZip}" -d "${tmpDir}"`, { stdio: "pipe" });
  fs.unlinkSync(tmpZip);

  return fs.readdirSync(tmpDir).map((f) => path.join(tmpDir, f));
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export function writeOutputFiles(
  outDir: string,
  files: [string, object][],
): void {
  fs.mkdirSync(outDir, { recursive: true });

  console.log("\nWriting output files…");
  for (const [name, data] of files) {
    const filePath = path.join(outDir, name);
    const json = JSON.stringify(data);
    fs.writeFileSync(filePath, json);
    const entries = Object.keys(data).length;
    const sizeKb = (Buffer.byteLength(json) / 1024).toFixed(1);
    console.log(`  ${name}: ${entries} entries (${sizeKb} KB)`);
  }
}
