// 중개사 매물 설명에서 세안고·실입주 단서를 찾는 정규식 규칙 모음
// 규칙은 REA로 수집한 실제 네이버페이 부동산 매물 설명(헬리오시티 매매 425건)에서 관찰한 표현을 기준으로 만들었다.

import { parseKoreanMoney } from "@/lib/format";

export interface TextSignals {
  /** "세안고", "전세끼고", "갭투자", "실입주 불가" 등 명시적 표현 */
  explicit: string[];
  /** 전세 만기·갱신권·세입자 거주 등 임차인 존재를 전제하는 표현 */
  tenantDetail: string[];
  /** "27.2월 입주"처럼 미래 시점 입주 표현. date는 YYYY-MM */
  futureMoveIn: { matched: string; date: string }[];
  /** 즉시입주·주인거주·공실 등 강한 실입주 표현 */
  moveInNow: string[];
  /** 입주협의·이사협의 등 약한 실입주 표현 */
  negotiable: string[];
  /** "세안고 아님", "세입자 없음" 같은 부정 표현 */
  negated: string[];
  /** 승계 보증금 추정(원) */
  deposit: number | null;
}

const EXPLICIT: RegExp[] = [
  /세\s?안\s?고/g,
  /전\s?세\s?(?:를\s?)?(?:안고|끼고|낀|승계)/g,
  /월\s?세\s?(?:를\s?)?(?:안고|끼고|낀|승계)/g,
  /(?:^|[^전월])세\s?(?:를\s?)?끼고/g,
  /갭\s?투자/g,
  /(?:실\s?)?입주\s?(?:불가|안\s?됨|어려움)/g,
  /보증금\s?승계/g,
  // "임대 중개"(중개업소 홍보 문구)는 제외
  /임대\s?(?:중(?!개)|차\s?승계)/g,
];

const TENANT_DETAIL: RegExp[] = [
  /(?:전세|월세|임대|임차)\s?(?:계약\s?)?(?:만기|만료|기간)/g,
  /계약\s?갱신\s?(?:청구|요구)/g,
  /갱신\s?(?:권|청구권|요구권)\s?(?:사용|미사용|행사|소진|有|무)/g,
  /(?:세입자|임차인)\s?(?:거주|있|계약|살|승계)/g,
  /투자\s?(?:용|매물|추천)/g,
  /높은\s?전세/g,
];

const MOVE_IN_NOW: RegExp[] = [
  /즉시\s?입주/g,
  /바로\s?입주/g,
  /즉입/g,
  /(?:집\s?)?주인\s?(?:실\s?)?거주/g,
  /소유자\s?거주/g,
  /공실/g,
  /비어\s?있/g,
  /빈\s?집/g,
];

const NEGOTIABLE: RegExp[] = [/입주\s?(?:일\s?|날짜\s?|시기\s?)?(?:협의|조율|가능)/g, /이사\s?(?:날짜\s?)?협의/g, /모두\s?협의/g];

const NEGATED: RegExp[] = [
  /세\s?안\s?고\s?(?:아님|아닙|아닌|x|X|불가|안\s?됨|안\s?돼)/g,
  /(?:세입자|임차인)\s?(?:없|퇴거|이사\s?나|만기\s?퇴거|내보)/g,
];

// "27.2월 입주", "2027.2월 입주", "27.02입", "27년2월입주", "27년 8월 입주협의", "2027년 3월말 이사"
const FUTURE_DATE =
  /(?<![\d.])(?:20)?(2[5-9]|3[0-2])\s?(?:[.\/\-]|년\s?)\s?(0?[1-9]|1[0-2])(?!\d)\s?월?\s?(?:초순?|중순?|하순|말|경|이후)?\s?(?:에\s?)?(?:입주|입(?![가-힣])|이사|퇴거|만기|만료)/g;

// 보증금 금액: "전세 9억 끼고", "보증금 5억5천 승계", "전세가 12억", "기보증금 3억"
const DEPOSIT =
  /(?:전세\s?(?:가|금)?|보증금|기보증금)\s?(?:은|는|이|가)?\s?(?:약\s?)?(\d+(?:\.\d+)?\s?억(?:\s?\d[\d,]*\s?(?:천만?|만)?)?|\d[\d,]*\s?만)/g;

function collect(text: string, patterns: RegExp[]): string[] {
  const out: string[] = [];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) out.push(m[0].trim());
  }
  return out;
}

export function normalizeText(text: string): string {
  return text
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\\r\\n|\\n|\r\n|\n|\r/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function extractSignals(rawText: string): TextSignals {
  const text = normalizeText(rawText);
  const negated = collect(text, NEGATED);
  // 부정 표현에 걸린 "세안고"는 명시 표현에서 제외한다
  const textForPositive = negated.reduce((acc, n) => acc.split(n).join(" "), text);

  const futureMoveIn: TextSignals["futureMoveIn"] = [];
  for (const m of text.matchAll(FUTURE_DATE)) {
    const year = 2000 + parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    futureMoveIn.push({ matched: m[0].trim(), date: `${year}-${String(month).padStart(2, "0")}` });
  }

  let deposit: number | null = null;
  for (const m of text.matchAll(DEPOSIT)) {
    const won = parseKoreanMoney(m[1]);
    // 1천만~50억 사이만 보증금으로 인정(매매가·관리비 오인 방지)
    if (won !== null && won >= 10_000_000 && won <= 5_000_000_000) {
      deposit = Math.max(deposit ?? 0, won);
    }
  }

  return {
    explicit: collect(textForPositive, EXPLICIT),
    tenantDetail: collect(textForPositive, TENANT_DETAIL),
    futureMoveIn,
    moveInNow: collect(text, MOVE_IN_NOW),
    negotiable: collect(text, NEGOTIABLE),
    negated,
    deposit,
  };
}

/** UI 하이라이트용: 텍스트에서 단서 구간을 찾아 [start,end,kind] 목록으로 돌려준다 */
export function highlightRanges(rawText: string): { start: number; end: number; kind: "seango" | "movein" }[] {
  const text = rawText;
  const ranges: { start: number; end: number; kind: "seango" | "movein" }[] = [];
  const push = (patterns: RegExp[], kind: "seango" | "movein") => {
    for (const re of patterns) {
      for (const m of text.matchAll(re)) {
        if (m.index !== undefined) ranges.push({ start: m.index, end: m.index + m[0].length, kind });
      }
    }
  };
  push([...EXPLICIT, ...TENANT_DETAIL, FUTURE_DATE], "seango");
  push([...MOVE_IN_NOW, ...NEGOTIABLE, ...NEGATED], "movein");
  return ranges.sort((a, b) => a.start - b.start);
}
