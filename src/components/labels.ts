// UI에서 쓰는 코드값→한국어 라벨, 상태별 색 클래스 매핑
import type {
  CommuteLegMode,
  FloorBand,
  LimitingFactor,
  LoanProductId,
  MovingInType,
  RankWeights,
  RateType,
  SeangoMode,
  SeangoStatus,
  SeangoStrictness,
  SortKey,
} from "@/lib/types";

export const SEANGO_STATUS: Record<SeangoStatus, { label: string; badge: string; text: string; dot: string }> = {
  seango: { label: "세안고", badge: "bg-seango-soft text-seango", text: "text-seango", dot: "bg-seango" },
  suspect: { label: "세안고 의심", badge: "bg-suspect-soft text-suspect", text: "text-suspect", dot: "bg-suspect" },
  movein: { label: "실입주 가능", badge: "bg-movein-soft text-movein", text: "text-movein", dot: "bg-movein" },
  unknown: { label: "근거 부족", badge: "bg-unknown-soft text-unknown", text: "text-unknown", dot: "bg-unknown" },
};

export const LIMITING_FACTOR: Record<LimitingFactor, string> = {
  ltv: "LTV",
  cap: "정부 상한",
  dsr: "DSR",
  dti: "DTI",
  "product-limit": "상품 한도",
  "bank-cap": "은행 한도",
  ineligible: "불가",
};

export const MOVING_IN: Record<MovingInType, string> = {
  MV001: "즉시입주",
  MV002: "이내입주",
  MV003: "이후입주",
  MV004: "지정날짜",
};

export const LEG_MODE: Record<CommuteLegMode, string> = {
  WALK: "도보",
  SUBWAY: "지하철",
  BUS: "버스",
  TRAIN: "기차",
  CAR: "자동차",
  TRANSFER: "환승",
};

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "score", label: "종합점수" },
  { value: "cash", label: "필요현금" },
  { value: "commute", label: "통근시간" },
  { value: "price", label: "가격" },
  { value: "pricePerArea", label: "평단가" },
];

export const WEIGHT_LABELS: { key: keyof RankWeights; label: string }[] = [
  { key: "commute", label: "통근" },
  { key: "cash", label: "현금 여력" },
  { key: "price", label: "가격" },
  { key: "area", label: "면적" },
  { key: "newness", label: "연식" },
  { key: "complexSize", label: "단지 규모" },
  { key: "station", label: "역세권" },
  { key: "redevelopment", label: "재개발 호재" },
  { key: "school", label: "학군" },
];

export const lineLabel = (line: string) => (line === "용인경전철" ? "에버라인" : line);

export const FLOOR_BAND_LABELS: { value: FloorBand; label: string }[] = [
  { value: "low", label: "저층" },
  { value: "mid", label: "중층" },
  { value: "high", label: "고층" },
];

export const SEANGO_MODES: { value: SeangoMode; label: string }[] = [
  { value: "exclude", label: "세안고 제외" },
  { value: "show", label: "표시만" },
  { value: "only", label: "세안고만" },
];

export const STRICTNESS: { value: SeangoStrictness; label: string; help: string }[] = [
  { value: "strict", label: "엄격", help: "세안고·의심에 더해 세안고 확률 30% 이상인 매물도 세안고로 봅니다." },
  { value: "balanced", label: "보통", help: "세안고와 세안고 의심 매물을 세안고로 봅니다." },
  { value: "lenient", label: "관대", help: "근거가 확실한 세안고만 세안고로 봅니다." },
];

export const RATE_TYPES: { value: RateType; label: string }[] = [
  { value: "variable", label: "변동" },
  { value: "mixed5", label: "5년 혼합" },
  { value: "periodic5", label: "5년 주기" },
];

export const LOAN_SHORT: Record<LoanProductId, string> = {
  bank: "은행 주담대",
  bogeumjari: "보금자리론",
  didimdol: "디딤돌",
  newborn: "신생아 특례",
};

export const SOURCE_BADGE: Record<"demo" | "naver-import", string> = {
  demo: "샘플",
  "naver-import": "실매물",
};
