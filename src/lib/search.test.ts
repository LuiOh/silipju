// 검색 파이프라인 통합 테스트: 세안고 제외·통근 제한·정렬·예시 조건 동작 확인

import { describe, expect, it } from "vitest";
import { defaultConditions, normalizeConditions } from "@/lib/defaults";
import { runSearch } from "@/lib/search";

const NOW = new Date("2026-10-24T09:00:00+09:00");

describe("runSearch", () => {
  it("예시 조건(6억대·전용 84·판교/정자)에서 결과를 점수순으로 돌려준다", () => {
    const res = runSearch(defaultConditions(), "http://localhost:3000", NOW);
    expect(res.items.length).toBeGreaterThan(0);
    for (const it of res.items) {
      expect(it.unit.price).toBeGreaterThanOrEqual(600_000_000);
      expect(it.unit.price).toBeLessThanOrEqual(699_000_000);
      expect(it.commutes).toHaveLength(2);
      expect(it.finance.requiredCash).toBeGreaterThan(0);
    }
    const scores = res.items.map((i) => i.score.total);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("세안고 제외 모드에서는 세안고 판정 매물이 빠지고, 세안고만 모드에서는 그것만 남는다", () => {
    const base = normalizeConditions({ priceMin: null, priceMax: null, areaMin: null, areaMax: null, maxCommuteMinutes: null, limit: 300 });
    const excluded = runSearch(base, "http://localhost:3000", NOW);
    expect(excluded.stats.seangoExcluded).toBeGreaterThan(0);
    expect(excluded.items.every((i) => i.seango.status !== "seango" || !!i.seango.moveInFrom)).toBe(true);
    const only = runSearch({ ...base, seango: { ...base.seango, mode: "only" } }, "http://localhost:3000", NOW);
    expect(only.items.length).toBeGreaterThan(0);
    expect(only.items.every((i) => i.seango.status === "seango" || i.seango.status === "suspect")).toBe(true);
    expect(excluded.stats.lowestPriceAll).not.toBeNull();
  });

  it("통근 제한을 줄이면 결과가 줄고, 통근순 정렬은 오름차순", () => {
    const wide = runSearch(normalizeConditions({ priceMin: null, priceMax: null, maxCommuteMinutes: 120, limit: 300 }), "http://localhost:3000", NOW);
    const narrow = runSearch(normalizeConditions({ priceMin: null, priceMax: null, maxCommuteMinutes: 40, limit: 300, sortBy: "commute" }), "http://localhost:3000", NOW);
    expect(narrow.items.length).toBeLessThan(wide.items.length);
    const mins = narrow.items.map((i) => i.commuteWeightedMinutes ?? 0);
    expect([...mins].sort((a, b) => a - b)).toEqual(mins);
  });
});
