// 직장 위치 검색: 내장 장소 사전 → 카카오 로컬(키가 있을 때) → Nominatim 순으로 조회

import type { NextRequest } from "next/server";
import type { PlaceSuggestion } from "@/lib/types";
import { searchBuiltinPlaces } from "@/lib/commute/places";
import { getApiKey } from "@/lib/settings";

let lastNominatimAt = 0;

async function kakaoSearch(q: string): Promise<PlaceSuggestion[]> {
  const key = getApiKey("kakao");
  if (!key) return [];
  const res = await fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?size=5&query=${encodeURIComponent(q)}`, {
    headers: { Authorization: `KakaoAK ${key}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { documents?: { place_name: string; address_name: string; x: string; y: string }[] };
  return (json.documents ?? []).map((d) => ({
    label: d.place_name,
    detail: d.address_name,
    location: { lat: parseFloat(d.y), lng: parseFloat(d.x) },
    kind: "poi" as const,
    source: "kakao" as const,
  }));
}

async function nominatimSearch(q: string): Promise<PlaceSuggestion[]> {
  // OSM Nominatim 정책: 앱 전체 초당 1회 이하, 식별 가능한 User-Agent 필수
  if (Date.now() - lastNominatimAt < 1100) return [];
  lastNominatimAt = Date.now();
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=kr&accept-language=ko&q=${encodeURIComponent(q)}`,
    { headers: { "User-Agent": "silipju-local/0.1 (personal real-estate search)" }, signal: AbortSignal.timeout(6000) },
  );
  if (!res.ok) return [];
  const json = (await res.json()) as { display_name: string; lat: string; lon: string; name?: string }[];
  return json.map((d) => ({
    label: d.name || d.display_name.split(",")[0],
    detail: d.display_name,
    location: { lat: parseFloat(d.lat), lng: parseFloat(d.lon) },
    kind: "address" as const,
    source: "nominatim" as const,
  }));
}

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 1) return Response.json({ items: [] });
  const builtin = searchBuiltinPlaces(q);
  if (builtin.length >= 3) return Response.json({ items: builtin });
  const external = (await kakaoSearch(q).catch(() => [])) as PlaceSuggestion[];
  const more = external.length > 0 ? external : ((await nominatimSearch(q).catch(() => [])) as PlaceSuggestion[]);
  return Response.json({ items: [...builtin, ...more].slice(0, 8) });
}
