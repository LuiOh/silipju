// 수도권 초·중학교 위치를 Overpass API에서 한 번 받아 public/schools/schools.json 정적 파일로 만드는 빌드 스크립트(학군 점수용)
//
// 사용법: npx tsx scripts/build-schools.ts [--reuse]
//   --reuse  .data/schools-raw/에 저장해 둔 Overpass 응답을 다시 쓴다.
// 데이터 출처: © OpenStreetMap contributors (ODbL)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { classifySchool } from "@/lib/neighborhood/schools";
import { haversineKm } from "@/lib/commute/estimate";

const BBOX = "36.9,126.3,38.0,127.7";
const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
const USER_AGENT = "silipju-schools-build/1.0 (one-time static build of school locations for a personal local app)";
const RAW_FILE = path.join(".data", "schools-raw", "schools.json");
const OUT_FILE = path.join("public", "schools", "schools.json");
const REUSE = process.argv.includes("--reuse");
const SAME_SCHOOL_KM = 0.5;

interface OsmElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

async function fetchElements(): Promise<OsmElement[]> {
  if (REUSE && existsSync(RAW_FILE)) {
    console.log(`저장된 응답 사용: ${RAW_FILE}`);
    return (JSON.parse(readFileSync(RAW_FILE, "utf8")) as { elements: OsmElement[] }).elements;
  }
  const query = `[out:json][timeout:240];nwr["amenity"="school"]["name"](${BBOX});out center tags;`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "User-Agent": USER_AGENT, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(300_000),
      });
      const text = await res.text();
      if (res.ok && text.trimStart().startsWith("{")) {
        mkdirSync(path.dirname(RAW_FILE), { recursive: true });
        writeFileSync(RAW_FILE, text);
        return (JSON.parse(text) as { elements: OsmElement[] }).elements;
      }
      console.warn(`${endpoint} 응답 ${res.status}: ${text.slice(0, 160)}`);
    } catch (e) {
      console.warn(`${endpoint} 요청 실패`, e);
    }
    await new Promise((r) => setTimeout(r, 20_000 * (attempt + 1)));
  }
  throw new Error("Overpass에서 학교 목록을 받지 못했습니다.");
}

async function main() {
  const elements = await fetchElements();
  const schools: { name: string; kind: "elementary" | "middle"; lat: number; lng: number }[] = [];
  for (const el of elements) {
    const name = el.tags?.name?.trim();
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (!name || lat === undefined || lng === undefined) continue;
    const kind = classifySchool("", name);
    if (kind !== "elementary" && kind !== "middle") continue;
    const p = { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
    if (schools.some((s) => s.name === name && haversineKm(s, p) < SAME_SCHOOL_KM)) continue;
    schools.push({ name, kind, ...p });
  }
  schools.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, "ko") || a.lat - b.lat);
  mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  writeFileSync(
    OUT_FILE,
    JSON.stringify({ source: "© OpenStreetMap contributors (ODbL)", bbox: BBOX, generatedAt: new Date().toISOString(), schools }),
  );
  const count = (k: string) => schools.filter((s) => s.kind === k).length;
  console.log(`OSM 요소 ${elements.length}개 → 초등학교 ${count("elementary")}곳, 중학교 ${count("middle")}곳 저장: ${OUT_FILE}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
