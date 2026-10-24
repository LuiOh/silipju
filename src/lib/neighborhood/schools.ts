// 카카오 로컬 카테고리 검색(SC4)으로 단지 주변 초·중·고를 거리순으로 찾고 DB에 잠시 캐시한다(서버 전용)

import { getDb, type Db } from "@/lib/db/client";
import { getApiKey, redactSecret } from "@/lib/settings";
import type { GeoPoint, NearbySchool, SchoolKind } from "@/lib/types";

const CATEGORY_URL = "https://dapi.kakao.com/v2/local/search/category.json";
export const SCHOOL_RADIUS_M = 1500;
const PAGE_SIZE = 15;
const MAX_PAGES = 3;
const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const WALK_M_PER_MIN = 75;
const WALK_DETOUR = 1.3;

export interface KakaoPlaceDoc {
  id?: string;
  place_name?: string;
  category_name?: string;
  distance?: string;
  place_url?: string;
  address_name?: string;
  road_address_name?: string;
}

const KIND_PATTERNS: [SchoolKind, RegExp][] = [
  ["elementary", /초등학교|초교$/],
  ["middle", /중학교|여중$|중$/],
  ["high", /고등학교|고교$|여고$|고$/],
];

export function classifySchool(categoryName: string, placeName: string): SchoolKind | null {
  if (/유치원|대학교|대학원|학원|어린이집/.test(categoryName)) return null;
  const leaf = categoryName.split(">").pop()?.trim() ?? "";
  for (const [kind, re] of KIND_PATTERNS) if (/학교/.test(leaf) && re.test(leaf)) return kind;
  const name = placeName.replace(/\s+/g, "").replace(/\(.*?\)/g, "");
  if (/병설|분교장|유치원|대학교/.test(name)) return null;
  for (const [kind, re] of KIND_PATTERNS) if (re.test(name)) return kind;
  return null;
}

export function walkMinutes(distanceM: number): number {
  return Math.max(1, Math.round((distanceM * WALK_DETOUR) / WALK_M_PER_MIN));
}

const KIND_ORDER: Record<SchoolKind, number> = { elementary: 0, middle: 1, high: 2 };

export function normalizeSchools(docs: KakaoPlaceDoc[]): NearbySchool[] {
  const seen = new Set<string>();
  const out: NearbySchool[] = [];
  for (const d of docs) {
    const name = d.place_name?.trim();
    if (!name) continue;
    const kind = classifySchool(d.category_name ?? "", name);
    const distanceM = Number(d.distance);
    if (!kind || !Number.isFinite(distanceM)) continue;
    const id = d.id ?? `${name}-${distanceM}`;
    if (seen.has(id) || seen.has(name)) continue;
    seen.add(id);
    seen.add(name);
    out.push({
      id,
      name,
      kind,
      distanceM: Math.round(distanceM),
      walkMinutes: walkMinutes(distanceM),
      address: d.road_address_name || d.address_name || null,
      url: d.place_url && /^https?:\/\//.test(d.place_url) ? d.place_url : null,
    });
  }
  return out.sort((a, b) => a.distanceM - b.distanceM || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}

async function fetchPage(p: GeoPoint, page: number, key: string): Promise<{ docs: KakaoPlaceDoc[]; isEnd: boolean }> {
  const params = new URLSearchParams({
    category_group_code: "SC4",
    x: String(p.lng),
    y: String(p.lat),
    radius: String(SCHOOL_RADIUS_M),
    sort: "distance",
    size: String(PAGE_SIZE),
    page: String(page),
  });
  const res = await fetch(`${CATEGORY_URL}?${params}`, { headers: { Authorization: `KakaoAK ${key}` }, signal: AbortSignal.timeout(8000) });
  const json = (await res.json().catch(() => null)) as { documents?: KakaoPlaceDoc[]; meta?: { is_end?: boolean }; message?: string } | null;
  if (!res.ok) throw new Error(`카카오 로컬 학교 검색 오류입니다. (${redactSecret(json?.message ?? `HTTP ${res.status}`, key)})`);
  return { docs: json?.documents ?? [], isEnd: json?.meta?.is_end ?? true };
}

export async function searchNearbySchools(p: GeoPoint, key: string): Promise<NearbySchool[]> {
  const docs: KakaoPlaceDoc[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await fetchPage(p, page, key);
    docs.push(...r.docs);
    if (r.isEnd) break;
  }
  return normalizeSchools(docs);
}

function readCache(db: Db, complexId: string): NearbySchool[] | null {
  const row = db.prepare(`SELECT created_at, content FROM complex_schools WHERE complex_id = ?`).get(complexId) as
    | { created_at: string; content: string }
    | undefined;
  if (!row || Date.now() - Date.parse(row.created_at) > CACHE_TTL_MS) return null;
  try {
    const parsed: unknown = JSON.parse(row.content);
    return Array.isArray(parsed) ? (parsed as NearbySchool[]) : null;
  } catch {
    return null;
  }
}

function writeCache(db: Db, complexId: string, schools: NearbySchool[]): void {
  db.prepare(
    `INSERT INTO complex_schools (complex_id, created_at, content) VALUES (?, ?, ?)
     ON CONFLICT(complex_id) DO UPDATE SET created_at = excluded.created_at, content = excluded.content`,
  ).run(complexId, new Date().toISOString(), JSON.stringify(schools));
}

export async function nearbySchoolsFor(
  complexId: string,
  location: GeoPoint,
  db: Db = getDb(),
): Promise<{ schools: NearbySchool[]; note: string | null }> {
  const cached = readCache(db, complexId);
  if (cached) return { schools: cached, note: cached.length === 0 ? `반경 ${SCHOOL_RADIUS_M.toLocaleString()}m 안에서 학교를 찾지 못했습니다.` : null };
  const key = getApiKey("kakao", db);
  if (!key) return { schools: [], note: "상단 API 설정에서 카카오 로컬 키를 넣으면 주변 학교와 거리를 보여줍니다." };
  try {
    const schools = await searchNearbySchools(location, key);
    writeCache(db, complexId, schools);
    return { schools, note: schools.length === 0 ? `반경 ${SCHOOL_RADIUS_M.toLocaleString()}m 안에서 학교를 찾지 못했습니다.` : null };
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") return { schools: [], note: "카카오 로컬 응답이 늦어 주변 학교를 가져오지 못했습니다." };
    return { schools: [], note: redactSecret(e instanceof Error ? e.message : String(e), key) };
  }
}
