import type { BoundingBox } from "@happyplace/shared";
import { resilientJson } from "../../utils/resilient-fetch.js";

export interface PostcodeInfo {
  postcode: string;
  lat: number;
  lng: number;
  lsoa: string;
  msoa: string;
  adminDistrict: string;
}

const pcCache = new Map<string, PostcodeInfo | null>();

async function reverseGeocode(lat: number, lng: number): Promise<PostcodeInfo | null> {
  const key = `${lat.toFixed(3)}_${lng.toFixed(3)}`;
  if (pcCache.has(key)) return pcCache.get(key)!;

  const url = `https://api.postcodes.io/postcodes?lon=${lng}&lat=${lat}&limit=1`;
  const data = await resilientJson<any>(url, {
    label: "[postcodes.io]",
    timeoutMs: 8000,
    maxRetries: 3,
    baseDelayMs: 1000,
  });

  if (!data?.result?.[0]) {
    pcCache.set(key, null);
    return null;
  }

  const r = data.result[0];
  const info: PostcodeInfo = {
    postcode: r.postcode,
    lat: r.latitude,
    lng: r.longitude,
    lsoa: r.lsoa ?? "",
    msoa: r.msoa ?? "",
    adminDistrict: r.admin_district ?? "",
  };
  pcCache.set(key, info);
  return info;
}

export async function getPostcodesForBounds(bounds: BoundingBox): Promise<PostcodeInfo[]> {
  const points: { lat: number; lng: number }[] = [];
  const step = 0.015;
  for (let lat = bounds.south; lat <= bounds.north; lat += step) {
    for (let lng = bounds.west; lng <= bounds.east; lng += step) {
      points.push({ lat, lng });
    }
  }

  const results: PostcodeInfo[] = [];
  const seenPostcodes = new Set<string>();

  const MAX_CONCURRENCY = 5;
  for (let i = 0; i < points.length; i += MAX_CONCURRENCY) {
    const batch = points.slice(i, i + MAX_CONCURRENCY);
    const fetched = await Promise.all(
      batch.map((p) => reverseGeocode(p.lat, p.lng))
    );
    for (const info of fetched) {
      if (info && !seenPostcodes.has(info.postcode)) {
        seenPostcodes.add(info.postcode);
        results.push(info);
      }
    }
  }

  return results;
}

export async function getLsoasForBounds(bounds: BoundingBox): Promise<{ lsoa: string; lat: number; lng: number; adminDistrict: string }[]> {
  const postcodes = await getPostcodesForBounds(bounds);
  const seenLsoas = new Map<string, { lsoa: string; lat: number; lng: number; adminDistrict: string }>();

  for (const pc of postcodes) {
    if (pc.lsoa && !seenLsoas.has(pc.lsoa)) {
      seenLsoas.set(pc.lsoa, {
        lsoa: pc.lsoa,
        lat: pc.lat,
        lng: pc.lng,
        adminDistrict: pc.adminDistrict,
      });
    }
  }

  return [...seenLsoas.values()];
}
