// 검색 파이프라인: 기본 필터 → 세안고 2단계 판별(가격 비교 포함) → 대출·필요현금 → 통근 → 점수 정렬

import type {
  CommuteRoute,
  Complex,
  ListingUnit,
  LoanInfoSnapshot,
  PeerPrices,
  SearchConditions,
  SearchResponse,
  SearchResultItem,
  SeangoResult,
  SeangoStrictness,
} from "@/lib/types";
import { classifyAll, median, peerKey } from "@/lib/seango/classify-all";
import { computeFinance } from "@/lib/finance/calculator";
import { withLiveRates } from "@/lib/finance/live-rates";
import { POLICY_AS_OF } from "@/lib/finance/policy";
import { estimateCommute } from "@/lib/commute/estimate";
import { scoreItem } from "@/lib/rank/score";
import { redevelopmentSignal } from "@/lib/rank/redevelopment";
import { nearestStation } from "@/lib/rank/station-access";
import { nearestSchools } from "@/lib/rank/school-access";
import { matchesFloors } from "@/lib/floors";
import { getStore, importedComplexCount } from "@/lib/data/store";
import { toPyeong } from "@/lib/format";

function monthsUntil(now: Date, ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return (y - now.getFullYear()) * 12 + (m - (now.getMonth() + 1));
}

function isSeangoLike(r: SeangoResult, strictness: SeangoStrictness): boolean {
  if (strictness === "lenient") return r.status === "seango";
  if (strictness === "balanced") return r.status === "seango" || r.status === "suspect";
  return r.status === "seango" || r.status === "suspect" || r.probability >= 0.3;
}

function matchesBasic(u: ListingUnit, c: Complex, q: SearchConditions, currentYear: number): boolean {
  if (q.priceMin !== null && u.price < q.priceMin) return false;
  if (q.priceMax !== null && u.price > q.priceMax) return false;
  if (q.areaMin !== null && u.exclusiveArea < q.areaMin) return false;
  if (q.areaMax !== null && u.exclusiveArea > q.areaMax) return false;
  if (q.roomsMin !== null && u.roomCount < q.roomsMin) return false;
  if (!matchesFloors(u, q.floors)) return false;
  if (q.minHouseholds !== null && (c.households ?? 0) < q.minHouseholds) return false;
  if (q.maxBuildingAge !== null && c.approvalYear !== null && currentYear - c.approvalYear > q.maxBuildingAge) return false;
  if (q.regions.length > 0 && !q.regions.some((r) => c.region.sigungu.startsWith(r) || c.address.includes(r))) return false;
  return true;
}

export function runSearch(q: SearchConditions, appUrl: string, now = new Date(), loanInfo: LoanInfoSnapshot | null = null): SearchResponse {
  const store = getStore();
  const loan = withLiveRates(q.loan, loanInfo, q.household);
  const currentYear = now.getFullYear();
  const classifyOpts = { now, acceptMoveInWithinMonths: q.seango.acceptMoveInWithinMonths };
  const warnings: string[] = [];

  const includeDemo = q.includeDemo && store.demoEnabled;
  let householdsUnknownExcluded = 0;
  const candidates = store.units.filter((u) => {
    const c = store.complexes.get(u.complexId);
    if (!c || (!includeDemo && c.source === "demo") || u.price <= 0) return false;
    if (q.minHouseholds !== null && c.households === null) {
      if (matchesBasic(u, c, { ...q, minHouseholds: null }, currentYear)) householdsUnknownExcluded++;
      return false;
    }
    return matchesBasic(u, c, q, currentYear);
  });
  const candidateComplexes = new Set(candidates.map((u) => u.complexId));
  const classified = classifyAll(
    store.units.filter((u) => candidateComplexes.has(u.complexId)),
    classifyOpts,
    store.leases,
  );

  let seangoDetected = 0;
  let seangoExcluded = 0;
  let unaffordable = 0;
  let overCommute = 0;
  const commuteCache = new Map<string, CommuteRoute>();
  const items: SearchResultItem[] = [];
  const basicPrices: number[] = [];
  const basicMoveInPrices: number[] = [];

  for (const u of candidates) {
    const c = store.complexes.get(u.complexId)!;
    const k = peerKey(u);
    const seango = classified.results.get(u.id)!;
    const seangoLike = isSeangoLike(seango, q.seango.strictness);
    const moveInSoon = !!seango.moveInFrom && monthsUntil(now, seango.moveInFrom) <= q.seango.acceptMoveInWithinMonths;
    const treatAsSeango = seangoLike && !moveInSoon;
    basicPrices.push(u.price);
    if (!treatAsSeango) basicMoveInPrices.push(u.price);
    if (seangoLike) seangoDetected++;
    if (q.seango.mode === "exclude" && treatAsSeango) {
      seangoExcluded++;
      continue;
    }
    if (q.seango.mode === "only" && !treatAsSeango) continue;

    const finance = computeFinance(
      { price: u.price, exclusiveArea: u.exclusiveArea, region: c.region },
      q.household,
      loan,
      seango.depositEstimate,
    );
    if (!finance.affordable) unaffordable++;
    if (q.onlyAffordable && !finance.affordable) continue;

    const commutes = q.workplaces.map((w) => {
      const ck = `${c.id}:${w.id}:${w.location.lat},${w.location.lng}:${q.commuteMode}`;
      let route = commuteCache.get(ck);
      if (!route) {
        route = estimateCommute(c.location, c.name, w, q.commuteMode, appUrl);
        commuteCache.set(ck, route);
      }
      return route;
    });
    const totalW = q.workplaces.reduce((s, w) => s + Math.max(w.weight, 0), 0);
    const weighted =
      commutes.length === 0
        ? null
        : commutes.reduce((s, r, i) => s + r.minutes * Math.max(q.workplaces[i].weight, 0), 0) / (totalW || commutes.length);
    const maxMin = commutes.length === 0 ? null : Math.max(...commutes.map((r) => r.minutes));
    if (q.maxCommuteMinutes !== null && maxMin !== null && maxMin > q.maxCommuteMinutes) {
      overCommute++;
      continue;
    }

    const all = classified.peerAll.get(k) ?? [];
    const peerMoveInAll = (classified.peerMoveIn.get(k) ?? []).map((p) => p.price);
    const peers: PeerPrices = {
      count: all.length,
      lowestAll: all.length ? Math.min(...all) : null,
      lowestMoveIn: peerMoveInAll.length ? Math.min(...peerMoveInAll) : null,
      medianMoveIn: median(peerMoveInAll),
    };

    items.push({
      unit: u,
      complex: c,
      seango,
      finance,
      commutes,
      commuteWeightedMinutes: weighted === null ? null : Math.round(weighted),
      commuteMaxMinutes: maxMin,
      peers,
      score: { total: 0, parts: [] },
      pricePerPyeong: Math.round(u.price / toPyeong(u.supplyArea ?? u.exclusiveArea * 1.3)),
    });
  }

  if (items.length > 0) {
    const prices = items.map((i) => i.unit.price);
    const ctx = { conditions: q, minPrice: Math.min(...prices), maxPrice: Math.max(...prices), currentYear };
    for (const it of items) {
      it.score = scoreItem(
        {
          commuteWeightedMinutes: it.commuteWeightedMinutes,
          requiredCash: it.finance.requiredCash,
          price: it.unit.price,
          exclusiveArea: it.unit.exclusiveArea,
          approvalYear: it.complex.approvalYear,
          households: it.complex.households,
          seangoStatus: it.seango.status,
          nearestStation: nearestStation(it.complex.location, q.excludedLines),
          redevelopment: redevelopmentSignal(it.complex, currentYear),
          schools: nearestSchools(it.complex.location),
        },
        ctx,
      );
    }
  }

  const sorters: Record<SearchConditions["sortBy"], (a: SearchResultItem, b: SearchResultItem) => number> = {
    score: (a, b) => b.score.total - a.score.total,
    cash: (a, b) => a.finance.requiredCash - b.finance.requiredCash,
    commute: (a, b) => (a.commuteWeightedMinutes ?? 1e9) - (b.commuteWeightedMinutes ?? 1e9),
    price: (a, b) => a.unit.price - b.unit.price,
    pricePerArea: (a, b) => a.pricePerPyeong - b.pricePerPyeong,
  };
  items.sort(sorters[q.sortBy]);

  if (!includeDemo && store.realUnits === 0) {
    warnings.push("수집된 실매물이 아직 없습니다. 상단 '실매물 수집'에서 시·구를 고르고 '오늘 매물 수집하기'를 눌러 주세요.");
  }
  if (q.workplaces.length === 0) warnings.push("직장 위치를 넣으면 통근 시간과 경로가 점수에 반영됩니다.");
  if (q.loan.products.length === 0) warnings.push("대출 상품을 하나 이상 선택하면 필요 현금이 계산됩니다.");

  return {
    items: items.slice(0, q.limit),
    stats: {
      totalUnits: store.units.length,
      matchedBasic: candidates.length,
      householdsUnknownExcluded,
      seangoDetected,
      seangoExcluded,
      unaffordable,
      overCommute,
      returned: Math.min(items.length, q.limit),
      lowestPriceAll: basicPrices.length ? Math.min(...basicPrices) : null,
      lowestPriceMoveIn: basicMoveInPrices.length ? Math.min(...basicMoveInPrices) : null,
    },
    policyAsOf: POLICY_AS_OF,
    dataSources: { demo: includeDemo, importedComplexes: importedComplexCount(), realUnits: store.realUnits },
    commuteSource: "estimate",
    warnings,
  };
}
