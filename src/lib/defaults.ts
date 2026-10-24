// 검색 조건 기본값(사용자 예시 조건을 초기값으로 채움)과 요청 본문 정규화

import type { FloorBand, LoanProductId, SearchConditions } from "@/lib/types";
import { LOAN_PRODUCTS } from "@/lib/finance/policy";

const EOK = 100_000_000;
const FLOOR_BANDS: FloorBand[] = ["low", "mid", "high"];

export function defaultConditions(): SearchConditions {
  const rates = Object.fromEntries(LOAN_PRODUCTS.map((p) => [p.id, p.defaultRate])) as Record<LoanProductId, number>;
  return {
    priceMin: 6 * EOK,
    priceMax: 6.99 * EOK,
    areaMin: 80,
    areaMax: 90,
    roomsMin: null,
    floors: { bands: [], excludeFirst: false, excludeTop: false },
    minHouseholds: null,
    maxBuildingAge: null,
    regions: [],
    workplaces: [
      { id: "w1", label: "판교테크노밸리", location: { lat: 37.402, lng: 127.1086 }, weight: 1 },
      { id: "w2", label: "정자역", location: { lat: 37.367, lng: 127.1083 }, weight: 1 },
    ],
    commuteMode: "transit",
    maxCommuteMinutes: 70,
    household: {
      homeless: true,
      firstTimeBuyer: true,
      newlywed: false,
      childrenCount: 0,
      newbornWithin2y: false,
      dualIncome: true,
      annualIncome: 80_000_000,
      singleIncome: null,
      existingAnnualDebtPayment: 0,
      cash: 250_000_000,
      netAssets: null,
    },
    loan: {
      products: ["bank", "bogeumjari", "didimdol"],
      rates,
      bankRateType: "periodic5",
      termYears: 30,
      useMciMcg: false,
      bankSelfCap: null,
      autoRates: true,
    },
    seango: { mode: "exclude", strictness: "balanced", acceptMoveInWithinMonths: 3 },
    weights: { commute: 3, cash: 3, price: 2, area: 1, newness: 1, complexSize: 1, station: 2, redevelopment: 1, school: 1 },
    excludedLines: [],
    sortBy: "score",
    onlyAffordable: false,
    limit: 60,
    includeDemo: true,
  };
}

/** 부분 조건을 기본값과 합치고 숫자 범위를 안전하게 보정한다 */
export function normalizeConditions(input: Partial<SearchConditions> | null | undefined): SearchConditions {
  const d = defaultConditions();
  const q: SearchConditions = {
    ...d,
    ...input,
    household: { ...d.household, ...(input?.household ?? {}) },
    loan: { ...d.loan, ...(input?.loan ?? {}), rates: { ...d.loan.rates, ...(input?.loan?.rates ?? {}) } },
    seango: { ...d.seango, ...(input?.seango ?? {}) },
    weights: { ...d.weights, ...(input?.weights ?? {}) },
    floors: { ...d.floors, ...(input?.floors ?? {}) },
    workplaces: Array.isArray(input?.workplaces) ? input.workplaces : d.workplaces,
    regions: Array.isArray(input?.regions) ? input.regions : d.regions,
  };
  q.floors.bands = Array.isArray(q.floors.bands) ? q.floors.bands.filter((b) => FLOOR_BANDS.includes(b)) : [];
  q.excludedLines = Array.isArray(q.excludedLines) ? [...new Set(q.excludedLines.filter((l) => typeof l === "string" && l.length > 0))].slice(0, 40) : [];
  q.limit = Math.min(Math.max(1, Math.round(q.limit || 60)), 300);
  q.loan.termYears = Math.min(Math.max(5, Math.round(q.loan.termYears || 30)), 50);
  q.loan.products = q.loan.products.filter((p) => LOAN_PRODUCTS.some((lp) => lp.id === p));
  q.workplaces = q.workplaces.filter((w) => Number.isFinite(w.location?.lat) && Number.isFinite(w.location?.lng)).slice(0, 5);
  return q;
}
