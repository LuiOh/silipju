// 매물 그룹(같은 호실을 올린 여러 중개사 광고)의 세안고 여부를 증거 융합으로 판별

import type { ListingUnit, RealtorAd, SeangoEvidence, SeangoResult, SeangoStatus } from "@/lib/types";
import { extractSignals, type TextSignals } from "./rules";

export interface LeaseHint {
  exclusiveArea: number;
  floor: number | null;
  deposit: number;
  monthlyRent: number;
  contractDate: string;
  contractTerm: string | null;
}

export interface ClassifyOptions {
  now: Date;
  acceptMoveInWithinMonths: number;
  /** 같은 단지·면적 실입주 매물 가격 중앙값. 있으면 가격 이상치 단서로 쓴다 */
  peerMoveInMedian?: number | null;
  /** 배치가 모은 같은 단지 전월세 실거래 신고. 같은 층·면적의 진행 중 계약을 약한 단서로 쓴다 */
  leases?: LeaseHint[];
}

// 전월세 신고 계약기간 "25.03~27.03" 또는 "202503~202703"의 종료 연월. 없으면 계약일 + 24개월
function leaseEnd(l: LeaseHint): string {
  const m = l.contractTerm?.match(/~\s*(\d{2}|\d{4})\.?(\d{2})/);
  if (m) {
    const y = m[1].length === 2 ? 2000 + parseInt(m[1], 10) : parseInt(m[1], 10);
    return `${y}-${m[2]}`;
  }
  const d = new Date(`${l.contractDate}T00:00:00`);
  d.setMonth(d.getMonth() + 24);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// 매매 매물 중 세안고 기본 비율 가정(REA 수집 표본: 헬리오시티 매매 18개 그룹 중 5개)
const PRIOR_PROBABILITY = 0.25;

const W = {
  structuredLeaseHold: 3.2,
  structuredDeposit: 3.2,
  structuredMoveInLater: 1.4,
  structuredMoveInNow: -0.5,
  structuredWithinMonths: -0.4,
  explicitBase: 2.4,
  explicitPerLog: 0.9,
  tenantBase: 1.3,
  tenantPerLog: 0.4,
  futureBase: 1.5,
  futurePerLog: 0.5,
  moveInNowBase: -1.8,
  moveInNowPerLog: -0.6,
  negotiableBase: -0.5,
  negotiablePerLog: -0.25,
  negated: -1.6,
  priceAnomaly: 0.6,
  rentRecord: 0.5,
};

const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

function monthsBetween(now: Date, ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return (y - now.getFullYear()) * 12 + (m - (now.getMonth() + 1));
}

function adText(ad: RealtorAd): string {
  return [ad.featureText, ad.description ?? ""].join(" \n ");
}

function snippetAround(text: string, needle: string, radius = 28): string {
  const i = text.indexOf(needle);
  if (i < 0) return text.slice(0, radius * 2);
  const start = Math.max(0, i - radius);
  const end = Math.min(text.length, i + needle.length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

interface AdAnalysis {
  ad: RealtorAd;
  text: string;
  signals: TextSignals;
}

function pickMoveInDate(dates: string[]): string | null {
  if (dates.length === 0) return null;
  const counts = new Map<string, number>();
  for (const d of dates) counts.set(d, (counts.get(d) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1))[0][0];
}

export function classifySeango(unit: ListingUnit, opts: ClassifyOptions): SeangoResult {
  const evidence: SeangoEvidence[] = [];
  let score = logit(PRIOR_PROBABILITY);
  const add = (e: SeangoEvidence) => {
    evidence.push(e);
    score += e.weight;
  };

  const analyses: AdAnalysis[] = unit.ads.map((ad) => {
    const text = adText(ad);
    return { ad, text, signals: extractSignals(text) };
  });

  // 1) 구조화 필드: 상세 API의 isLeaseHold·previousDeposit·movingInInfo
  let depositEstimate: number | null = null;
  const leaseHoldAd = analyses.find((a) => a.ad.isLeaseHold === true);
  if (leaseHoldAd) {
    add({
      kind: "structured-leasehold",
      weight: W.structuredLeaseHold,
      label: "임대 중(isLeaseHold) 표시",
      source: leaseHoldAd.ad.realtorName,
      snippet: null,
      matched: "isLeaseHold=true",
    });
  }
  const depositAd = analyses.find((a) => (a.ad.previousDeposit ?? 0) > 0 || (a.ad.previousMonthlyRent ?? 0) > 0);
  if (depositAd) {
    depositEstimate = depositAd.ad.previousDeposit && depositAd.ad.previousDeposit > 0 ? depositAd.ad.previousDeposit : null;
    add({
      kind: "structured-deposit",
      weight: W.structuredDeposit,
      label: "기보증금/기월세 입력됨",
      source: depositAd.ad.realtorName,
      snippet: null,
      matched: `기보증금 ${depositAd.ad.previousDeposit ?? 0}원 / 기월세 ${depositAd.ad.previousMonthlyRent ?? 0}원`,
    });
  }

  const structuredDates: string[] = [];
  let structuredNowCount = 0;
  let structuredNowSource: string | null = null;
  for (const a of analyses) {
    const mv = a.ad.movingIn;
    if (!mv?.type) continue;
    if ((mv.type === "MV003" || mv.type === "MV004") && mv.date) structuredDates.push(mv.date.slice(0, 7));
    if (mv.type === "MV001") {
      structuredNowCount += 1;
      structuredNowSource ??= a.ad.realtorName;
    }
  }
  const structuredDate = pickMoveInDate(structuredDates);
  if (structuredDate) {
    const months = monthsBetween(opts.now, structuredDate);
    if (months > opts.acceptMoveInWithinMonths) {
      add({
        kind: "structured-movein-later",
        weight: W.structuredMoveInLater,
        label: `입주가능일 ${structuredDate} 이후(지금부터 ${months}개월)`,
        source: "입주가능일 필드",
        snippet: null,
        matched: structuredDate,
      });
    } else {
      add({
        kind: "structured-movein-now",
        weight: W.structuredWithinMonths,
        label: `입주가능일 ${structuredDate}(조건 ${opts.acceptMoveInWithinMonths}개월 이내)`,
        source: "입주가능일 필드",
        snippet: null,
        matched: structuredDate,
      });
    }
  } else if (structuredNowCount > 0) {
    add({
      kind: "structured-movein-now",
      weight: W.structuredMoveInNow,
      label: `입주가능일 '즉시입주' ${structuredNowCount}건 (기본값으로 남겨두는 경우가 많아 약한 단서)`,
      source: structuredNowSource ?? "입주가능일 필드",
      snippet: null,
      matched: "MV001",
    });
  }

  // 2) 중개사별 텍스트: 같은 호실을 올린 광고마다 단서를 모아 그룹 단위로 합산
  const explicitAds = analyses.filter((a) => a.signals.explicit.length > 0);
  const tenantOnlyAds = analyses.filter((a) => a.signals.explicit.length === 0 && a.signals.tenantDetail.length > 0);
  const futureDates: string[] = [];
  const futureAds: AdAnalysis[] = [];
  const pastOrSoonAds: AdAnalysis[] = [];
  for (const a of analyses) {
    for (const f of a.signals.futureMoveIn) {
      const months = monthsBetween(opts.now, f.date);
      if (months > opts.acceptMoveInWithinMonths) {
        futureDates.push(f.date);
        if (!futureAds.includes(a)) futureAds.push(a);
      } else if (!pastOrSoonAds.includes(a)) {
        pastOrSoonAds.push(a);
      }
    }
  }
  const moveInNowAds = analyses.filter((a) => a.signals.moveInNow.length > 0 && a.signals.explicit.length === 0);
  const negotiableAds = analyses.filter(
    (a) => a.signals.negotiable.length > 0 && a.signals.moveInNow.length === 0 && a.signals.explicit.length === 0,
  );
  const negatedAds = analyses.filter((a) => a.signals.negated.length > 0);

  for (const a of analyses) {
    if (a.signals.deposit && !depositEstimate) depositEstimate = a.signals.deposit;
  }

  if (explicitAds.length > 0) {
    const k = explicitAds.length;
    const first = explicitAds[0];
    add({
      kind: "text-explicit",
      weight: W.explicitBase + W.explicitPerLog * Math.log(k),
      label: `중개사 ${unit.ads.length}곳 중 ${k}곳이 세안고 표현 사용`,
      source: first.ad.realtorName,
      snippet: snippetAround(first.text, first.signals.explicit[0]),
      matched: first.signals.explicit[0],
    });
    for (const extra of explicitAds.slice(1, 4)) {
      evidence.push({
        kind: "text-explicit",
        weight: 0,
        label: "같은 호실 다른 중개사 설명",
        source: extra.ad.realtorName,
        snippet: snippetAround(extra.text, extra.signals.explicit[0]),
        matched: extra.signals.explicit[0],
      });
    }
  }
  if (tenantOnlyAds.length > 0) {
    const t = tenantOnlyAds.length;
    const first = tenantOnlyAds[0];
    add({
      kind: "text-tenant-detail",
      weight: W.tenantBase + W.tenantPerLog * Math.log(t),
      label: `임차인 존재를 전제하는 표현 ${t}건(만기·갱신권·세입자 등)`,
      source: first.ad.realtorName,
      snippet: snippetAround(first.text, first.signals.tenantDetail[0]),
      matched: first.signals.tenantDetail[0],
    });
  }
  const textMoveInFrom = pickMoveInDate(futureDates);
  if (futureAds.length > 0 && textMoveInFrom) {
    const first = futureAds[0];
    const f = first.signals.futureMoveIn.find((x) => x.date === textMoveInFrom) ?? first.signals.futureMoveIn[0];
    add({
      kind: "text-future-movein",
      weight: W.futureBase + W.futurePerLog * Math.log(futureAds.length),
      label: `설명에 ${textMoveInFrom} 이후 입주 언급 ${futureAds.length}건`,
      source: first.ad.realtorName,
      snippet: snippetAround(first.text, f.matched),
      matched: f.matched,
    });
  }
  if (moveInNowAds.length > 0) {
    const m = moveInNowAds.length;
    const first = moveInNowAds[0];
    add({
      kind: "text-movein-now",
      weight: W.moveInNowBase + W.moveInNowPerLog * Math.log(m),
      label: `즉시입주·주인거주·공실 표현 ${m}건`,
      source: first.ad.realtorName,
      snippet: snippetAround(first.text, first.signals.moveInNow[0]),
      matched: first.signals.moveInNow[0],
    });
  }
  if (negotiableAds.length > 0 || pastOrSoonAds.length > 0) {
    const n = negotiableAds.length + pastOrSoonAds.length;
    const first = negotiableAds[0] ?? pastOrSoonAds[0];
    const needle = first.signals.negotiable[0] ?? first.signals.futureMoveIn[0]?.matched ?? "";
    add({
      kind: "text-movein-negotiable",
      weight: W.negotiableBase + W.negotiablePerLog * Math.log(n),
      label: `입주협의·입주가능 등 표현 ${n}건`,
      source: first.ad.realtorName,
      snippet: snippetAround(first.text, needle),
      matched: needle,
    });
  }
  if (negatedAds.length > 0) {
    const first = negatedAds[0];
    add({
      kind: "text-negated",
      weight: W.negated,
      label: "세안고 아님·세입자 퇴거 등 부정 표현",
      source: first.ad.realtorName,
      snippet: snippetAround(first.text, first.signals.negated[0]),
      matched: first.signals.negated[0],
    });
  }

  const hasPositive = explicitAds.length > 0 || !!leaseHoldAd || !!depositAd;
  const hasStrongNegative = moveInNowAds.length > 0;
  if (hasPositive && hasStrongNegative) {
    evidence.push({
      kind: "conflict",
      weight: 0,
      label: `단서 충돌: 세안고 ${explicitAds.length}곳 vs 실입주 ${moveInNowAds.length}곳`,
      source: "그룹 비교",
      snippet: null,
      matched: null,
    });
  }

  // 3) 가격 이상치(약한 단서): 같은 단지·면적 실입주 매물 중앙값보다 6% 이상 낮을 때
  if (opts.peerMoveInMedian && opts.peerMoveInMedian > 0) {
    const gap = (opts.peerMoveInMedian - unit.price) / opts.peerMoveInMedian;
    if (gap >= 0.06) {
      add({
        kind: "price-anomaly",
        weight: W.priceAnomaly,
        label: `같은 평형 실입주 매물 중앙값보다 ${(gap * 100).toFixed(1)}% 낮음`,
        source: "가격 비교",
        snippet: null,
        matched: null,
      });
    }
  }

  // 4) 전월세 신고(약한 단서): 동·호수가 없어 같은 층·면적의 다른 호실일 수 있다
  if (opts.leases?.length && unit.floor !== null) {
    const nowYm = `${opts.now.getFullYear()}-${String(opts.now.getMonth() + 1).padStart(2, "0")}`;
    const active = opts.leases
      .filter((l) => l.floor === unit.floor && Math.abs(l.exclusiveArea - unit.exclusiveArea) <= 1)
      .map((l) => ({ l, end: leaseEnd(l) }))
      .filter((x) => x.end > nowYm)
      .sort((a, b) => b.l.contractDate.localeCompare(a.l.contractDate));
    if (active.length > 0) {
      const { l, end } = active[0];
      const kind = l.monthlyRent > 0 ? `월세 ${Math.round(l.deposit / 10_000).toLocaleString()}만/${Math.round(l.monthlyRent / 10_000)}만` : `전세 ${(l.deposit / 100_000_000).toFixed(1)}억`;
      add({
        kind: "rent-record",
        weight: W.rentRecord,
        label: `같은 층·면적 ${kind} 계약 신고(${l.contractDate.slice(0, 7)} 계약, ${end}까지)`,
        source: "국토부 전월세 실거래가",
        snippet: "동·호수가 공개되지 않아 같은 층 다른 호실일 수 있습니다.",
        matched: l.contractTerm,
      });
    }
  }

  const probability = sigmoid(score);
  const moveInFrom = textMoveInFrom ?? (structuredDate && monthsBetween(opts.now, structuredDate) > 0 ? structuredDate : null);
  const status = decideStatus(probability, hasPositive, hasStrongNegative, evidence);

  return {
    status,
    probability,
    totalAds: unit.ads.length,
    explicitAds: explicitAds.length,
    moveInAds: moveInNowAds.length + negotiableAds.length,
    depositEstimate,
    moveInFrom,
    evidence: evidence.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)),
    summary: summarize(status, unit.ads.length, explicitAds.length, moveInNowAds.length, depositEstimate, moveInFrom),
  };
}

function decideStatus(
  p: number,
  hasPositive: boolean,
  hasStrongNegative: boolean,
  evidence: SeangoEvidence[],
): SeangoStatus {
  const positiveSignal = evidence.some((e) => e.weight > 0 && e.kind !== "price-anomaly");
  if (p >= 0.8 && positiveSignal) return hasPositive && hasStrongNegative && p < 0.93 ? "suspect" : "seango";
  if (p >= 0.45 && positiveSignal) return "suspect";
  if (p <= 0.15) return "movein";
  return "unknown";
}

function summarize(
  status: SeangoStatus,
  total: number,
  explicit: number,
  moveInNow: number,
  deposit: number | null,
  moveInFrom: string | null,
): string {
  const parts: string[] = [];
  if (explicit > 0) parts.push(`중개사 ${total}곳 중 ${explicit}곳 세안고 언급`);
  if (explicit > 0 && explicit / total < 0.2) parts.push("단서가 일부 광고에만 있음");
  if (moveInNow > 0) parts.push(`실입주 표현 ${moveInNow}곳`);
  if (deposit) parts.push(`승계 보증금 약 ${(deposit / 100_000_000).toFixed(1)}억`);
  if (moveInFrom) parts.push(`${moveInFrom} 이후 입주`);
  const head: Record<SeangoStatus, string> = {
    seango: "세안고 매물",
    suspect: "세안고 의심",
    movein: "실입주 가능",
    unknown: "판단 근거 부족",
  };
  return [head[status], ...parts].join(" · ");
}
