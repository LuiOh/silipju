// 대출 한도·방공제·취득세·중개보수·필요현금 계산 테스트(2026-10-24 규정 기준)

import { describe, expect, it } from "vitest";
import type { Household, LoanOptions } from "@/lib/types";
import {
  acquisitionTaxRate,
  brokerageFee,
  computeFinance,
  quoteBank,
  quoteBogeumjari,
  quoteDidimdol,
  quoteNewborn,
  stressRate,
} from "./calculator";
import { resolveRegion } from "./regions";

const giheung = resolveRegion("경기", "용인시 기흥구");
const cheoin = resolveRegion("경기", "용인시 처인구");
const seoul = resolveRegion("서울", "노원구");
const icheon = resolveRegion("경기", "이천시");

const household: Household = {
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
};

const loan: LoanOptions = {
  products: ["bank", "bogeumjari", "didimdol"],
  rates: { bank: 5.2, bogeumjari: 4.6, didimdol: 3.5, newborn: 3.0 },
  bankRateType: "periodic5",
  termYears: 30,
  useMciMcg: false,
  bankSelfCap: null,
  autoRates: false,
};

describe("지역 판정", () => {
  it("2026-07-01 추가 지정된 용인 기흥구는 규제지역, 처인구는 비규제", () => {
    expect(giheung.isRegulated).toBe(true);
    expect(cheoin.isRegulated).toBe(false);
    expect(cheoin.isCapitalArea).toBe(true);
  });
  it("방공제 구간: 서울 5,500만, 용인 4,800만, 이천 2,800만", () => {
    expect(seoul.roomDeductionBucket).toBe("seoul");
    expect(giheung.roomDeductionBucket).toBe("overcrowded");
    expect(icheon.roomDeductionBucket).toBe("metro");
  });
});

describe("세금·수수료", () => {
  it("취득세율: 6억 1%, 7억 1.6667%, 9억 3%, 10억 3%", () => {
    expect(acquisitionTaxRate(600_000_000)).toBe(0.01);
    expect(acquisitionTaxRate(700_000_000)).toBeCloseTo(0.016667, 6);
    expect(acquisitionTaxRate(900_000_000)).toBeCloseTo(0.03, 6);
    expect(acquisitionTaxRate(1_000_000_000)).toBe(0.03);
  });
  it("중개보수: 6.5억은 0.4% + VAT = 286만원", () => {
    expect(brokerageFee(650_000_000)).toBe(2_860_000);
  });
});

describe("대출 한도", () => {
  it("스트레스 금리: 수도권 5년 주기형 30년 +1.2%p, 변동형 +3.0%p", () => {
    expect(stressRate(giheung, "periodic5", 30)).toBe(1.2);
    expect(stressRate(giheung, "variable", 30)).toBe(3.0);
  });

  it("은행: 기흥 6.5억 생애최초 → LTV 70% − 방공제 4,800만 = 4.07억", () => {
    const q = quoteBank({ price: 650_000_000, exclusiveArea: 84.9, region: giheung }, household, loan);
    expect(q.ltvRate).toBe(0.7);
    expect(q.roomDeduction).toBe(48_000_000);
    expect(q.maxLoan).toBe(407_000_000);
    expect(q.limitingFactor).toBe("ltv");
  });

  it("은행: 무주택(생애최초 아님) 규제지역은 LTV 40%", () => {
    const q = quoteBank({ price: 650_000_000, exclusiveArea: 84.9, region: giheung }, { ...household, firstTimeBuyer: false, annualIncome: 120_000_000 }, loan);
    expect(q.ltvRate).toBe(0.4);
  });

  it("은행: MCI/MCG 가입 시 방공제 없음, 소득이 낮으면 DSR이 한도를 막음", () => {
    const q = quoteBank({ price: 650_000_000, exclusiveArea: 84.9, region: giheung }, { ...household, annualIncome: 50_000_000 }, { ...loan, useMciMcg: true });
    expect(q.roomDeduction).toBe(0);
    expect(q.limitingFactor).toBe("dsr");
    expect(q.maxLoan).toBeLessThan(455_000_000);
  });

  it("은행: 유주택자는 수도권 구입 주담대 불가", () => {
    const q = quoteBank({ price: 650_000_000, exclusiveArea: 84.9, region: cheoin }, { ...household, homeless: false, firstTimeBuyer: false }, loan);
    expect(q.eligible).toBe(false);
  });

  it("보금자리론: 소득 8천만은 일반 불가, 신혼이면 가능(8,500만)하고 아파트는 방공제 없이 LTV 70%", () => {
    const p = { price: 580_000_000, exclusiveArea: 84.9, region: giheung };
    expect(quoteBogeumjari(p, household, loan).eligible).toBe(false);
    const q = quoteBogeumjari(p, { ...household, newlywed: true }, loan);
    expect(q.eligible).toBe(true);
    expect(q.capAmount).toBe(420_000_000);
    expect(q.roomDeduction).toBe(0);
    expect(q.maxLoan).toBe(406_000_000);
  });

  it("보금자리론 신혼 1인 소득 기준(2026-10-19~): 합산 9천만이어도 한 명이 7천만 이하면 그 사람 명의로 가능", () => {
    const p = { price: 550_000_000, exclusiveArea: 84.9, region: giheung };
    const newlywed = { ...household, firstTimeBuyer: false, newlywed: true, annualIncome: 90_000_000 };

    const noSingle = quoteBogeumjari(p, newlywed, loan);
    expect(noSingle.eligible).toBe(false);
    expect(noSingle.reasons[0]).toBe("부부합산 소득 8,500만 초과");
    expect(noSingle.reasons.join(" ")).toContain("부부 중 한 명");

    const q = quoteBogeumjari(p, { ...newlywed, singleIncome: 60_000_000 }, loan);
    expect(q.eligible).toBe(true);
    expect(q.ltvRate).toBeCloseTo(0.6);
    expect(q.maxLoan).toBe(330_000_000);
    expect(q.notes.some((n) => n.includes("1인 소득"))).toBe(true);

    const lowSingle = quoteBogeumjari(p, { ...newlywed, singleIncome: 30_000_000 }, loan);
    expect(lowSingle.limitingFactor).toBe("dti");
    expect(lowSingle.maxLoan).toBe(Math.floor(lowSingle.incomeLimitAmount! / 1_000_000) * 1_000_000);
    expect(lowSingle.maxLoan).toBeLessThan(q.maxLoan);

    const notNewlywed = quoteBogeumjari(p, { ...newlywed, newlywed: false, singleIncome: 60_000_000 }, loan);
    expect(notNewlywed.eligible).toBe(false);
    expect(notNewlywed.reasons.join(" ")).toContain("신혼가구(혼인 7년 이내·3개월 내 결혼 예정)만");
  });

  it("신생아 특례: 6억 이하는 방공제 면제, 6억 초과는 방공제", () => {
    const h = { ...household, newbornWithin2y: true };
    expect(quoteNewborn({ price: 580_000_000, exclusiveArea: 84.9, region: giheung }, h, loan).roomDeduction).toBe(0);
    expect(quoteNewborn({ price: 700_000_000, exclusiveArea: 84.9, region: giheung }, h, loan).roomDeduction).toBe(48_000_000);
  });

  it("디딤돌: 수도권 아파트는 MCG를 선택해도 방공제 의무", () => {
    const q = quoteDidimdol(
      { price: 480_000_000, exclusiveArea: 84.9, region: cheoin },
      { ...household, annualIncome: 65_000_000 },
      { ...loan, useMciMcg: true },
    );
    expect(q.eligible).toBe(true);
    expect(q.roomDeduction).toBe(48_000_000);
    expect(q.maxLoan).toBe(240_000_000);
  });
});

describe("필요 현금", () => {
  it("매매가 + 부대비용 − 최대 대출, 보유현금과 비교", () => {
    const f = computeFinance({ price: 650_000_000, exclusiveArea: 84.9, region: giheung }, household, loan, null);
    expect(f.best?.product).toBe("bank");
    expect(f.requiredCash).toBe(650_000_000 + f.costs.total - 407_000_000);
    expect(f.costs.taxRelief).toBe(2_000_000);
    expect(f.affordable).toBe(f.requiredCash <= household.cash);
  });

  it("세안고로 살 때 필요현금은 보증금 승계 기준으로 따로 계산", () => {
    const f = computeFinance({ price: 650_000_000, exclusiveArea: 84.9, region: giheung }, household, loan, 400_000_000);
    expect(f.seangoCash).not.toBeNull();
    expect(f.seangoCash!).toBeLessThan(650_000_000 - 400_000_000 + 30_000_000);
  });
});
