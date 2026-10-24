// 대출 상품별 한도(LTV·방공제·상한·DSR/DTI)와 취득 부대비용으로 필요 현금을 계산

import type {
  CostBreakdown,
  FinanceResult,
  Household,
  LimitingFactor,
  LoanOptions,
  LoanProductId,
  LoanQuote,
  RateType,
  RegionInfo,
} from "@/lib/types";
import { formatWon } from "@/lib/format";
import {
  ACQUISITION_TAX,
  BANK_DSR_LIMIT,
  BANK_LTV,
  BOGEUMJARI,
  BOND_DISCOUNT_RATE,
  BROKERAGE_TIERS,
  CAPITAL_MAX_TERM_YEARS,
  DIDIMDOL,
  DSR_APPLY_THRESHOLD,
  HOUSING_BOND_RATES,
  LOAN_PRODUCTS,
  LOW_INCOME_BUYER,
  MORTGAGE_BOND,
  NEWBORN,
  OFFICIAL_PRICE_RATIO,
  PRICE_TIER_CAPS,
  ROOM_DEDUCTION,
  ROOM_DEDUCTION_LABEL,
  STRESS_RATE,
  VAT,
} from "./policy";

export interface PropertyInput {
  price: number;
  exclusiveArea: number;
  region: RegionInfo;
}

const MAN = 10_000;
const floorTo = (won: number, unit = 1_000_000) => Math.max(0, Math.floor(won / unit) * unit);

/** 원리금균등 상환 시 대출 1원당 월 상환액 */
export function paymentFactor(annualRatePct: number, years: number): number {
  const n = years * 12;
  const r = annualRatePct / 100 / 12;
  if (r === 0) return 1 / n;
  return r / (1 - Math.pow(1 + r, -n));
}

export function monthlyPayment(principal: number, annualRatePct: number, years: number): number {
  return Math.round(principal * paymentFactor(annualRatePct, years));
}

function maxPrincipalByAnnualPayment(annualBudget: number, annualRatePct: number, years: number): number {
  if (annualBudget <= 0) return 0;
  return annualBudget / (12 * paymentFactor(annualRatePct, years));
}

export function stressRate(region: RegionInfo, rateType: RateType, termYears: number): number {
  const table = region.isCapitalArea || region.isRegulated ? STRESS_RATE.capital : STRESS_RATE.local;
  if (rateType === "variable") return table.variable;
  const fixedShare = 5 / termYears;
  const idx = fixedShare < 0.3 ? 0 : fixedShare < 0.5 ? 1 : fixedShare < 0.7 ? 2 : 3;
  return rateType === "mixed5" ? table.mixed[idx] : table.periodic[idx];
}

function productName(id: LoanProductId): string {
  return LOAN_PRODUCTS.find((p) => p.id === id)?.name ?? id;
}

function isFirstTime(h: Household): boolean {
  return h.homeless && h.firstTimeBuyer;
}

function capitalOrRegulated(r: RegionInfo): boolean {
  return r.isCapitalArea || r.isRegulated;
}

interface Limits {
  ltvAmount: number;
  roomDeduction: number;
  cap: number | null;
  capFactor: LimitingFactor;
  income: number | null;
  incomeFactor: LimitingFactor;
  bankCap: number | null;
}

function resolveLimit(l: Limits): { maxLoan: number; factor: LimitingFactor } {
  const candidates: { v: number; f: LimitingFactor }[] = [{ v: Math.max(0, l.ltvAmount - l.roomDeduction), f: "ltv" }];
  if (l.cap !== null) candidates.push({ v: l.cap, f: l.capFactor });
  if (l.income !== null) candidates.push({ v: l.income, f: l.incomeFactor });
  if (l.bankCap !== null) candidates.push({ v: l.bankCap, f: "bank-cap" });
  const min = candidates.reduce((a, b) => (b.v < a.v ? b : a));
  return { maxLoan: floorTo(min.v), factor: min.f };
}

function ineligible(id: LoanProductId, rate: number, termYears: number, reasons: string[]): LoanQuote {
  return {
    product: id,
    productName: productName(id),
    eligible: false,
    reasons,
    maxLoan: 0,
    limitingFactor: "ineligible",
    ltvRate: 0,
    ltvAmount: 0,
    roomDeduction: 0,
    capAmount: null,
    incomeLimitAmount: null,
    rate,
    stressRate: 0,
    termYears,
    monthlyPayment: 0,
    notes: [],
  };
}

function roomDeductionNote(region: RegionInfo, applied: number, why: string): string {
  return applied > 0
    ? `방공제 ${Math.round(applied / MAN).toLocaleString()}만원 차감(${ROOM_DEDUCTION_LABEL[region.roomDeductionBucket]}, 아파트 1실) — ${why}`
    : `방공제 없음 — ${why}`;
}

export function quoteBank(p: PropertyInput, h: Household, o: LoanOptions): LoanQuote {
  const rate = o.rates.bank;
  const term = capitalOrRegulated(p.region) ? Math.min(o.termYears, CAPITAL_MAX_TERM_YEARS) : o.termYears;
  const regionKey = p.region.isRegulated ? "regulated" : p.region.isCapitalArea ? "capitalNonRegulated" : "localNonRegulated";
  const table = BANK_LTV[regionKey];
  const lowIncome = h.homeless && h.annualIncome <= LOW_INCOME_BUYER.incomeMax && p.price <= LOW_INCOME_BUYER.priceMax;

  let ltvRate: number = table.owner;
  let borrowerLabel = "유주택(기존 주택 처분 안 함)";
  if (h.homeless) {
    ltvRate = table.homeless;
    borrowerLabel = "무주택";
    if (lowIncome && table.lowIncome > ltvRate) {
      ltvRate = table.lowIncome;
      borrowerLabel = "서민실수요자";
    }
    if (h.firstTimeBuyer && table.firstTime > ltvRate) {
      ltvRate = table.firstTime;
      borrowerLabel = "생애최초";
    }
  }
  if (ltvRate === 0) {
    return ineligible("bank", rate, term, [`${borrowerLabel}: 수도권·규제지역 구입용 주담대 불가(LTV 0%)`]);
  }

  const ltvAmount = p.price * ltvRate;
  const roomDeduction = o.useMciMcg ? 0 : ROOM_DEDUCTION[p.region.roomDeductionBucket];
  const tierCap = capitalOrRegulated(p.region) ? PRICE_TIER_CAPS.find((t) => p.price <= t.priceMax)!.cap : null;
  const stress = stressRate(p.region, o.bankRateType, term);
  const preIncome = Math.min(Math.max(0, ltvAmount - roomDeduction), tierCap ?? Infinity, o.bankSelfCap ?? Infinity);
  const dsrApplies = preIncome > DSR_APPLY_THRESHOLD;
  const dsrMax = dsrApplies
    ? maxPrincipalByAnnualPayment(h.annualIncome * BANK_DSR_LIMIT - h.existingAnnualDebtPayment, rate + stress, term)
    : null;

  const { maxLoan, factor } = resolveLimit({
    ltvAmount,
    roomDeduction,
    cap: tierCap,
    capFactor: "cap",
    income: dsrMax,
    incomeFactor: "dsr",
    bankCap: o.bankSelfCap,
  });

  const notes = [
    `${borrowerLabel} LTV ${Math.round(ltvRate * 100)}% (${p.region.isRegulated ? "규제지역" : p.region.isCapitalArea ? "수도권 비규제" : "지방 비규제"})`,
    roomDeductionNote(
      p.region,
      roomDeduction,
      o.useMciMcg ? "은행이 MCI·MCG 가입을 받아 주는 경우" : "MCI·MCG 미가입(2026년 대형 은행 대부분 가입 제한)",
    ),
  ];
  if (tierCap !== null) notes.push(`수도권·규제지역 구입 주담대 상한 ${tierCap / 100_000_000}억(시가 구간별 6/4/2억)`);
  if (dsrApplies) notes.push(`스트레스 DSR 40%: 금리 ${rate}% + 가산 ${stress.toFixed(2)}%p로 한도 산정`);
  else notes.push("대출 1억 이하로 차주단위 DSR 미적용 가정");
  if (capitalOrRegulated(p.region)) notes.push("수도권·규제지역: 만기 30년 이내, 6개월 내 전입 의무");
  notes.push("시세=매매가로 가정(실제 한도는 KB시세·감정가 기준)");

  return {
    product: "bank",
    productName: productName("bank"),
    eligible: maxLoan > 0,
    reasons: maxLoan > 0 ? [] : ["소득 대비 상환 여력(DSR) 부족"],
    maxLoan,
    limitingFactor: factor,
    ltvRate,
    ltvAmount: Math.round(ltvAmount),
    roomDeduction,
    capAmount: tierCap,
    incomeLimitAmount: dsrMax === null ? null : Math.round(dsrMax),
    rate,
    stressRate: dsrApplies ? stress : 0,
    termYears: term,
    monthlyPayment: monthlyPayment(maxLoan, rate, term),
    notes,
  };
}

export function quoteBogeumjari(p: PropertyInput, h: Household, o: LoanOptions): LoanQuote {
  const rate = o.rates.bogeumjari;
  const term = Math.min(o.termYears, BOGEUMJARI.maxTermYears);
  const reasons: string[] = [];
  if (!h.homeless) reasons.push("무주택(또는 일시적 2주택)만 가능");
  if (p.price > BOGEUMJARI.priceMax) reasons.push("주택가격 6억 초과");
  const incomeMax = Math.max(
    BOGEUMJARI.incomeMax.base,
    h.newlywed ? BOGEUMJARI.incomeMax.newlywed : 0,
    h.childrenCount === 1 ? BOGEUMJARI.incomeMax.oneChild : 0,
    h.childrenCount >= 2 ? BOGEUMJARI.incomeMax.twoPlusChildren : 0,
  );
  const singleIncome = h.singleIncome !== null && h.singleIncome > 0 ? h.singleIncome : null;
  const singleRoute =
    h.annualIncome > incomeMax && h.newlywed && singleIncome !== null && singleIncome <= BOGEUMJARI.newlywedSingleIncomeMax;
  if (h.annualIncome > incomeMax && !singleRoute) {
    reasons.push(`부부합산 소득 ${formatWon(incomeMax)} 초과`);
    reasons.push(
      h.newlywed
        ? "신혼가구는 부부 중 한 명 소득이 7천만 이하면 그 사람 명의로 가능합니다. 조건의 '부부 중 한 명 연소득'을 넣어 보세요."
        : "부부 중 한 명 7천만 기준(2026-10-19~)은 신혼가구(혼인 7년 이내·3개월 내 결혼 예정)만 쓸 수 있습니다. 신혼이라면 조건에서 '신혼'을 켜세요.",
    );
  }
  if (reasons.length > 0) return ineligible("bogeumjari", rate, term, reasons);

  const firstTime = isFirstTime(h);
  const realDemand =
    h.homeless && p.price <= BOGEUMJARI.realDemand.priceMax && h.annualIncome <= BOGEUMJARI.realDemand.incomeMax;
  let ltvRate: number = BOGEUMJARI.ltv.apartment;
  if (firstTime) ltvRate = capitalOrRegulated(p.region) ? BOGEUMJARI.ltv.firstTimeCapital : BOGEUMJARI.ltv.firstTime;
  else if (p.region.isRegulated && !realDemand) ltvRate -= BOGEUMJARI.ltv.regulatedDeduction;
  const limit = firstTime
    ? BOGEUMJARI.limit.firstTime
    : h.childrenCount >= 3
      ? BOGEUMJARI.limit.multiChild
      : BOGEUMJARI.limit.base;
  const dti = p.region.isRegulated && !(firstTime || realDemand) ? BOGEUMJARI.dti.regulated : BOGEUMJARI.dti.base;
  const ltvAmount = p.price * ltvRate;
  const roomDeduction = 0;
  const dtiIncome = singleRoute ? singleIncome : h.annualIncome;
  const dtiMax = maxPrincipalByAnnualPayment(dtiIncome * dti - h.existingAnnualDebtPayment, rate, term);
  const { maxLoan, factor } = resolveLimit({
    ltvAmount,
    roomDeduction,
    cap: limit,
    capFactor: "product-limit",
    income: dtiMax,
    incomeFactor: "dti",
    bankCap: null,
  });
  const notes = [
    `LTV ${Math.round(ltvRate * 100)}%${firstTime ? "(생애최초)" : realDemand ? "(실수요자, 규제지역 차감 없음)" : ""}, 한도 ${limit / 100_000_000}억`,
    singleRoute
      ? `신혼 1인 소득 기준(2026-10-19~): 연소득 ${formatWon(dtiIncome)}인 배우자 명의, DTI ${Math.round(dti * 100)}%를 그 1인 소득으로 심사`
      : `DTI ${Math.round(dti * 100)}% 적용(차주단위 DSR 대신)`,
    "아파트는 방공제 없음(주택금융공사 한도 산식, 기존 임차보증금이 있으면 따로 뺌)",
    "수도권·규제지역 6개월 내 전입 의무, 만기 40년은 만 40세 미만·50년은 만 35세 미만(신혼은 각 50세·40세 미만)",
  ];
  if (singleRoute) notes.push("기존 대출 원리금은 가구 전체 값을 그대로 넣었습니다. 신청인 본인 부채만 보면 한도가 더 나올 수 있습니다.");
  return {
    product: "bogeumjari",
    productName: productName("bogeumjari"),
    eligible: maxLoan > 0,
    reasons: maxLoan > 0 ? [] : ["DTI 기준 상환 여력 부족"],
    maxLoan,
    limitingFactor: factor,
    ltvRate,
    ltvAmount: Math.round(ltvAmount),
    roomDeduction,
    capAmount: limit,
    incomeLimitAmount: Math.round(dtiMax),
    rate,
    stressRate: 0,
    termYears: term,
    monthlyPayment: monthlyPayment(maxLoan, rate, term),
    notes,
  };
}

export function quoteDidimdol(p: PropertyInput, h: Household, o: LoanOptions): LoanQuote {
  const rate = o.rates.didimdol;
  const term = Math.min(o.termYears, DIDIMDOL.maxTermYears);
  const twoChildren = h.childrenCount >= 2;
  const reasons: string[] = [];
  if (!h.homeless) reasons.push("무주택 세대주만 가능");
  const priceMax = h.newlywed || twoChildren ? DIDIMDOL.priceMax.newlywedOrTwoChildren : DIDIMDOL.priceMax.base;
  if (p.price > priceMax) reasons.push(`주택가격 ${priceMax / 100_000_000}억 초과`);
  if (p.exclusiveArea > DIDIMDOL.areaMax) reasons.push("전용 85㎡ 초과");
  const incomeMax = Math.max(
    DIDIMDOL.incomeMax.base,
    h.firstTimeBuyer || twoChildren ? DIDIMDOL.incomeMax.firstTimeOrTwoChildren : 0,
    h.newlywed ? DIDIMDOL.incomeMax.newlywed : 0,
  );
  if (h.annualIncome > incomeMax) reasons.push(`소득 ${formatWon(incomeMax)} 초과`);
  if (h.netAssets !== null && h.netAssets > DIDIMDOL.netAssetsMax) reasons.push("순자산 5.11억 초과");
  if (reasons.length > 0) return ineligible("didimdol", rate, term, reasons);

  const firstTime = isFirstTime(h);
  const ltvRate = firstTime
    ? capitalOrRegulated(p.region)
      ? DIDIMDOL.ltv.firstTimeCapital
      : DIDIMDOL.ltv.firstTime
    : DIDIMDOL.ltv.base;
  const limit = Math.max(
    DIDIMDOL.limit.base,
    firstTime ? DIDIMDOL.limit.firstTime : 0,
    h.newlywed || twoChildren ? DIDIMDOL.limit.newlywedOrTwoChildren : 0,
  );
  const exempt =
    h.annualIncome <= DIDIMDOL.roomDeductionExemption.incomeMax && p.price <= DIDIMDOL.roomDeductionExemption.priceMax;
  const mandatory = p.region.isCapitalArea && !exempt;
  const roomDeduction = mandatory ? ROOM_DEDUCTION[p.region.roomDeductionBucket] : 0;
  const ltvAmount = p.price * ltvRate;
  const dtiMax = maxPrincipalByAnnualPayment(h.annualIncome * DIDIMDOL.dti - h.existingAnnualDebtPayment, rate, term);
  const { maxLoan, factor } = resolveLimit({
    ltvAmount,
    roomDeduction,
    cap: limit,
    capFactor: "product-limit",
    income: dtiMax,
    incomeFactor: "dti",
    bankCap: null,
  });
  return {
    product: "didimdol",
    productName: productName("didimdol"),
    eligible: maxLoan > 0,
    reasons: maxLoan > 0 ? [] : ["DTI 기준 상환 여력 부족"],
    maxLoan,
    limitingFactor: factor,
    ltvRate,
    ltvAmount: Math.round(ltvAmount),
    roomDeduction,
    capAmount: limit,
    incomeLimitAmount: Math.round(dtiMax),
    rate,
    stressRate: 0,
    termYears: term,
    monthlyPayment: monthlyPayment(maxLoan, rate, term),
    notes: [
      `LTV ${Math.round(ltvRate * 100)}%${firstTime ? "(생애최초)" : ""}, 한도 ${limit / 100_000_000}억`,
      "DTI 60% 적용",
      roomDeductionNote(
        p.region,
        roomDeduction,
        mandatory ? "수도권 아파트 디딤돌은 생애최초·신혼이어도 방공제 의무(2024.12~)" : "MCG(구입자금보증) 가입 가능 지역·조건",
      ),
      "1개월 내 전입, 1년 이상 실거주 의무",
    ],
  };
}

export function quoteNewborn(p: PropertyInput, h: Household, o: LoanOptions): LoanQuote {
  const rate = o.rates.newborn;
  const term = Math.min(o.termYears, NEWBORN.maxTermYears);
  const reasons: string[] = [];
  if (!h.homeless) reasons.push("무주택 세대주만 가능(1주택자는 대환만)");
  if (!h.newbornWithin2y) reasons.push("2년 내 출산 가구 아님");
  if (p.price > NEWBORN.priceMax) reasons.push("주택가격 9억 초과");
  if (p.exclusiveArea > NEWBORN.areaMax) reasons.push("전용 85㎡ 초과");
  const incomeMax = h.dualIncome ? NEWBORN.incomeMax.dual : NEWBORN.incomeMax.single;
  if (h.annualIncome > incomeMax) reasons.push(`소득 ${formatWon(incomeMax)} 초과`);
  if (h.netAssets !== null && h.netAssets > NEWBORN.netAssetsMax) reasons.push("순자산 5.11억 초과");
  if (reasons.length > 0) return ineligible("newborn", rate, term, reasons);

  const firstTime = isFirstTime(h);
  const ltvRate = firstTime ? (capitalOrRegulated(p.region) ? NEWBORN.ltv.firstTimeCapital : NEWBORN.ltv.firstTime) : NEWBORN.ltv.base;
  const mandatory = p.price > NEWBORN.roomDeductionMandatoryAbove;
  const roomDeduction = mandatory ? ROOM_DEDUCTION[p.region.roomDeductionBucket] : 0;
  const ltvAmount = p.price * ltvRate;
  const dtiMax = maxPrincipalByAnnualPayment(h.annualIncome * NEWBORN.dti - h.existingAnnualDebtPayment, rate, term);
  const { maxLoan, factor } = resolveLimit({
    ltvAmount,
    roomDeduction,
    cap: NEWBORN.limit,
    capFactor: "product-limit",
    income: dtiMax,
    incomeFactor: "dti",
    bankCap: null,
  });
  return {
    product: "newborn",
    productName: productName("newborn"),
    eligible: maxLoan > 0,
    reasons: maxLoan > 0 ? [] : ["DTI 기준 상환 여력 부족"],
    maxLoan,
    limitingFactor: factor,
    ltvRate,
    ltvAmount: Math.round(ltvAmount),
    roomDeduction,
    capAmount: NEWBORN.limit,
    incomeLimitAmount: Math.round(dtiMax),
    rate,
    stressRate: 0,
    termYears: term,
    monthlyPayment: monthlyPayment(maxLoan, rate, term),
    notes: [
      `LTV ${Math.round(ltvRate * 100)}%${firstTime ? "(생애최초)" : ""}, 한도 4억`,
      "DTI 60% 적용",
      roomDeductionNote(p.region, roomDeduction, mandatory ? "6억 초과 주택 방공제 의무" : "신생아 특례 6억 이하 방공제 면제"),
      "1개월 내 전입, 1년 이상 실거주 의무",
    ],
  };
}

const QUOTERS: Record<LoanProductId, (p: PropertyInput, h: Household, o: LoanOptions) => LoanQuote> = {
  bank: quoteBank,
  bogeumjari: quoteBogeumjari,
  didimdol: quoteDidimdol,
  newborn: quoteNewborn,
};

export function acquisitionTaxRate(price: number): number {
  if (price <= ACQUISITION_TAX.lowMax) return ACQUISITION_TAX.lowRate;
  if (price > ACQUISITION_TAX.highMin) return ACQUISITION_TAX.highRate;
  // 지방세법 제11조: (취득가액 × 2/3억원 − 3) × 1/100, 백분율 소수 넷째 자리까지 반올림
  const pct = Math.round(((price / 100_000_000) * (2 / 3) - 3) * 10_000) / 10_000;
  return pct / 100;
}

export function brokerageFee(price: number): number {
  const tier = BROKERAGE_TIERS.find((t) => price < t.priceBelow)!;
  const fee = price * tier.rate;
  return Math.round((tier.cap === null ? fee : Math.min(fee, tier.cap)) * (1 + VAT));
}

function stampDuty(price: number, loan: number): number {
  const loanStamp = loan <= 50_000_000 ? 0 : loan <= 100_000_000 ? 35_000 : loan <= 1_000_000_000 ? 75_000 : 175_000;
  const contractStamp = price <= 100_000_000 ? 0 : price <= 1_000_000_000 ? 75_000 : 175_000;
  return loanStamp + contractStamp;
}

function housingBondCost(price: number, region: RegionInfo, loan: number): number {
  const official = price * OFFICIAL_PRICE_RATIO;
  const tier = HOUSING_BOND_RATES.find((t) => official < t.below)!;
  const purchase = Math.round((official * (region.isMetropolitanCity ? tier.metro : tier.other)) / MAN) * MAN;
  const mortgage = loan * MORTGAGE_BOND.maxClaimRatio * MORTGAGE_BOND.purchaseRate;
  return Math.round((purchase + mortgage) * BOND_DISCOUNT_RATE);
}

export function acquisitionCosts(p: PropertyInput, h: Household, loan: number): CostBreakdown {
  const acquisitionTax = Math.round(p.price * acquisitionTaxRate(p.price));
  let taxRelief = 0;
  if (isFirstTime(h) && p.price <= ACQUISITION_TAX.firstTimeRelief.priceMax) {
    taxRelief = Math.min(acquisitionTax, ACQUISITION_TAX.firstTimeRelief.cap);
  }
  if (h.newbornWithin2y && p.price <= ACQUISITION_TAX.newbornRelief.priceMax) {
    taxRelief = Math.max(taxRelief, Math.min(acquisitionTax, ACQUISITION_TAX.newbornRelief.cap));
  }
  const localEducationTax = Math.round((acquisitionTax - taxRelief) * ACQUISITION_TAX.educationRatio);
  const ruralSpecialTax = p.exclusiveArea > ACQUISITION_TAX.ruralAreaMin ? Math.round(p.price * ACQUISITION_TAX.ruralRate) : 0;
  const brokerage = brokerageFee(p.price);
  const legalFee = Math.round(Math.max(500_000, p.price * 0.001) * (1 + VAT) + 15_000);
  const bondCost = housingBondCost(p.price, p.region, loan);
  const stamp = stampDuty(p.price, loan);
  const total =
    acquisitionTax - taxRelief + localEducationTax + ruralSpecialTax + brokerage + legalFee + bondCost + stamp;
  return {
    acquisitionTax,
    taxRelief,
    localEducationTax,
    ruralSpecialTax,
    brokerageFee: brokerage,
    legalFee,
    bondCost,
    stampDuty: stamp,
    total,
  };
}

export function computeFinance(
  p: PropertyInput,
  h: Household,
  o: LoanOptions,
  seangoDeposit: number | null,
): FinanceResult {
  const quotes = o.products.map((id) => QUOTERS[id](p, h, o));
  const eligible = quotes.filter((q) => q.eligible && q.maxLoan > 0);
  const best = eligible.length
    ? eligible.reduce((a, b) => (b.maxLoan > a.maxLoan || (b.maxLoan === a.maxLoan && b.rate < a.rate) ? b : a))
    : null;
  const loan = best?.maxLoan ?? 0;
  const costs = acquisitionCosts(p, h, loan);
  const requiredCash = p.price + costs.total - loan;
  const seangoCash =
    seangoDeposit && seangoDeposit > 0 ? p.price + acquisitionCosts(p, h, 0).total - seangoDeposit : null;
  return {
    price: p.price,
    costs,
    best,
    quotes,
    requiredCash,
    cashGap: h.cash - requiredCash,
    affordable: h.cash >= requiredCash,
    seangoCash,
  };
}
