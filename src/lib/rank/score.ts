// 통근·현금여력·가격·면적·신축·단지규모·역세권·재개발 호재·학군·세안고 확실성을 가중 합산해 매물 점수를 계산

import type { RankWeights, ScoreBreakdown, ScorePart, SearchConditions, SeangoStatus } from "@/lib/types";
import type { RedevelopmentSignal } from "./redevelopment";
import { schoolDetail, schoolScore, type SchoolAccess } from "./school-access";
import { stationDetail, stationScore, type NearestStation } from "./station-access";

export interface ScoreInput {
  commuteWeightedMinutes: number | null;
  requiredCash: number;
  price: number;
  exclusiveArea: number;
  approvalYear: number | null;
  households: number | null;
  seangoStatus: SeangoStatus;
  nearestStation: NearestStation | null;
  redevelopment: RedevelopmentSignal;
  schools: SchoolAccess | null;
}

export interface ScoreContext {
  conditions: SearchConditions;
  minPrice: number;
  maxPrice: number;
  currentYear: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const CERTAINTY: Record<SeangoStatus, number> = { movein: 1, unknown: 0.6, suspect: 0.25, seango: 0 };
const CERTAINTY_WEIGHT = 0.6;

export function scoreItem(x: ScoreInput, ctx: ScoreContext): ScoreBreakdown {
  const c = ctx.conditions;
  const w: RankWeights = c.weights;
  const parts: ScorePart[] = [];

  if (c.workplaces.length > 0 && x.commuteWeightedMinutes !== null) {
    const limit = c.maxCommuteMinutes ?? 90;
    const s = clamp01(1 - (x.commuteWeightedMinutes - 20) / Math.max(10, limit - 20));
    parts.push({ key: "commute", label: "통근", score: s, weight: w.commute, detail: `가중 평균 ${Math.round(x.commuteWeightedMinutes)}분` });
  }

  const cash = Math.max(c.household.cash, 10_000_000);
  const gap = c.household.cash - x.requiredCash;
  parts.push({
    key: "cash",
    label: "현금 여력",
    score: clamp01(0.5 + gap / (2 * cash)),
    weight: w.cash,
    detail: gap >= 0 ? `보유현금으로 충당 후 ${Math.round(gap / 10_000).toLocaleString()}만원 남음` : `${Math.round(-gap / 10_000).toLocaleString()}만원 부족`,
  });

  const span = Math.max(1, ctx.maxPrice - ctx.minPrice);
  parts.push({
    key: "price",
    label: "가격",
    score: ctx.maxPrice === ctx.minPrice ? 1 : clamp01(1 - (x.price - ctx.minPrice) / span),
    weight: w.price,
    detail: "검색 결과 안에서 상대적으로 저렴할수록 높음",
  });

  const target =
    c.areaMin !== null && c.areaMax !== null ? (c.areaMin + c.areaMax) / 2 : c.areaMin ?? c.areaMax ?? null;
  const areaScore = target === null ? clamp01((x.exclusiveArea - 40) / 80) : clamp01(1 - Math.abs(x.exclusiveArea - target) / (target * 0.4));
  parts.push({
    key: "area",
    label: "면적",
    score: areaScore,
    weight: w.area,
    detail: target === null ? "넓을수록 높음" : `희망 전용 ${Math.round(target)}㎡와의 차이`,
  });

  const age = x.approvalYear ? ctx.currentYear - x.approvalYear : 20;
  parts.push({ key: "newness", label: "연식", score: clamp01(1 - age / 35), weight: w.newness, detail: `${age}년차` });

  const hh = x.households ?? 500;
  parts.push({
    key: "complexSize",
    label: "단지 규모",
    score: clamp01(Math.log10(Math.max(hh, 100) / 100) / Math.log10(50)),
    weight: w.complexSize,
    detail: `${hh.toLocaleString()}세대`,
  });

  parts.push(
    x.nearestStation
      ? { key: "station", label: "역세권", score: stationScore(x.nearestStation), weight: w.station, detail: stationDetail(x.nearestStation) }
      : { key: "station", label: "역세권", score: 0, weight: w.station, detail: "가까운 역을 찾지 못했습니다." },
  );

  parts.push({ key: "redevelopment", label: "재개발 호재", score: x.redevelopment.score, weight: w.redevelopment, detail: x.redevelopment.detail });

  parts.push(
    x.schools
      ? { key: "school", label: "학군", score: schoolScore(x.schools), weight: w.school, detail: schoolDetail(x.schools) }
      : { key: "school", label: "학군", score: 0, weight: w.school, detail: "학교 위치 데이터를 읽지 못했습니다." },
  );

  parts.push({
    key: "certainty",
    label: "실입주 확실성",
    score: CERTAINTY[x.seangoStatus],
    weight: CERTAINTY_WEIGHT,
    detail: { movein: "실입주 단서 확인", unknown: "단서 부족", suspect: "세안고 의심", seango: "세안고" }[x.seangoStatus],
  });

  const totalWeight = parts.reduce((s, p) => s + p.weight, 0) || 1;
  const total = (parts.reduce((s, p) => s + p.score * p.weight, 0) / totalWeight) * 100;
  return { total: Math.round(total * 10) / 10, parts };
}
