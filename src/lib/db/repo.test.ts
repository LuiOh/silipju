// DB 적재·조회 왕복, 상세 선적재, 재그룹 정리, 만료 정리, 전월세 단서 테스트(임시 SQLite 파일 사용)

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "./client";
import {
  complexesMissingHouseholds,
  counts,
  findRents,
  findTrades,
  loadListings,
  pruneStale,
  pruneUnseenInRegions,
  recordPayload,
  upsertComplexInfo,
  upsertListings,
  upsertRents,
  upsertTrades,
} from "./repo";
import { parseNaverPayloads } from "@/lib/data/naver-import";
import { classifySeango } from "@/lib/seango/classifier";

function article(no: string, text: string, price = 650_000_000) {
  return {
    complexName: "테스트마을",
    complexNumber: 9001,
    articleNumber: no,
    dongName: "101",
    tradeType: "A1",
    spaceInfo: { supplySpace: 110, exclusiveSpace: 84.9, supplySpaceName: "110A" },
    brokerInfo: { brokerageName: `중개사${no}`, brokerName: "매경부동산" },
    articleDetail: { articleFeatureDescription: text, floorInfo: "7/20" },
    address: { city: "경기도", division: "용인시 기흥구", sector: "구갈동", coordinates: { xCoordinate: 127.11, yCoordinate: 37.27 } },
    priceInfo: { dealPrice: price },
  };
}

function listPayload(groups: { rep: string; ads: [string, string][] }[]) {
  return {
    isSuccess: true,
    result: {
      list: groups.map((g) => ({
        representativeArticleInfo: article(g.rep, g.ads[0][1]),
        duplicatedArticleInfo: { articleInfoList: g.ads.map(([no, t]) => article(no, t)) },
      })),
    },
  };
}

function detailPayload(no: string, extra: Record<string, unknown>) {
  return {
    isSuccess: true,
    result: {
      priceInfo: { price: 650_000_000, previousDeposit: 400_000_000, previousMonthlyRent: 0, isLeaseHold: true, ...extra },
      detailInfo: {
        articleDetailInfo: { articleNumber: no, articleDescription: "전세 4억 승계 조건" },
        movingInInfo: { movingInType: "MV004", movingInDate: "2027-08-01", movingInNegotiation: false },
        spaceInfo: { roomCount: 3 },
      },
    },
  };
}

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "silipju-db-"));
  db = openDb(path.join(dir, "t.db"));
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function ingest(payload: unknown) {
  const p = parseNaverPayloads([payload]);
  return upsertListings(db, p.complexes, p.units, p.details);
}

describe("upsertListings / loadListings", () => {
  it("목록을 적재하면 단지·매물 그룹·광고가 그대로 복원된다", () => {
    ingest(listPayload([{ rep: "A1", ads: [["A1", "남향 로얄층"], ["A2", "세안고 급매"]] }]));
    const { complexes, units } = loadListings(db);
    expect(complexes).toHaveLength(1);
    expect(complexes[0].region.isRegulated).toBe(true);
    expect(units).toHaveLength(1);
    expect(units[0].ads.map((a) => a.featureText).sort()).toEqual(["남향 로얄층", "세안고 급매"]);
  });

  it("상세가 목록보다 먼저 들어와도 나중에 합쳐진다", () => {
    ingest(detailPayload("A2", {}));
    expect(loadListings(db).units).toHaveLength(0);
    ingest(listPayload([{ rep: "A1", ads: [["A1", "남향"], ["A2", "올수리"]] }]));
    const ad = loadListings(db).units[0].ads.find((a) => a.articleNo === "A2")!;
    expect(ad.isLeaseHold).toBe(true);
    expect(ad.previousDeposit).toBe(400_000_000);
    expect(ad.movingIn).toEqual({ type: "MV004", date: "2027-08-01", negotiable: false });
    expect(ad.description).toContain("승계");
  });

  it("다시 수집하면 가격이 갱신되고, 대표 광고가 바뀌어 빈 그룹이 생기면 정리된다", () => {
    ingest(listPayload([{ rep: "A1", ads: [["A1", "남향"], ["A2", "올수리"]] }]));
    ingest(listPayload([{ rep: "A2", ads: [["A2", "올수리"], ["A1", "남향"]] }]));
    const { units } = loadListings(db);
    expect(units.map((u) => u.id)).toEqual(["naver-A2"]);
    expect(counts(db).units).toBe(1);
  });

  it("오래 수집되지 않은 매물은 prune으로 지워진다", () => {
    const p = parseNaverPayloads([listPayload([{ rep: "A1", ads: [["A1", "남향"]] }])]);
    upsertListings(db, p.complexes, p.units, p.details, "2026-09-01T00:00:00.000Z");
    const r = pruneStale(db, 21, new Date("2026-10-24T00:00:00Z"));
    expect(r).toMatchObject({ ads: 1, units: 1, complexes: 1 });
  });

  it("같은 원본은 한 번만 기록된다", () => {
    expect(recordPayload(db, "abc", "inbox", 10, 1, 0)).toBe(true);
    expect(recordPayload(db, "abc", "inbox", 10, 1, 0)).toBe(false);
  });
});

describe("지도 매물 목록(boundedArticles)", () => {
  it("여러 단지가 섞인 지도 목록 한 페이지를 단지별로 나눠 적재하고 분양권(B01)은 뺀다", () => {
    const other = { ...article("B1", "주인거주 즉시입주"), complexName: "옆단지", complexNumber: 9002 };
    const presale = { ...article("C1", "분양권 급매"), complexName: "분양단지", complexNumber: 9003, realEstateType: "B01" };
    const payload = {
      isSuccess: true,
      result: {
        hasNextPage: true,
        lastInfo: [1],
        list: [
          { representativeArticleInfo: article("A1", "세안고"), duplicatedArticleInfo: { articleInfoList: [article("A1", "세안고"), article("A2", "남향")] } },
          { representativeArticleInfo: other },
          { representativeArticleInfo: presale },
        ],
      },
    };
    ingest(payload);
    const { complexes, units } = loadListings(db);
    expect(complexes.map((c) => c.name).sort()).toEqual(["옆단지", "테스트마을"]);
    expect(units).toHaveLength(2);
  });
});

describe("세대수(지도 단지 마커)·지역 재수집 정리", () => {
  const clusters = {
    isSuccess: true,
    result: {
      totalCount: 2,
      clusters: [
        { complexNumber: 9001, realEstateType: "A01", totalHouseholdNumber: 1520, useApprovalDate: "20120530", floorAreaRatio: 249 },
        { complexNumber: 9002, realEstateType: "B01", totalHouseholdNumber: 300, useApprovalDate: "20290101" },
      ],
      points: [{ complexNumber: 9003, realEstateType: "A01", totalHouseholdNumber: 438, useApprovalDate: "20020906" }],
    },
  };

  it("단지 마커가 목록보다 먼저 와도 나중에 적재된 단지에 세대수가 채워진다(clusters와 points 모두)", () => {
    const parsed = parseNaverPayloads([clusters]);
    expect(parsed.complexInfos).toEqual([
      { id: "naver-9001", households: 1520, approvalDate: "20120530", floorAreaRatio: 249 },
      { id: "naver-9003", households: 438, approvalDate: "20020906", floorAreaRatio: null },
    ]);
    upsertComplexInfo(db, parsed.complexInfos);
    ingest(listPayload([{ rep: "A1", ads: [["A1", "남향 로얄층"]] }]));
    expect(loadListings(db).complexes[0].households).toBe(1520);
  });

  it("이미 있는 단지는 단지 마커가 들어오는 즉시 세대수가 채워진다", () => {
    ingest(listPayload([{ rep: "A1", ads: [["A1", "남향 로얄층"]] }]));
    expect(upsertComplexInfo(db, parseNaverPayloads([clusters]).complexInfos)).toBe(1);
    expect(loadListings(db).complexes[0].households).toBe(1520);
  });

  it("세대수가 빈 단지만 고른 지역(시 이름 앞부분 일치) 안에서 찾는다", () => {
    ingest(listPayload([{ rep: "A1", ads: [["A1", "남향 로얄층"]] }]));
    expect(complexesMissingHouseholds(db, [{ sido: "경기도", name: "용인시" }]).map((c) => c.id)).toEqual(["naver-9001"]);
    expect(complexesMissingHouseholds(db, [{ sido: "경기도", name: "용인" }])).toEqual([]);
    expect(complexesMissingHouseholds(db, [{ sido: "경기도", name: "수원시" }])).toEqual([]);
    upsertComplexInfo(db, parseNaverPayloads([clusters]).complexInfos);
    expect(complexesMissingHouseholds(db, [{ sido: "경기도", name: "용인시" }])).toEqual([]);
  });

  it("지역을 다시 수집했을 때 그 사이 안 보인 매물만 지우고 다른 지역은 건드리지 않는다", () => {
    const old = parseNaverPayloads([listPayload([{ rep: "OLD", ads: [["OLD", "오래된 매물"]] }])]);
    upsertListings(db, old.complexes, old.units, old.details, "2026-10-01T00:00:00.000Z");
    ingest(listPayload([{ rep: "NEW", ads: [["NEW", "오늘 본 매물"]] }]));
    expect(pruneUnseenInRegions(db, "2026-10-24T00:00:00.000Z", [{ sido: "서울특별시", name: "용인시" }])).toEqual({ ads: 0, units: 0, complexes: 0 });
    const removed = pruneUnseenInRegions(db, "2026-10-24T00:00:00.000Z", [{ sido: "경기도", name: "용인시" }]);
    expect(removed).toEqual({ ads: 1, units: 1, complexes: 0 });
    expect(loadListings(db).units.map((u) => u.id)).toEqual(["naver-NEW"]);
  });
});

describe("실거래·전월세", () => {
  it("중복 행은 한 번만 들어가고 단지명이 포함 관계면 찾는다", () => {
    const row = { lawdCd: "41463", aptName: "테스트마을3단지", umdName: "구갈동", jibun: "1", exclusiveArea: 84.9, floor: 7, price: 640_000_000, dealDate: "2026-09-10", dealingType: "중개거래" };
    expect(upsertTrades(db, [row, row])).toBe(1);
    expect(findTrades(db, "41463", "테스트마을")).toHaveLength(1);
    expect(findTrades(db, "41463", "다른마을")).toHaveLength(0);
  });

  it("같은 층·면적의 진행 중 전세 계약이 있으면 약한 세안고 단서가 붙는다", () => {
    upsertRents(db, [
      { lawdCd: "41463", aptName: "테스트마을", umdName: "구갈동", jibun: "1", exclusiveArea: 84.9, floor: 7, deposit: 400_000_000, monthlyRent: 0, contractDate: "2025-03-15", contractTerm: "25.04~27.04", contractType: "신규", useRRRight: null },
    ]);
    ingest(listPayload([{ rep: "A1", ads: [["A1", "남향 로얄층"]] }]));
    const unit = loadListings(db).units[0];
    const leases = findRents(db, "41463", "테스트마을");
    const r = classifySeango(unit, { now: new Date("2026-10-24"), acceptMoveInWithinMonths: 3, leases });
    const ev = r.evidence.find((e) => e.kind === "rent-record");
    expect(ev?.label).toContain("2027-04까지");
    expect(r.probability).toBeGreaterThan(classifySeango(unit, { now: new Date("2026-10-24"), acceptMoveInWithinMonths: 3 }).probability);
  });
});
