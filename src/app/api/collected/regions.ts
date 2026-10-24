// 수집 정리·세대수 보완 API가 함께 쓰는 지역 목록 입력 검사(시·구 이름 + 선택 시·도)

import type { RegionName } from "@/lib/db/repo";

export function readRegions(v: unknown): RegionName[] | null {
  if (!Array.isArray(v)) return null;
  const out: RegionName[] = [];
  for (const r of v) {
    if (typeof r !== "object" || r === null || !("name" in r) || typeof r.name !== "string" || r.name.trim() === "") return null;
    const sido = "sido" in r && typeof r.sido === "string" ? r.sido : null;
    out.push({ sido, name: r.name.trim() });
  }
  return out;
}
