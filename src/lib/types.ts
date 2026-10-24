// 도메인 타입과 API 계약 정의(UI·API 라우트·도메인 로직이 공유)

/** 네이버 tradeType 코드. A1 매매, B1 전세, B2 월세, B3 단기임대 */
export type TradeType = "A1" | "B1" | "B2" | "B3";

/** 네이버 ARTICLE_MOVING_IN_TYPE(REA로 번들에서 확인). 즉시입주/이내입주/이후입주/지정날짜 */
export type MovingInType = "MV001" | "MV002" | "MV003" | "MV004";

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** 방공제(최우선변제금) 지역 구간 */
export type RoomDeductionBucket = "seoul" | "overcrowded" | "metro" | "other";

export interface RegionInfo {
  sido: string;
  sigungu: string;
  /** 실거래가 API용 시군구 코드 5자리 */
  lawdCd: string | null;
  isCapitalArea: boolean;
  /** 투기과열지구·조정대상지역(현재는 두 지정이 겹침) */
  isRegulated: boolean;
  roomDeductionBucket: RoomDeductionBucket;
  /** 국민주택채권 매입률 구간(특별시·광역시 여부) */
  isMetropolitanCity: boolean;
}

export type DataSource = "demo" | "naver-import";

export interface Complex {
  id: string;
  name: string;
  source: DataSource;
  location: GeoPoint;
  address: string;
  region: RegionInfo;
  households: number | null;
  approvalYear: number | null;
  /** 용적률(%). 네이버 지도 단지 마커에서 수집, 모르면 null */
  floorAreaRatio: number | null;
}

export interface MovingInInfo {
  type: MovingInType | null;
  /** YYYY-MM-DD 또는 YYYY-MM */
  date: string | null;
  negotiable: boolean;
}

/** 중개사 1곳이 올린 매물 광고 1건(네이버 articleInfo 1개에 해당) */
export interface RealtorAd {
  articleNo: string;
  realtorName: string;
  cpName: string | null;
  /** articleFeatureDescription(목록에 노출되는 한 줄 특징) */
  featureText: string;
  /** articleDescription(상세 본문). 목록 API에는 없음 */
  description: string | null;
  movingIn: MovingInInfo | null;
  /** 기보증금(원). 상세 API priceInfo.previousDeposit */
  previousDeposit: number | null;
  previousMonthlyRent: number | null;
  /** 상세 API priceInfo.isLeaseHold */
  isLeaseHold: boolean | null;
  verificationType: string | null;
  confirmedAt: string | null;
}

/**
 * 같은 물건으로 묶인 매물 그룹. 네이버 duplicatedArticleInfo 그룹 하나 = 실제 호실 하나로 본다.
 * 세안고 단서는 그룹 안의 여러 중개사 광고에 흩어져 있으므로 판별은 이 단위로 한다.
 */
export interface ListingUnit {
  id: string;
  complexId: string;
  dong: string | null;
  floorLabel: string;
  floor: number | null;
  totalFloors: number | null;
  exclusiveArea: number;
  supplyArea: number | null;
  areaName: string | null;
  roomCount: number;
  direction: string | null;
  /** 매매가(원) */
  price: number;
  ads: RealtorAd[];
  photoUrl: string | null;
}

// ---------------------------------------------------------------------------
// 세안고 판별

export type SeangoStatus = "seango" | "suspect" | "movein" | "unknown";

export type SeangoEvidenceKind =
  | "structured-leasehold"
  | "structured-deposit"
  | "structured-movein-later"
  | "structured-movein-now"
  | "text-explicit"
  | "text-tenant-detail"
  | "text-future-movein"
  | "text-movein-now"
  | "text-movein-negotiable"
  | "text-negated"
  | "conflict"
  | "price-anomaly"
  | "rent-record"
  | "merged-groups";

export interface SeangoEvidence {
  kind: SeangoEvidenceKind;
  /** 로그오즈 가중치. 양수는 세안고 쪽, 음수는 실입주 쪽 */
  weight: number;
  label: string;
  /** 근거가 나온 중개사/필드 */
  source: string;
  snippet: string | null;
  matched: string | null;
}

export interface SeangoResult {
  status: SeangoStatus;
  /** 세안고일 확률 추정치 0~1 */
  probability: number;
  totalAds: number;
  explicitAds: number;
  moveInAds: number;
  /** 텍스트/필드에서 읽은 승계 보증금(원) */
  depositEstimate: number | null;
  /** 텍스트/필드에서 읽은 입주 가능 시기 YYYY-MM */
  moveInFrom: string | null;
  evidence: SeangoEvidence[];
  summary: string;
}

// ---------------------------------------------------------------------------
// 검색 조건

export interface Workplace {
  id: string;
  label: string;
  location: GeoPoint;
  /** 통근 가중치(주 출근일 등). 기본 1 */
  weight: number;
}

export type LoanProductId = "bank" | "bogeumjari" | "didimdol" | "newborn";

export type RateType = "variable" | "mixed5" | "periodic5";

export interface Household {
  /** 무주택 세대 여부 */
  homeless: boolean;
  firstTimeBuyer: boolean;
  /** 혼인 7년 이내 */
  newlywed: boolean;
  /** 미성년 자녀 수 */
  childrenCount: number;
  /** 2년 내 출산(신생아 특례, 출산가구 취득세 감면) */
  newbornWithin2y: boolean;
  dualIncome: boolean;
  /** 부부합산 연소득(원) */
  annualIncome: number;
  /** 부부 중 대출 신청인 한 명의 연소득(원). 신혼 보금자리론 1인 소득 기준(2026-10-19~)용, 모르면 null */
  singleIncome: number | null;
  /** 기존 대출 연간 원리금 상환액(원) */
  existingAnnualDebtPayment: number;
  /** 동원 가능한 현금(원) */
  cash: number;
  /** 순자산(원). 정책대출 자산요건 확인용, 모르면 null */
  netAssets: number | null;
}

export interface LoanOptions {
  products: LoanProductId[];
  /** 상품별 적용 금리(연 %) */
  rates: Record<LoanProductId, number>;
  bankRateType: RateType;
  termYears: number;
  /** MCI/MCG로 방공제를 면제받을 수 있다고 가정할지 */
  useMciMcg: boolean;
  /** 은행 자체 구입자금 상한(원). 예: 일부 은행 3억. 없으면 null */
  bankSelfCap: number | null;
  /** 공식 공시에서 가져온 현행 금리를 소득·만기에 맞춰 자동 적용할지(끄면 rates를 그대로 쓴다) */
  autoRates: boolean;
}

/** 소득 구간(행) × 만기(열) 금리표. incomeMax가 null이면 상한 없는 마지막 구간 */
export interface RateTable {
  terms: number[];
  rows: { label: string; incomeMax: number | null; rates: (number | null)[] }[];
}

/** 공식 공시에서 모은 현행 대출정보. 가져오지 못한 출처는 직전 값을 유지한다 */
export interface LoanInfoSnapshot {
  fetchedAt: string;
  bogeumjari: { asOf: string; url: string; terms: number[]; aggime: (number | null)[]; u: (number | null)[] } | null;
  didimdol: { asOf: string; url: string; general: RateTable; firstTimeNewlywed: RateTable | null } | null;
  newborn: { asOf: string; url: string; table: RateTable } | null;
  bank: { asOf: string; url: string; median: number; banks: { name: string; rate: number }[] } | null;
  ruleChecks: { label: string; url: string; ok: boolean; missing: string[] }[];
  warnings: string[];
}

export type SeangoMode = "exclude" | "show" | "only";
export type SeangoStrictness = "strict" | "balanced" | "lenient";

export interface SeangoFilter {
  mode: SeangoMode;
  strictness: SeangoStrictness;
  /** 입주 가능 시기가 이 개월 수 이내면 실입주 가능으로 본다 */
  acceptMoveInWithinMonths: number;
}

export interface RankWeights {
  commute: number;
  cash: number;
  price: number;
  area: number;
  newness: number;
  complexSize: number;
  station: number;
  redevelopment: number;
  school: number;
}

export type FloorBand = "low" | "mid" | "high";

export interface FloorFilter {
  /** 비어 있으면 모든 층 */
  bands: FloorBand[];
  excludeFirst: boolean;
  excludeTop: boolean;
}

export type SortKey = "score" | "cash" | "commute" | "price" | "pricePerArea";
export type CommuteMode = "transit" | "car";

export interface SearchConditions {
  priceMin: number | null;
  priceMax: number | null;
  areaMin: number | null;
  areaMax: number | null;
  roomsMin: number | null;
  floors: FloorFilter;
  minHouseholds: number | null;
  maxBuildingAge: number | null;
  /** 시군구 이름 필터(비어 있으면 전체) */
  regions: string[];
  workplaces: Workplace[];
  commuteMode: CommuteMode;
  maxCommuteMinutes: number | null;
  household: Household;
  loan: LoanOptions;
  seango: SeangoFilter;
  weights: RankWeights;
  /** 역세권 점수에서 빼는 노선. 이 노선만 지나는 역은 없는 셈 치고, 환승역은 남은 노선으로만 본다 */
  excludedLines: string[];
  sortBy: SortKey;
  onlyAffordable: boolean;
  limit: number;
  /** 샘플 데이터 포함 여부. 실데이터가 있으면 기본 false */
  includeDemo: boolean;
}

// ---------------------------------------------------------------------------
// 대출·필요현금

export type LimitingFactor = "ltv" | "cap" | "dsr" | "dti" | "product-limit" | "bank-cap" | "ineligible";

export interface LoanQuote {
  product: LoanProductId;
  productName: string;
  eligible: boolean;
  reasons: string[];
  maxLoan: number;
  limitingFactor: LimitingFactor;
  ltvRate: number;
  /** 시세 × LTV */
  ltvAmount: number;
  /** 방공제로 차감한 금액 */
  roomDeduction: number;
  /** 정부 상한(6/4/2억) 또는 상품 한도 */
  capAmount: number | null;
  /** DSR/DTI로 계산한 최대 원금 */
  incomeLimitAmount: number | null;
  rate: number;
  /** 한도 산정에 쓴 스트레스 금리(%p) */
  stressRate: number;
  termYears: number;
  monthlyPayment: number;
  notes: string[];
}

export interface CostBreakdown {
  acquisitionTax: number;
  taxRelief: number;
  localEducationTax: number;
  ruralSpecialTax: number;
  brokerageFee: number;
  legalFee: number;
  bondCost: number;
  stampDuty: number;
  total: number;
}

export interface FinanceResult {
  price: number;
  costs: CostBreakdown;
  best: LoanQuote | null;
  quotes: LoanQuote[];
  /** 매매가 + 부대비용 − 최적 대출 */
  requiredCash: number;
  /** 보유현금 − 필요현금 */
  cashGap: number;
  affordable: boolean;
  /** 세안고로 살 때(보증금 승계, 대출 없음) 필요현금. 보증금을 모르면 null */
  seangoCash: number | null;
}

// ---------------------------------------------------------------------------
// 통근

export type CommuteLegMode = "WALK" | "SUBWAY" | "BUS" | "TRAIN" | "CAR" | "TRANSFER";

export interface CommuteLeg {
  mode: CommuteLegMode;
  label: string;
  minutes: number;
  from: string | null;
  to: string | null;
  color: string | null;
}

export interface RouteLinks {
  kakaoWeb: string;
  kakaoApp: string;
  naverApp: string;
  tmapApp: string;
}

export interface CommuteRoute {
  workplaceId: string;
  workplaceLabel: string;
  mode: CommuteMode;
  minutes: number;
  transfers: number | null;
  walkMinutes: number | null;
  fare: number | null;
  distanceKm: number | null;
  legs: CommuteLeg[];
  summary: string;
  source: "estimate" | "tmap";
  links: RouteLinks;
}

// ---------------------------------------------------------------------------
// 랭킹·검색 응답

export interface ScorePart {
  key: keyof RankWeights | "certainty";
  label: string;
  /** 0~1 */
  score: number;
  weight: number;
  detail: string;
}

export interface ScoreBreakdown {
  /** 0~100 */
  total: number;
  parts: ScorePart[];
}

export interface PeerPrices {
  /** 같은 단지·비슷한 면적 매매 매물 수 */
  count: number;
  lowestAll: number | null;
  lowestMoveIn: number | null;
  medianMoveIn: number | null;
}

export interface SearchResultItem {
  unit: ListingUnit;
  complex: Complex;
  seango: SeangoResult;
  finance: FinanceResult;
  commutes: CommuteRoute[];
  commuteWeightedMinutes: number | null;
  commuteMaxMinutes: number | null;
  peers: PeerPrices;
  score: ScoreBreakdown;
  pricePerPyeong: number;
}

export interface SearchStats {
  totalUnits: number;
  matchedBasic: number;
  /** 최소 세대수 조건이 있을 때 세대수를 몰라서 뺀 매물 수 */
  householdsUnknownExcluded: number;
  seangoDetected: number;
  seangoExcluded: number;
  unaffordable: number;
  overCommute: number;
  returned: number;
  lowestPriceAll: number | null;
  lowestPriceMoveIn: number | null;
}

export interface SearchResponse {
  items: SearchResultItem[];
  stats: SearchStats;
  policyAsOf: string;
  /** demo: 이번 검색에 샘플 포함 여부, importedComplexes·realUnits: DB에 쌓인 실데이터 규모 */
  dataSources: { demo: boolean; importedComplexes: number; realUnits: number };
  commuteSource: "estimate";
  warnings: string[];
}

export interface CollectedComplex {
  id: string;
  name: string;
  sigungu: string;
  units: number;
  minPrice: number;
  maxPrice: number;
  lastSeenAt: string;
}

// ---------------------------------------------------------------------------
// 기타 API

export interface PlaceSuggestion {
  label: string;
  detail: string | null;
  location: GeoPoint;
  kind: "station" | "district" | "poi" | "address";
  source: "builtin" | "kakao" | "nominatim";
}

export interface RealTrade {
  date: string;
  exclusiveArea: number;
  floor: number | null;
  price: number;
}

export interface ComplexDetail {
  complex: Complex;
  units: ListingUnit[];
  trades: RealTrade[];
  tradesSource: "demo" | "molit" | "none";
}

export interface ProviderStatus {
  tmap: boolean;
  kakao: boolean;
  molit: boolean;
  finlife: boolean;
}

export type ApiKeyName = "tmap" | "kakao" | "molit" | "finlife" | "anthropic";

export interface ApiKeyStatus {
  set: boolean;
  source: "db" | "env" | null;
  masked: string | null;
}

export type ApiSettingsResponse = Record<ApiKeyName, ApiKeyStatus>;

export interface ApiKeyTestResult {
  ok: boolean;
  message: string;
}

export interface MolitSyncCounts {
  requests: number;
  fetched: number;
  inserted: number;
  errors: number;
}

export interface MolitSyncResult {
  ok: boolean;
  message: string;
  lawdCodes: number;
  months: number;
  trades: MolitSyncCounts | null;
  rents: MolitSyncCounts | null;
  classified: { units: number; seango: number; suspect: number } | null;
  warnings: string[];
}

export interface MetaResponse {
  policyAsOf: string;
  providers: ProviderStatus;
  regions: string[];
  stationLines: string[];
  loanProducts: { id: LoanProductId; name: string; description: string; defaultRate: number }[];
  sources: { label: string; url: string }[];
  defaults: SearchConditions;
  realData: { complexes: number; units: number };
  extensionPath: string;
  loanInfo: LoanInfoSnapshot | null;
}

export interface LlmSettings {
  model: string;
  defaultModel: string;
}

// ---------------------------------------------------------------------------
// 동네 브리핑

export type SchoolKind = "elementary" | "middle" | "high";

export interface NearbySchool {
  id: string;
  name: string;
  kind: SchoolKind;
  /** 단지 좌표에서 직선거리(m) */
  distanceM: number;
  walkMinutes: number;
  address: string | null;
  url: string | null;
}

export interface BriefLink {
  title: string;
  url: string;
}

export interface BriefQuote {
  text: string;
  source: string;
  url: string | null;
}

export type BriefConfidence = "확인됨" | "추정" | "모름";

export interface NeighborhoodBriefContent {
  summary: string;
  location: { transit: string; amenities: string; education: string; nature: string };
  reputation: { pros: string[]; cons: string[]; quotes: BriefQuote[] };
  schools: {
    assignedElementary: { name: string | null; confidence: BriefConfidence; basis: string; url: string | null };
    middleSchoolNote: string;
  };
  cautions: string[];
  sources: BriefLink[];
}

export interface NeighborhoodBrief {
  complexId: string;
  model: string;
  createdAt: string;
  /** 이번 생성에 쓴 웹 검색 횟수(응답에 없으면 null) */
  webSearches: number | null;
  content: NeighborhoodBriefContent;
}

export interface ComplexBriefResponse {
  brief: NeighborhoodBrief | null;
  schools: NearbySchool[];
  schoolsNote: string | null;
  links: BriefLink[];
  llmAvailable: boolean;
  generating: boolean;
}

export interface ImportResult {
  complexes: number;
  units: number;
  ads: number;
  enrichedAds: number;
  warnings: string[];
}
