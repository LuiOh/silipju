// 2026-10-24 기준 대출·세금·중개보수 규정 수치(웹 조사 결과, 출처 URL 포함)

import type { LoanProductId, RoomDeductionBucket } from "@/lib/types";

export const POLICY_AS_OF = "2026-10-24";

export const POLICY_SOURCES: { label: string; url: string }[] = [
  { label: "금융위 10·15 대책(규제지역·구간별 한도 6/4/2억)", url: "https://www.fsc.go.kr/po010101/85432" },
  { label: "금융위 10·15 FAQ(차주별 LTV)", url: "https://www.fsc.go.kr/po020201/85466" },
  { label: "금융위 2026.6.30 규제지역 추가(동탄구·기흥구·구리)", url: "https://www.fsc.go.kr/po010101/87222" },
  { label: "은행연합회 스트레스 DSR", url: "https://portal.kfb.or.kr/compare/stress_loan.php" },
  { label: "주택금융공사 보금자리론", url: "https://www.hf.go.kr/ko/sub01/sub01_01_01.do" },
  { label: "보금자리론 신혼부부 1인 소득 7천만 기준(2026-10-19 신청분~)", url: "https://www.fsc.go.kr/no040101?cnId=3384" },
  { label: "보금자리론 신혼 1인 소득 기준 시행 세부(차주·DTI)", url: "https://www.yna.co.kr/view/AKR20260928129800002" },
  { label: "보금자리론 아파트 방공제 없음(예상대출조회 안내)", url: "https://www.hf.go.kr/ko/sub01/sub01_06_01.do" },
  { label: "은행 MCI·MCG 가입 제한·재개 현황(2026-10)", url: "https://www.m-i.kr/news/articleView.html?idxno=2006393" },
  { label: "마이홈 디딤돌대출", url: "https://www.myhome.go.kr/hws/portal/cont/selectSteppingStoneLoanView.do" },
  { label: "마이홈 신생아 특례 디딤돌", url: "https://www.myhome.go.kr/hws/portal/cont/selectBabySpecialCaseStepStoneLoneView.do" },
  { label: "국토부 디딤돌 방공제 의무화(수도권 아파트)", url: "https://www.korea.kr/news/policyNewsView.do?newsId=148935934" },
  { label: "주택임대차보호법 시행령(최우선변제금)", url: "https://www.law.go.kr/lsLinkCommonInfo.do?lspttninfSeq=130113" },
  { label: "지방세법 제11조(주택 취득세율)", url: "https://law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1021846727" },
  { label: "지방세특례제한법 제36조의3(생애최초 감면)", url: "https://www.law.go.kr/lsLinkProc.do?joNo=003603001&lsNm=%EC%A7%80%EB%B0%A9%EC%84%B8%ED%8A%B9%EB%A1%80%EC%A0%9C%ED%95%9C%EB%B2%95&mode=10" },
  { label: "공인중개사법 시행규칙 별표1(중개보수)", url: "https://www.myhome.go.kr/hws/portal/cont/selectHouseBrokerageFeeView.do" },
];

/** 은행 주담대 구입목적 LTV. 서민실수요자: 부부합산 9천만 이하·주택 8억 이하·무주택세대주 */
export const BANK_LTV = {
  regulated: { homeless: 0.4, firstTime: 0.7, lowIncome: 0.6, owner: 0 },
  capitalNonRegulated: { homeless: 0.7, firstTime: 0.7, lowIncome: 0.7, owner: 0 },
  localNonRegulated: { homeless: 0.7, firstTime: 0.8, lowIncome: 0.7, owner: 0.6 },
} as const;

export const LOW_INCOME_BUYER = { incomeMax: 90_000_000, priceMax: 800_000_000 };

/** 수도권 전역·규제지역 구입용 주담대 절대 상한(시가 구간별). 정책대출에는 적용하지 않음 */
export const PRICE_TIER_CAPS: { priceMax: number; cap: number }[] = [
  { priceMax: 1_500_000_000, cap: 600_000_000 },
  { priceMax: 2_500_000_000, cap: 400_000_000 },
  { priceMax: Number.POSITIVE_INFINITY, cap: 200_000_000 },
];

export const BANK_DSR_LIMIT = 0.4;
export const DSR_APPLY_THRESHOLD = 100_000_000;
export const CAPITAL_MAX_TERM_YEARS = 30;

/**
 * 스트레스 DSR 가산금리(%p). 고정기간/만기 비중 구간별 [<30%, 30~50%, 50~70%, ≥70%].
 * 수도권·규제지역 기준 3.0%, 지방 비규제 0.75%(2026-12-31까지).
 */
export const STRESS_RATE = {
  capital: { variable: 3.0, mixed: [2.4, 1.8, 1.2, 0], periodic: [1.2, 0.9, 0.6, 0] },
  local: { variable: 0.75, mixed: [0.45, 0.3, 0.15, 0], periodic: [0.23, 0.15, 0.08, 0] },
} as const;

export interface PolicyProductRule {
  id: LoanProductId;
  name: string;
  description: string;
  defaultRate: number;
}

export const LOAN_PRODUCTS: PolicyProductRule[] = [
  {
    id: "bank",
    name: "은행 주담대",
    description: "LTV·구간별 한도(6/4/2억)·스트레스 DSR 40% 적용",
    defaultRate: 5.2,
  },
  {
    id: "bogeumjari",
    name: "보금자리론",
    description: "주택가격 6억 이하·부부합산 소득 7천만(신혼 8,500만, 신혼은 1인 소득 7천만 이하도 가능) 이하, 한도 3.6억(생애최초 4.2억), 아파트 방공제 없음",
    defaultRate: 4.6,
  },
  {
    id: "didimdol",
    name: "디딤돌대출",
    description: "주택가격 5억(신혼·2자녀 6억) 이하·전용 85㎡ 이하, 한도 2억(생애최초 2.4억·신혼 3.2억)",
    defaultRate: 3.5,
  },
  {
    id: "newborn",
    name: "신생아 특례 디딤돌",
    description: "2년 내 출산 무주택, 주택가격 9억 이하·전용 85㎡ 이하, 한도 4억",
    defaultRate: 3.0,
  },
];

export const BOGEUMJARI = {
  priceMax: 600_000_000,
  incomeMax: { base: 70_000_000, newlywed: 85_000_000, oneChild: 90_000_000, twoPlusChildren: 100_000_000 },
  /** 신혼가구가 합산 기준을 넘을 때: 부부 중 1인 소득이 이 이하면 그 사람이 차주, DTI도 그 1인 소득으로 심사 */
  newlywedSingleIncomeMax: 70_000_000,
  limit: { base: 360_000_000, multiChild: 400_000_000, firstTime: 420_000_000 },
  ltv: { apartment: 0.7, regulatedDeduction: 0.1, firstTime: 0.8, firstTimeCapital: 0.7 },
  dti: { base: 0.6, regulated: 0.5 },
  realDemand: { priceMax: 600_000_000, incomeMax: 70_000_000 },
  maxTermYears: 50,
} as const;

export const DIDIMDOL = {
  priceMax: { base: 500_000_000, newlywedOrTwoChildren: 600_000_000 },
  areaMax: 85,
  incomeMax: { base: 60_000_000, firstTimeOrTwoChildren: 70_000_000, newlywed: 85_000_000 },
  netAssetsMax: 511_000_000,
  limit: { base: 200_000_000, firstTime: 240_000_000, newlywedOrTwoChildren: 320_000_000 },
  ltv: { base: 0.7, firstTime: 0.8, firstTimeCapital: 0.7 },
  dti: 0.6,
  /** 수도권 아파트 방공제 의무 예외: 연소득 4천만 이하 + 주택 3억 이하 */
  roomDeductionExemption: { incomeMax: 40_000_000, priceMax: 300_000_000 },
  maxTermYears: 30,
} as const;

export const NEWBORN = {
  priceMax: 900_000_000,
  areaMax: 85,
  incomeMax: { single: 130_000_000, dual: 200_000_000 },
  netAssetsMax: 511_000_000,
  limit: 400_000_000,
  ltv: { base: 0.7, firstTime: 0.8, firstTimeCapital: 0.7 },
  dti: 0.6,
  /** 6억 이하는 방공제 면제, 6억 초과 주택은 방공제 의무 */
  roomDeductionMandatoryAbove: 600_000_000,
  maxTermYears: 30,
} as const;

/** 최우선변제금(방공제 1실 금액). 아파트는 실무상 1실만 공제 */
export const ROOM_DEDUCTION: Record<RoomDeductionBucket, number> = {
  seoul: 55_000_000,
  overcrowded: 48_000_000,
  metro: 28_000_000,
  other: 25_000_000,
};

export const ROOM_DEDUCTION_LABEL: Record<RoomDeductionBucket, string> = {
  seoul: "서울 5,500만",
  overcrowded: "과밀억제권역·용인·화성·김포 4,800만",
  metro: "광역시·안산·광주·파주·이천·평택 2,800만",
  other: "그 밖의 지역 2,500만",
};

export const ACQUISITION_TAX = {
  lowRate: 0.01,
  highRate: 0.03,
  lowMax: 600_000_000,
  highMin: 900_000_000,
  educationRatio: 0.1,
  ruralRate: 0.002,
  ruralAreaMin: 85,
  firstTimeRelief: { cap: 2_000_000, priceMax: 1_200_000_000, until: "2028-12-31" },
  newbornRelief: { cap: 5_000_000, priceMax: 1_200_000_000, until: "2028-12-31" },
} as const;

/** 매매 중개보수 상한요율(매수인 1인). VAT 10% 별도 */
export const BROKERAGE_TIERS: { priceBelow: number; rate: number; cap: number | null }[] = [
  { priceBelow: 50_000_000, rate: 0.006, cap: 250_000 },
  { priceBelow: 200_000_000, rate: 0.005, cap: 800_000 },
  { priceBelow: 900_000_000, rate: 0.004, cap: null },
  { priceBelow: 1_200_000_000, rate: 0.005, cap: null },
  { priceBelow: 1_500_000_000, rate: 0.006, cap: null },
  { priceBelow: Number.POSITIVE_INFINITY, rate: 0.007, cap: null },
];

export const VAT = 0.1;

/** 국민주택채권 매입률(시가표준액 구간별) [특별시·광역시, 그 밖] */
export const HOUSING_BOND_RATES: { below: number; metro: number; other: number }[] = [
  { below: 20_000_000, metro: 0, other: 0 },
  { below: 50_000_000, metro: 0.013, other: 0.013 },
  { below: 100_000_000, metro: 0.019, other: 0.014 },
  { below: 160_000_000, metro: 0.021, other: 0.016 },
  { below: 260_000_000, metro: 0.023, other: 0.018 },
  { below: 600_000_000, metro: 0.026, other: 0.021 },
  { below: Number.POSITIVE_INFINITY, metro: 0.031, other: 0.026 },
];

export const BOND_DISCOUNT_RATE = 0.15;
/** 공시가격 ÷ 시세 근사치(시가표준액을 모를 때) */
export const OFFICIAL_PRICE_RATIO = 0.69;
export const MORTGAGE_BOND = { maxClaimRatio: 1.2, purchaseRate: 0.01 };
