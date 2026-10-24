// 매물 층 정보(정확한 층 또는 네이버의 저/중/고 표기)로 저층·중층·고층·1층·탑층을 판정하고 층 조건과 맞춰 본다

import type { FloorBand, FloorFilter, ListingUnit } from "@/lib/types";

export interface FloorInfo {
  band: FloorBand | null;
  /** null이면 1층인지 알 수 없음(예: 네이버가 "저/15"처럼 올린 매물) */
  first: boolean | null;
  top: boolean | null;
}

const HIDDEN_BANDS: Record<string, FloorBand> = { 저: "low", 중: "mid", 고: "high" };

// 정확한 층은 건물 층수를 3등분해 저·중·고로 나눈다(15층 건물이면 1~5 저층, 6~10 중층, 11~15 고층)
export function floorInfo(u: Pick<ListingUnit, "floorLabel" | "floor" | "totalFloors">): FloorInfo {
  const head = u.floorLabel.split("/")[0]?.trim() ?? "";
  const hidden = HIDDEN_BANDS[head];
  if (hidden) return { band: hidden, first: hidden === "low" ? null : false, top: hidden === "high" ? null : false };
  if (u.floor === null || u.totalFloors === null || u.totalFloors < 1 || u.floor < 1) return { band: null, first: null, top: null };
  const t = u.totalFloors;
  const band: FloorBand = u.floor <= Math.ceil(t / 3) ? "low" : u.floor > Math.floor((2 * t) / 3) ? "high" : "mid";
  return { band, first: u.floor === 1, top: t > 1 && u.floor === t };
}

/** 층을 알 수 없는 매물은 저·중·고를 골랐을 때만 뺀다. 1층·탑층 여부를 모르면 빼지 않는다 */
export function matchesFloors(u: Pick<ListingUnit, "floorLabel" | "floor" | "totalFloors">, f: FloorFilter): boolean {
  if (f.bands.length === 0 && !f.excludeFirst && !f.excludeTop) return true;
  const info = floorInfo(u);
  if (f.bands.length > 0 && (info.band === null || !f.bands.includes(info.band))) return false;
  if (f.excludeFirst && info.first === true) return false;
  if (f.excludeTop && info.top === true) return false;
  return true;
}
