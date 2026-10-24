// 단지에서 가장 가까운 지하철·전철역과 거리(역세권 점수용). 역 목록은 지도 노선도와 같은 public/transit/metro-stations.json(OSM)

import { readFileSync } from "node:fs";
import path from "node:path";
import type { GeoPoint } from "@/lib/types";
import { haversineKm } from "@/lib/commute/estimate";

export interface NearestStation {
  name: string;
  lines: string[];
  distanceM: number;
  walkMinutes: number;
}

interface StationRow {
  name: string;
  lat: number;
  lng: number;
  lines: string[];
}

const WALK_DETOUR = 1.3;
const WALK_KMH = 4.5;

const NEAREST_CACHE_MAX = 50_000;

let stations: StationRow[] | null = null;
const withoutLines = new Map<string, StationRow[]>();
const nearestCache = new Map<string, NearestStation | null>();

function loadStations(): StationRow[] {
  if (stations) return stations;
  try {
    const raw = JSON.parse(readFileSync(path.join(process.cwd(), "public", "transit", "metro-stations.json"), "utf8")) as { stations?: StationRow[] };
    stations = Array.isArray(raw.stations) ? raw.stations : [];
  } catch (e) {
    console.warn("역 목록(public/transit/metro-stations.json)을 읽지 못해 역세권 점수를 뺍니다.", e);
    stations = [];
  }
  return stations;
}

function stationsWithout(excludedKey: string, excluded: readonly string[]): StationRow[] {
  if (excluded.length === 0) return loadStations();
  let list = withoutLines.get(excludedKey);
  if (!list) {
    const ex = new Set(excluded);
    list = loadStations().flatMap((s) => {
      const lines = s.lines.filter((l) => !ex.has(l));
      return lines.length > 0 ? [{ ...s, lines }] : [];
    });
    withoutLines.set(excludedKey, list);
  }
  return list;
}

export function nearestStation(p: GeoPoint, excludedLines: readonly string[] = []): NearestStation | null {
  const excludedKey = [...excludedLines].sort().join("|");
  const key = `${excludedKey}@${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
  const cached = nearestCache.get(key);
  if (cached !== undefined) return cached;
  let best: StationRow | null = null;
  let bestKm = Number.POSITIVE_INFINITY;
  for (const s of stationsWithout(excludedKey, excludedLines)) {
    const km = haversineKm(p, s);
    if (km < bestKm) {
      bestKm = km;
      best = s;
    }
  }
  const result = best
    ? { name: best.name, lines: best.lines, distanceM: Math.round(bestKm * 1000), walkMinutes: Math.max(1, Math.round(((bestKm * WALK_DETOUR) / WALK_KMH) * 60)) }
    : null;
  if (nearestCache.size >= NEAREST_CACHE_MAX) nearestCache.clear();
  nearestCache.set(key, result);
  return result;
}

export function stationLines(): string[] {
  return [...new Set(loadStations().flatMap((s) => s.lines))].sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));
}

/** 직선 300m 이내 1점, 1.5km에서 0점. 환승역이면 0.1점 더한다 */
export function stationScore(s: NearestStation): number {
  const base = Math.max(0, Math.min(1, 1 - (s.distanceM - 300) / 1200));
  return Math.min(1, base + (s.lines.length >= 2 && base > 0 ? 0.1 : 0));
}

export function stationDetail(s: NearestStation): string {
  const name = s.name.endsWith("역") ? s.name : `${s.name}역`;
  return `${name}(${s.lines.join("·")}) 직선 ${s.distanceM.toLocaleString("ko-KR")}m · 도보 약 ${s.walkMinutes}분`;
}
