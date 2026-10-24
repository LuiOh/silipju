// 공시 금리 페이지 파서(보금자리론·디딤돌·신생아·은행연합회)와 가구별 적용 금리 선택 테스트(실제 페이지 구조를 줄인 고정 문자열)

import { describe, expect, it } from "vitest";
import type { Household, LoanInfoSnapshot, LoanOptions } from "@/lib/types";
import { incomeUpperBound, parseBogeumjari, parseDidimdol, parseKfb, parseNewborn } from "./live-rates-fetch";
import { suggestRates, withLiveRates } from "./live-rates";

const row = (label: string, rates: string[]) => `<tr> <td> ${label} </td> ${rates.map((r) => `<td> ${r} </td>`).join(" ")} </tr>`;

const BOGEUMJARI_HTML = `
<input type="hidden" class="b-dt" value="2026-10" />
<p>공시일 :
   2026년 10월 01일 </p>
<table class="tbl over"><caption>상품별/만기를 10년, 15년, 20년, 30년, 40년, 50년으로 구성된 고정금리 정보 테이블 입니다.</caption>
<thead><tr><th scope="col">상품별/만기</th><th scope="col">10년</th></tr></thead>
<tbody>
${row("u-보금자리론", ["5.00", "5.10", "5.15", "5.20", "5.25", "5.30"])}
${row("아낌e보금자리론", ["4.90", "5.00", "5.05", "5.10", "5.15", "5.20"])}
${row("t-보금자리론", ["5.00", "5.10", "5.15", "5.20", "5.25", "5.30"])}
</tbody></table>`;

const didimdolTable = (rows: [string, string[]][]) => `
<table class="tbl over"><caption>소득수준(부부합산)를 10년, 15년, 20년, 30년으로 구성된 고정금리 정보 테이블 입니다.</caption>
<tbody>${rows.map(([l, r]) => `<tr> <td> ${l} </td> ${r.map((v) => `<td>${v}</td>`).join(" ")} </tr>`).join("\n<!--25번값이 없으면 해당열 표기안함-->\n")}</tbody></table>`;

const DIDIMDOL_HTML = `<p>공시일 : 2026년 10월 01일</p>
${didimdolTable([
  ["20백만원 이하", ["2.85", "2.95", "3.05", "3.10"]],
  ["20백만원 초과~40백만원이하", ["3.20", "3.30", "3.40", "3.45"]],
  ["40백만원 초과~70백만원 이하", ["3.55", "3.65", "3.75", "3.85"]],
  ["70백만원 초과~85백만원 이하", ["3.90", "4.00", "4.10", "4.15"]],
])}
<p>생애최초로 주택을 구입하는 신혼가구인 경우</p>
${didimdolTable([
  ["20백만원 이하", ["2.55", "2.65", "2.75", "2.80"]],
  ["20백만원 초과~40백만원이하", ["2.90", "3.00", "3.10", "3.15"]],
  ["40백만원 초과~70백만원 이하", ["3.25", "3.35", "3.45", "3.50"]],
  ["70백만원 초과~85백만원 이하", ["3.60", "3.70", "3.80", "3.85"]],
])}`;

const NEWBORN_LABELS = [
  "&nbsp; ~ 2천만원 이하",
  "2천만원 초과 ~ 4천만원 이하",
  "4천만원 초과 ~ 6천만원 이하",
  "6천만원 초과 ~ 8.5천만원 이하",
  "8.5천만원 초과 ~ 1억원 이하",
  "1억원 초과 ~ 1.3억원 이하",
  "(맞벌이) 1.3억원 초과 ~ 1.5억원 이하",
  "(맞벌이) 1.5억원 초과 ~ 1.7억원 이하",
  "(맞벌이) 1.7억원 초과 ~ 2억원 이하",
];
const NEWBORN_PAGE = NEWBORN_LABELS.map((l, i) => `<tr><th scope="row">${l}</th><td id="LOANRATE${i * 4 || ""}"></td></tr>`).join("");
const NEWBORN_VALUES = [
  "1.8", "1.90", "2.00", "2.05", "2.15", "2.25", "2.35", "2.40", "2.40", "2.50", "2.60", "2.65",
  "2.65", "2.75", "2.85", "2.90", "2.90", "3.00", "3.10", "3.20", "3.20", "3.30", "3.40", "3.50",
  "3.50", "3.60", "3.70", "3.80", "3.85", "3.95", "4.05", "4.15", "4.20", "4.30", "4.40", "4.50",
];
const NEWBORN_RAW = `\n\n\n{arrJson : [{${NEWBORN_VALUES.map((v, i) => `"LOANRATE${i || ""}" : "${v}"`).join(",")}}]}`;

const kfbRow = (name: string, avg: string) =>
  `<tr><td>${name}&nbsp;<a href="#"><img alt="공시정보"></a></td><td colspan="2">대출금리</td>${["5.1", "5.2", "5.3", "5.4", "5.5", "5.6", "5.7", "5.8", "5.9"].map((v) => `<td>${v}</td>`).join("")}<td>${avg}</td><td class="tl2">950</td><td class="tl3">KCB</td></tr>`;
const KFB_HTML = `<p>* 본 자료는 <span class="fc000B">2026년 8월중</span> 취급된 대출을 기준으로 작성한 자료입니다.</p>
<table><tbody>${kfbRow("한국산업은행", "-")}${kfbRow("NH농협은행", "5.45")}${kfbRow("신한은행", "5.04")}${kfbRow("우리은행", "4.80")}${kfbRow("KB국민은행", "4.55")}</tbody></table>`;

describe("공시 페이지 파서", () => {
  it("구간 끝 금액을 원 단위로 읽는다", () => {
    expect(incomeUpperBound("20백만원 초과~40백만원이하")).toBe(40_000_000);
    expect(incomeUpperBound("~ 2천만원 이하")).toBe(20_000_000);
    expect(incomeUpperBound("8.5천만원 초과 ~ 1억원 이하")).toBe(100_000_000);
    expect(incomeUpperBound("(맞벌이) 1.7억원 초과 ~ 2억원 이하")).toBe(200_000_000);
    expect(incomeUpperBound("85백만원 초과")).toBeNull();
  });

  it("보금자리론: 아낌e·u 금리 6개 만기와 공시일", () => {
    const b = parseBogeumjari(BOGEUMJARI_HTML);
    expect(b.asOf).toBe("2026-10-01 공시");
    expect(b.aggime).toEqual([4.9, 5, 5.05, 5.1, 5.15, 5.2]);
    expect(b.u[3]).toBe(5.2);
  });

  it("디딤돌: 일반 표와 생애최초 신혼가구 표를 소득 구간별로 읽는다", () => {
    const d = parseDidimdol(DIDIMDOL_HTML);
    expect(d.general.rows.map((r) => r.incomeMax)).toEqual([20_000_000, 40_000_000, 70_000_000, 85_000_000]);
    expect(d.general.rows[3].rates).toEqual([3.9, 4, 4.1, 4.15]);
    expect(d.firstTimeNewlywed?.rows[0].rates[3]).toBe(2.8);
  });

  it("신생아 특례: 따옴표 없는 응답에서 9개 소득 구간 × 4개 만기 금리를 읽는다", () => {
    const n = parseNewborn(NEWBORN_RAW, NEWBORN_PAGE);
    expect(n.table.rows).toHaveLength(9);
    expect(n.table.rows[0]).toMatchObject({ label: "2천만원 이하", incomeMax: 20_000_000, rates: [1.8, 1.9, 2, 2.05] });
    expect(n.table.rows[8]).toMatchObject({ incomeMax: 200_000_000, rates: [4.2, 4.3, 4.4, 4.5] });
  });

  it("은행연합회: 값이 없는 은행은 빼고 평균금리 중앙값과 취급월", () => {
    const k = parseKfb(KFB_HTML);
    expect(k.asOf).toBe("2026-08");
    expect(k.banks.map((b) => b.name)).toEqual(["NH농협은행", "신한은행", "우리은행", "KB국민은행"]);
    expect(k.median).toBe(4.92);
  });
});

describe("가구·만기에 맞는 현행 금리", () => {
  const snapshot: LoanInfoSnapshot = {
    fetchedAt: "2026-10-24T04:48:38.817Z",
    bogeumjari: parseBogeumjari(BOGEUMJARI_HTML),
    didimdol: parseDidimdol(DIDIMDOL_HTML),
    newborn: parseNewborn(NEWBORN_RAW, NEWBORN_PAGE),
    bank: parseKfb(KFB_HTML),
    ruleChecks: [],
    warnings: [],
  };
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

  it("만기 30년·소득 8천만: 보금자리론 아낌e 30년, 디딤돌 7천만~8.5천만 구간, 신생아 6천만~8.5천만 구간", () => {
    const r = suggestRates(snapshot, household, 30);
    expect(r.bank?.rate).toBe(4.92);
    expect(r.bogeumjari?.rate).toBe(5.1);
    expect(r.didimdol?.rate).toBe(4.15);
    expect(r.newborn?.rate).toBe(2.9);
  });

  it("생애최초 신혼가구는 디딤돌 우대 표, 만기 25년은 20년 금리를 쓴다", () => {
    const r = suggestRates(snapshot, { ...household, newlywed: true }, 25);
    expect(r.didimdol?.rate).toBe(3.8);
    expect(r.bogeumjari?.rate).toBe(5.05);
  });

  it("자동 적용을 끄면 입력한 금리를 그대로 쓴다", () => {
    const loan: LoanOptions = {
      products: ["bank", "bogeumjari"],
      rates: { bank: 5.2, bogeumjari: 4.6, didimdol: 3.5, newborn: 3.0 },
      bankRateType: "periodic5",
      termYears: 30,
      useMciMcg: false,
      bankSelfCap: null,
      autoRates: false,
    };
    expect(withLiveRates(loan, snapshot, household).rates.bank).toBe(5.2);
    expect(withLiveRates({ ...loan, autoRates: true }, snapshot, household).rates).toMatchObject({ bank: 4.92, bogeumjari: 5.1, didimdol: 4.15 });
  });
});
