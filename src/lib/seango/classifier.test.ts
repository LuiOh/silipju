// 세안고 판별기 단위 테스트(실제 네이버 매물 설명에서 관찰한 표현 기반) + 선택적 실데이터 검증

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ListingUnit, RealtorAd } from "@/lib/types";
import { importNaverPayloads } from "@/lib/data/naver-import";
import { classifySeango } from "./classifier";
import { classifyAll } from "./classify-all";
import { extractSignals } from "./rules";

const NOW = new Date("2026-10-24T00:00:00+09:00");
const OPTS = { now: NOW, acceptMoveInWithinMonths: 3 };

function ad(featureText: string, extra: Partial<RealtorAd> = {}): RealtorAd {
  return {
    articleNo: Math.random().toString(36).slice(2),
    realtorName: "테스트공인중개사",
    cpName: null,
    featureText,
    description: null,
    movingIn: null,
    previousDeposit: null,
    previousMonthlyRent: null,
    isLeaseHold: null,
    verificationType: null,
    confirmedAt: null,
    ...extra,
  };
}

function unit(ads: RealtorAd[], price = 1_000_000_000): ListingUnit {
  return {
    id: "u1",
    complexId: "c1",
    dong: "101",
    floorLabel: "10/20",
    floor: 10,
    totalFloors: 20,
    exclusiveArea: 84.9,
    supplyArea: 110,
    areaName: "110A",
    roomCount: 3,
    direction: "SS",
    price,
    ads,
    photoUrl: null,
  };
}

describe("extractSignals", () => {
  it("실제 매물 설명의 세안고 표현을 찾는다", () => {
    for (const t of [
      "계약 가능한 급매물, 풀에어컨, 전세안고 갭 투자매물",
      "18p매매o앞트인o남향o세안고o신혼부부추천",
      "42 역세권 판상형구조 세끼고 입주",
      "42.초역세권 높은 전세끼고 매매. 방4",
    ]) {
      expect(extractSignals(t).explicit.length, t).toBeGreaterThan(0);
    }
  });

  it("미래 입주 시기를 YYYY-MM으로 읽는다", () => {
    expect(extractSignals("42 초역세권 세안고매매 2027.2월 입주").futureMoveIn[0].date).toBe("2027-02");
    expect(extractSignals("송파초역세권 세안고 매매 로얄동 로얄층 27.02입").futureMoveIn[0].date).toBe("2027-02");
    expect(extractSignals("18. 27년8월 입주협의.신혼부부").futureMoveIn[0].date).toBe("2027-08");
  });

  it("층수·평형·가격 표기는 입주 시기로 오인하지 않는다", () => {
    expect(extractSignals("29/35층 남향 입주가능").futureMoveIn).toHaveLength(0);
    expect(extractSignals("32.5평 리모델링 28.0억").futureMoveIn).toHaveLength(0);
  });

  it("보증금 금액을 원 단위로 읽는다", () => {
    expect(extractSignals("전세 9억 끼고 매매").deposit).toBe(900_000_000);
    expect(extractSignals("보증금 5억5천 승계 조건").deposit).toBe(550_000_000);
  });

  it("부정 표현과 중개업소 홍보 문구는 세안고로 보지 않는다", () => {
    expect(extractSignals("세안고 아님, 주인거주 입주협의").explicit).toHaveLength(0);
    expect(extractSignals("매매 전세 월세 임대 중개 전문").explicit).toHaveLength(0);
  });
});

describe("classifySeango", () => {
  it("여러 중개사가 세안고라고 쓰면 세안고로 판정", () => {
    const r = classifySeango(unit([ad("세안고 급매"), ad("전세안고 갭투자"), ad("남향 로얄층")]), OPTS);
    expect(r.status).toBe("seango");
    expect(r.explicitAds).toBe(2);
  });

  it("51곳 중 1곳만 언급해도 놓치지 않는다(단서 분산)", () => {
    const ads = [ad("남향, 정원뷰 세안고"), ...Array.from({ length: 50 }, () => ad("초역세권 로얄동 풀옵션"))];
    const r = classifySeango(unit(ads), OPTS);
    expect(["seango", "suspect"]).toContain(r.status);
    expect(r.summary).toContain("51곳 중 1곳");
  });

  it("상세 필드 isLeaseHold·기보증금이 있으면 텍스트 없이도 세안고", () => {
    const r = classifySeango(unit([ad("올수리 남향", { isLeaseHold: true, previousDeposit: 600_000_000 })]), OPTS);
    expect(r.status).toBe("seango");
    expect(r.depositEstimate).toBe(600_000_000);
  });

  it("주인거주·즉시입주만 있으면 실입주 가능", () => {
    const r = classifySeango(unit([ad("주인거주 즉시입주 가능"), ad("공실 바로입주")]), OPTS);
    expect(r.status).toBe("movein");
  });

  it("세안고와 즉시입주가 충돌하면 근거에 충돌을 남긴다", () => {
    const r = classifySeango(unit([ad("세안고"), ad("즉시입주"), ad("즉시입주 가능")]), OPTS);
    expect(r.evidence.some((e) => e.kind === "conflict")).toBe(true);
    expect(r.status).not.toBe("movein");
  });

  it("입주 시기가 허용 기간 안이면 미래 입주 단서를 약하게 본다", () => {
    const later = classifySeango(unit([ad("2027.8월 입주")]), OPTS);
    const soon = classifySeango(unit([ad("2026.12월 입주")]), OPTS);
    expect(later.probability).toBeGreaterThan(soon.probability);
    expect(later.moveInFrom).toBe("2027-08");
  });

  it("같은 평형 실입주 매물보다 많이 싸면 가격 이상치 단서를 더한다", () => {
    const base = classifySeango(unit([ad("남향")], 900_000_000), OPTS);
    const cheap = classifySeango(unit([ad("남향")], 900_000_000), { ...OPTS, peerMoveInMedian: 1_000_000_000 });
    expect(cheap.probability).toBeGreaterThan(base.probability);
  });
});

describe("classifyAll", () => {
  it("네이버가 같은 호실을 두 그룹으로 나눠도(동·층·면적·가격 동일) 광고를 합쳐 함께 세안고로 판정", () => {
    const big = { ...unit([ad("세안고 남향"), ad("세안고 파크뷰"), ad("탑층 로얄동")]), id: "g1", floorLabel: "35/35", floor: 35 };
    const small = { ...unit([ad("강남뷰 남향 탑층"), ad("로얄동")]), id: "g2", floorLabel: "35/35", floor: 35 };
    const other = { ...unit([ad("강남뷰 남향")]), id: "g3", floorLabel: "34/35", floor: 34 };
    const { results } = classifyAll([big, small, other], OPTS, new Map());
    expect(results.get("g2")!.status).toBe(results.get("g1")!.status);
    expect(["seango", "suspect"]).toContain(results.get("g2")!.status);
    expect(results.get("g2")!.evidence.some((e) => e.kind === "merged-groups")).toBe(true);
    expect(results.get("g3")!.evidence.some((e) => e.kind === "merged-groups")).toBe(false);
  });
});

const captureDir = process.env.NAVER_CAPTURE_DIR;
const listFile = captureDir ? path.join(captureDir, "19_response_complex_article_list.json") : "";

describe.runIf(!!captureDir && existsSync(listFile))("REA 실데이터(헬리오시티 목록 응답) 검증", () => {
  it("매매 그룹을 가져오고 단서가 일부 광고에만 있는 그룹도 잡는다", () => {
    const data = importNaverPayloads([JSON.parse(readFileSync(listFile, "utf-8"))]);
    expect(data.units.length).toBeGreaterThan(10);
    const results = data.units.map((u) => ({ u, r: classifySeango(u, OPTS) }));
    const dispersed = results.filter(({ r }) => r.explicitAds > 0 && r.explicitAds / r.totalAds < 0.2);
    expect(dispersed.length).toBeGreaterThan(0);
    for (const { r } of dispersed) expect(["seango", "suspect"]).toContain(r.status);
    console.table(
      results.map(({ u, r }) => ({
        unit: u.id,
        area: u.exclusiveArea,
        price: u.price / 1e8,
        ads: r.totalAds,
        explicit: r.explicitAds,
        p: r.probability.toFixed(2),
        status: r.status,
      })),
    );
  });
});
