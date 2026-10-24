// 단지에서 가장 가까운 초등학교·중학교와 거리(학군 점수용). 학교 위치는 public/schools/schools.json(OSM, scripts/build-schools.ts)

import { readFileSync } from "node:fs";
import path from "node:path";
import type { GeoPoint } from "@/lib/types";
import { haversineKm } from "@/lib/commute/estimate";
import { walkMinutes } from "@/lib/neighborhood/schools";

export interface NearestSchool {
  name: string;
  distanceM: number;
  walkMinutes: number;
}

export interface SchoolAccess {
  elementary: NearestSchool | null;
  middle: NearestSchool | null;
}

interface SchoolRow {
  name: string;
  kind: "elementary" | "middle";
  lat: number;
  lng: number;
}

let schools: SchoolRow[] | null = null;
const cache = new Map<string, SchoolAccess | null>();

function loadSchools(): SchoolRow[] {
  if (schools) return schools;
  try {
    const raw = JSON.parse(readFileSync(path.join(process.cwd(), "public", "schools", "schools.json"), "utf8")) as { schools?: SchoolRow[] };
    schools = Array.isArray(raw.schools) ? raw.schools : [];
  } catch (e) {
    console.warn("학교 위치(public/schools/schools.json)를 읽지 못해 학군 점수를 뺍니다.", e);
    schools = [];
  }
  return schools;
}

export function nearestSchools(p: GeoPoint): SchoolAccess | null {
  const key = `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const all = loadSchools();
  let result: SchoolAccess | null = null;
  if (all.length > 0) {
    const kx = Math.cos((p.lat * Math.PI) / 180);
    const best: Record<SchoolRow["kind"], { row: SchoolRow | null; d2: number }> = {
      elementary: { row: null, d2: Number.POSITIVE_INFINITY },
      middle: { row: null, d2: Number.POSITIVE_INFINITY },
    };
    for (const s of all) {
      const dx = (s.lng - p.lng) * kx;
      const dy = s.lat - p.lat;
      const d2 = dx * dx + dy * dy;
      const b = best[s.kind];
      if (b && d2 < b.d2) {
        b.d2 = d2;
        b.row = s;
      }
    }
    const pick = (row: SchoolRow | null): NearestSchool | null => {
      if (!row) return null;
      const distanceM = Math.round(haversineKm(p, row) * 1000);
      return { name: row.name, distanceM, walkMinutes: walkMinutes(distanceM) };
    };
    result = { elementary: pick(best.elementary.row), middle: pick(best.middle.row) };
  }
  cache.set(key, result);
  return result;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** 초등학교는 250m 이내 만점·1.2km에서 0점, 중학교는 400m 이내 만점·1.5km에서 0점이며 6:4로 섞는다 */
export function schoolScore(a: SchoolAccess): number {
  const e = a.elementary ? clamp01(1 - (a.elementary.distanceM - 250) / 950) : 0;
  const m = a.middle ? clamp01(1 - (a.middle.distanceM - 400) / 1100) : 0;
  return 0.6 * e + 0.4 * m;
}

export function schoolDetail(a: SchoolAccess): string {
  const one = (label: string, s: NearestSchool | null) =>
    s ? `${label} ${s.name} 직선 ${s.distanceM.toLocaleString("ko-KR")}m(도보 약 ${s.walkMinutes}분)` : `${label} 못 찾음`;
  return `${one("초등학교", a.elementary)} · ${one("중학교", a.middle)}. 가장 가까운 학교까지 거리만 본 값이라 실제 배정 학교·학업성취도·학원가와 다를 수 있습니다.`;
}
