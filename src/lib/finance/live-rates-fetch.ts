// 주택금융공사·주택도시기금·은행연합회 공시에서 현행 대출 금리를 가져오고, 안내문의 핵심 규정 문구가 그대로인지 확인해 저장

import type { LoanInfoSnapshot, RateTable } from "@/lib/types";
import { getSetting, setSetting } from "@/lib/settings";

const STORE_KEY = "live.loanInfo";
const TIMEOUT_MS = 15_000;
const HEADERS = { "user-agent": "Mozilla/5.0 (silipju local app; daily rate check)" };

export const LOAN_INFO_URLS = {
  bogeumjari: "https://www.hf.go.kr/ko/sub01/sub01_01_04.do",
  didimdol: "https://www.hf.go.kr/ko/sub01/sub01_02_03.do",
  newbornPage: "https://nhuf.molit.go.kr/FP/FP05/FP0503/FP05030801.jsp",
  newbornData: "https://nhuf.molit.go.kr/init/include/NewBabyGetInform.jsp",
  kfbPage: "https://portal.kfb.or.kr/compare/loan_household_new.php",
  kfbData: "https://portal.kfb.or.kr/compare/loan_household_new_search_result_new.php",
};

const RULE_CHECKS: { label: string; url: string; snippets: string[] }[] = [
  {
    label: "보금자리론 상품 안내",
    url: "https://www.hf.go.kr/ko/sub01/sub01_01_01.do",
    snippets: ["6억원 이하", "부부합산 연소득 7천만원 이하", "부부 중 1인(채무자)의 연소득이 7천만원 이하", "3.6억원", "4.2억원", "LTV 최대 70%", "DTI 최대 60%"],
  },
  {
    label: "디딤돌대출 안내",
    url: "https://nhuf.molit.go.kr/FP/FP05/FP0503/FP05030101.jsp",
    snippets: ["2.4억원", "3.2억원", "수도권·규제지역 소재 주택 구입시 LTV 70%", "5.11억원"],
  },
  {
    label: "신생아 특례 디딤돌 안내",
    url: "https://nhuf.molit.go.kr/FP/FP05/FP0503/FP05030801.jsp",
    snippets: ["1.3억원", "2억원", "4억원"],
  },
];

async function fetchBytes(url: string, init: RequestInit = {}): Promise<ArrayBuffer> {
  const res = await fetch(url, { ...init, headers: { ...HEADERS, ...init.headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.arrayBuffer();
}

const fetchUtf8 = async (url: string, init?: RequestInit) => new TextDecoder("utf-8").decode(await fetchBytes(url, init));
const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&middot;/g, "·").replace(/\s+/g, " ").trim();
const num = (s: string | undefined) => {
  const v = s === undefined ? NaN : parseFloat(s);
  return Number.isFinite(v) ? v : null;
};

// "20백만원 초과~40백만원이하", "(맞벌이) 1.3억원 초과 ~ 1.5억원 이하"처럼 구간 끝 금액을 원 단위로 읽는다
export function incomeUpperBound(label: string): number | null {
  const unit: Record<string, number> = { 억: 100_000_000, 천만: 10_000_000, 백만: 1_000_000 };
  const all = [...label.matchAll(/(\d+(?:\.\d+)?)\s*(억|천만|백만)원/g)];
  const last = all.at(-1);
  if (!last || !/이하/.test(label.slice(label.lastIndexOf(last[0])))) return null;
  return Math.round(parseFloat(last[1]) * unit[last[2]]);
}

function tablesWithCaption(html: string, captionPart: string): string[] {
  return [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map((m) => m[0]).filter((t) => (t.match(/<caption>([\s\S]*?)<\/caption>/)?.[1] ?? "").includes(captionPart));
}

function bodyRows(table: string): { label: string; values: (number | null)[] }[] {
  const body = table.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? "";
  return [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((r) => {
    const cells = [...r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => plain(c[1]));
    return { label: cells[0] ?? "", values: cells.slice(1).map(num) };
  });
}

function asOfMonth(html: string): string {
  const ym = html.match(/class="b-dt"\s+value="(\d{4}-\d{2})"/)?.[1];
  const posted = plain(html).match(/공시일\s*:\s*(\d{4})년\s*(\d{2})월\s*(\d{2})일/);
  if (posted) return `${posted[1]}-${posted[2]}-${posted[3]} 공시`;
  return ym ? `${ym} 공시` : "공시일 미확인";
}

export function parseBogeumjari(html: string): NonNullable<LoanInfoSnapshot["bogeumjari"]> {
  const [table] = tablesWithCaption(html, "40년, 50년");
  if (!table) throw new Error("보금자리론 금리표를 찾지 못했습니다");
  const rows = bodyRows(table);
  const pick = (name: string) => rows.find((r) => r.label.replace(/\s/g, "").startsWith(name))?.values ?? [];
  const aggime = pick("아낌e");
  const u = pick("u-보금자리론");
  if (aggime.length !== 6 || aggime.some((v) => v === null)) throw new Error("아낌e보금자리론 금리를 읽지 못했습니다");
  return { asOf: asOfMonth(html), url: LOAN_INFO_URLS.bogeumjari, terms: [10, 15, 20, 30, 40, 50], aggime, u };
}

export function parseDidimdol(html: string): NonNullable<LoanInfoSnapshot["didimdol"]> {
  const tables = tablesWithCaption(html, "소득수준(부부합산)");
  const toTable = (t: string): RateTable => ({
    terms: [10, 15, 20, 30],
    rows: bodyRows(t).map((r) => ({ label: r.label, incomeMax: incomeUpperBound(r.label), rates: r.values.slice(0, 4) })),
  });
  if (tables.length === 0) throw new Error("디딤돌 금리표를 찾지 못했습니다");
  const general = toTable(tables[0]);
  if (general.rows.length < 3 || general.rows.some((r) => r.incomeMax === null)) throw new Error("디딤돌 소득 구간을 읽지 못했습니다");
  return { asOf: asOfMonth(html), url: LOAN_INFO_URLS.didimdol, general, firstTimeNewlywed: tables[1] ? toTable(tables[1]) : null };
}

// 기금 응답은 키에 따옴표가 없는 JS 객체라 안쪽 {"LOANRATE": ...} 부분만 잘라 JSON으로 읽는다. 값은 행 우선(행=소득 구간, 열=10·15·20·30년)
export function parseNewborn(raw: string, pageHtml: string): NonNullable<LoanInfoSnapshot["newborn"]> {
  const obj = raw.match(/\{\s*"LOANRATE"[\s\S]*?\}/)?.[0];
  if (!obj) throw new Error("신생아 특례 금리 응답 형식이 바뀌었습니다");
  const data = JSON.parse(obj) as Record<string, string>;
  const values = Object.keys(data)
    .map((k) => ({ i: k === "LOANRATE" ? 0 : Number(k.replace("LOANRATE", "")), v: num(data[k]) }))
    .sort((a, b) => a.i - b.i)
    .map((x) => x.v);
  const labels = [...pageHtml.matchAll(/<th[^>]*scope="row"[^>]*>([\s\S]*?)<\/th>/g)].map((m) => plain(m[1]).replace(/^~\s*/, ""));
  if (labels.length === 0 || labels.length * 4 > values.length) throw new Error("신생아 특례 소득 구간을 읽지 못했습니다");
  const rows = labels.map((label, r) => ({ label, incomeMax: incomeUpperBound(label), rates: values.slice(r * 4, r * 4 + 4) }));
  return { asOf: "기준월 미표시(수집일 기준)", url: LOAN_INFO_URLS.newbornPage, table: { terms: [10, 15, 20, 30], rows } };
}

export function parseKfb(html: string): NonNullable<LoanInfoSnapshot["bank"]> {
  const handled = plain(html).match(/본 자료는\s*(\d{4})년\s*(\d{1,2})월중/);
  const banks: { name: string; rate: number }[] = [];
  for (const chunk of html.split(/<tr>/).slice(1)) {
    const name = chunk.match(/^\s*<td[^>]*>([^<&]+)/)?.[1]?.trim();
    if (!name) continue;
    const cells = [...chunk.matchAll(/<td(?:\s[^>]*)?>([\s\S]*?)<\/td>/g)].map((m) => plain(m[1]));
    const avg = num(cells[11]);
    if (cells[1] === "대출금리" && avg !== null) banks.push({ name, rate: avg });
  }
  if (banks.length < 3) throw new Error("은행별 평균금리를 읽지 못했습니다");
  const sorted = banks.map((b) => b.rate).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 100) / 100;
  return { asOf: handled ? `${handled[1]}-${handled[2].padStart(2, "0")}` : "취급월 미확인", url: LOAN_INFO_URLS.kfbPage, median, banks };
}

async function fetchBank(now: Date): Promise<NonNullable<LoanInfoSnapshot["bank"]>> {
  const page = Buffer.from(await fetchBytes(LOAN_INFO_URLS.kfbPage)).toString("latin1");
  const bankValues = [...page.matchAll(/name="BankName"[^>]*value="([^"]+)"/g)].map((m) => m[1]);
  if (bankValues.length === 0) throw new Error("은행 목록을 읽지 못했습니다");
  for (let back = 0; back < 3; back++) {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const body = `year=${d.getFullYear()}&month=${String(d.getMonth() + 1).padStart(2, "0")}&opt_1=1&detail=0&select_new_balance=1&str=${bankValues.join("%7C")}`;
    const html = new TextDecoder("euc-kr").decode(
      await fetchBytes(LOAN_INFO_URLS.kfbData, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", referer: LOAN_INFO_URLS.kfbPage },
        body,
      }),
    );
    if (html.includes("서비스전")) continue;
    return parseKfb(html);
  }
  throw new Error("최근 3개월 공시를 찾지 못했습니다");
}

async function checkRules(): Promise<LoanInfoSnapshot["ruleChecks"]> {
  return Promise.all(
    RULE_CHECKS.map(async (c) => {
      try {
        const text = plain(await fetchUtf8(c.url));
        const missing = c.snippets.filter((s) => !text.includes(s));
        return { label: c.label, url: c.url, ok: missing.length === 0, missing };
      } catch (e) {
        return { label: c.label, url: c.url, ok: false, missing: [`페이지를 열지 못했습니다(${e instanceof Error ? e.message : String(e)})`] };
      }
    }),
  );
}

export function loadLoanInfo(): LoanInfoSnapshot | null {
  const raw = getSetting(STORE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LoanInfoSnapshot;
  } catch (e) {
    console.warn("저장된 현행 대출정보를 읽지 못했습니다.", e);
    return null;
  }
}

let running: Promise<LoanInfoSnapshot> | null = null;

/** 모든 출처를 다시 가져와 저장한다. 실패한 출처는 직전 값을 유지하고 경고에 남긴다. 동시에 여러 번 불러도 한 번만 실행 */
export function refreshLoanInfo(now = new Date()): Promise<LoanInfoSnapshot> {
  running ??= (async () => {
    const prev = loadLoanInfo();
    const warnings: string[] = [];
    const attempt = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
      try {
        return await fn();
      } catch (e) {
        warnings.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
    };
    const [bogeumjari, didimdol, newborn, bank, ruleChecks] = await Promise.all([
      attempt("보금자리론 금리", async () => parseBogeumjari(await fetchUtf8(LOAN_INFO_URLS.bogeumjari))),
      attempt("디딤돌 금리", async () => parseDidimdol(await fetchUtf8(LOAN_INFO_URLS.didimdol))),
      attempt("신생아 특례 금리", async () => {
        const [raw, page] = await Promise.all([
          fetchUtf8(LOAN_INFO_URLS.newbornData, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded", referer: LOAN_INFO_URLS.newbornPage },
            body: "newBabyGetBuySelect=newMearryHouse&productgb=S",
          }),
          fetchUtf8(LOAN_INFO_URLS.newbornPage),
        ]);
        return parseNewborn(raw, page);
      }),
      attempt("은행 주담대 평균금리", () => fetchBank(now)),
      checkRules(),
    ]);
    for (const c of ruleChecks) if (!c.ok) warnings.push(`${c.label}: 확인할 규정 문구가 바뀌었습니다(${c.missing.join(", ")})`);
    const snapshot: LoanInfoSnapshot = {
      fetchedAt: now.toISOString(),
      bogeumjari: bogeumjari ?? prev?.bogeumjari ?? null,
      didimdol: didimdol ?? prev?.didimdol ?? null,
      newborn: newborn ?? prev?.newborn ?? null,
      bank: bank ?? prev?.bank ?? null,
      ruleChecks,
      warnings,
    };
    setSetting(STORE_KEY, JSON.stringify(snapshot));
    return snapshot;
  })().finally(() => {
    running = null;
  });
  return running;
}
