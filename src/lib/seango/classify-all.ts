// 매물 묶음 전체를 2단계로 판별(1차 판별로 같은 평형 실입주 시세를 만든 뒤 가격 이상치까지 반영해 2차 판별)

import type { ListingUnit, RealtorAd, SeangoResult } from "@/lib/types";
import { classifySeango, type LeaseHint } from "./classifier";

export interface ClassifiedSet {
  results: Map<string, SeangoResult>;
  peerAll: Map<string, number[]>;
  peerMoveIn: Map<string, { id: string; price: number }[]>;
}

export const peerKey = (u: ListingUnit) => `${u.complexId}:${Math.round(u.exclusiveArea)}`;

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// 네이버 중복 묶음이 같은 호실을 여러 그룹으로 나누는 경우가 있다(REA 실데이터: 318동 35/35층 28.8억이 21건·3건 두 그룹).
// 동·층·전용면적·가격이 모두 같으면 같은 호실로 보고 광고를 합쳐 판별한다. 동을 모르면 합치지 않는다.
const siblingKey = (u: ListingUnit) =>
  u.dong && u.floor !== null ? `${u.complexId}|${u.dong}|${u.floorLabel}|${u.exclusiveArea.toFixed(1)}|${u.price}` : null;

function mergeSiblings(units: ListingUnit[]): Map<string, { merged: ListingUnit; groups: number }> {
  const byKey = new Map<string, ListingUnit[]>();
  for (const u of units) {
    const k = siblingKey(u);
    if (k) byKey.set(k, [...(byKey.get(k) ?? []), u]);
  }
  const out = new Map<string, { merged: ListingUnit; groups: number }>();
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    const ads = new Map<string, RealtorAd>();
    for (const g of group) for (const a of g.ads) ads.set(a.articleNo, a);
    for (const g of group) out.set(g.id, { merged: { ...g, ads: [...ads.values()] }, groups: group.length });
  }
  return out;
}

export function classifyAll(
  units: ListingUnit[],
  opts: { now: Date; acceptMoveInWithinMonths: number },
  leases: Map<string, LeaseHint[]>,
): ClassifiedSet {
  const siblings = mergeSiblings(units);
  const target = (u: ListingUnit) => siblings.get(u.id)?.merged ?? u;

  const peerAll = new Map<string, number[]>();
  const peerMoveIn = new Map<string, { id: string; price: number }[]>();
  for (const u of units) {
    if (u.price <= 0) continue;
    const first = classifySeango(target(u), { ...opts, leases: leases.get(u.complexId) });
    const k = peerKey(u);
    peerAll.set(k, [...(peerAll.get(k) ?? []), u.price]);
    if (first.status === "movein" || first.status === "unknown") {
      peerMoveIn.set(k, [...(peerMoveIn.get(k) ?? []), { id: u.id, price: u.price }]);
    }
  }
  const results = new Map<string, SeangoResult>();
  for (const u of units) {
    if (u.price <= 0) continue;
    const others = (peerMoveIn.get(peerKey(u)) ?? []).filter((p) => p.id !== u.id).map((p) => p.price);
    const r = classifySeango(target(u), { ...opts, peerMoveInMedian: median(others), leases: leases.get(u.complexId) });
    const sib = siblings.get(u.id);
    if (sib) {
      r.evidence.push({
        kind: "merged-groups",
        weight: 0,
        label: `네이버가 같은 호실(동·층·면적·가격 동일)을 ${sib.groups}개 그룹으로 나눠 올려 광고 ${sib.merged.ads.length}건을 합쳐 판별`,
        source: "그룹 병합",
        snippet: null,
        matched: null,
      });
    }
    results.set(u.id, r);
  }
  return { results, peerAll, peerMoveIn };
}
