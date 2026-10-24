// 현행 공시 금리 묶음에서 가구 소득·만기에 맞는 상품별 금리를 고른다(서버 계산과 조건 화면이 함께 씀)

import type { Household, LoanInfoSnapshot, LoanOptions, LoanProductId, RateTable } from "@/lib/types";

export interface SuggestedRate {
  rate: number;
  basis: string;
  url: string;
}

/** 이보다 오래된 묶음은 앱을 열 때 다시 가져온다 */
export const LOAN_INFO_STALE_MS = 12 * 60 * 60 * 1000;

function termIndex(terms: number[], years: number): number {
  let idx = 0;
  terms.forEach((t, i) => {
    if (t <= years) idx = i;
  });
  return idx;
}

function rowFor(table: RateTable, income: number) {
  return table.rows.find((r) => r.incomeMax === null || income <= r.incomeMax) ?? null;
}

const fmtTerm = (terms: number[], i: number) => `${terms[i]}년`;

export function suggestRates(s: LoanInfoSnapshot | null, h: Household, termYears: number): Partial<Record<LoanProductId, SuggestedRate>> {
  const out: Partial<Record<LoanProductId, SuggestedRate>> = {};
  if (!s) return out;
  if (s.bank) {
    out.bank = {
      rate: s.bank.median,
      basis: `은행연합회 ${s.bank.asOf} 취급 분할상환 주담대 평균금리 중앙값(${s.bank.banks.length}개 은행)`,
      url: s.bank.url,
    };
  }
  if (s.bogeumjari) {
    const i = termIndex(s.bogeumjari.terms, termYears);
    const rate = s.bogeumjari.aggime[i];
    if (rate !== null && rate !== undefined) {
      out.bogeumjari = { rate, basis: `주택금융공사 ${s.bogeumjari.asOf} 아낌e보금자리론 ${fmtTerm(s.bogeumjari.terms, i)}(우대금리 전)`, url: s.bogeumjari.url };
    }
  }
  if (s.didimdol) {
    const special = h.firstTimeBuyer && h.newlywed && s.didimdol.firstTimeNewlywed;
    const table = special ? s.didimdol.firstTimeNewlywed! : s.didimdol.general;
    const row = rowFor(table, h.annualIncome);
    const i = termIndex(table.terms, termYears);
    const rate = row?.rates[i];
    if (row && rate !== null && rate !== undefined) {
      out.didimdol = {
        rate,
        basis: `주택금융공사 ${s.didimdol.asOf} 디딤돌 ${special ? "생애최초 신혼가구 " : ""}${row.label} ${fmtTerm(table.terms, i)}(우대금리 전)`,
        url: s.didimdol.url,
      };
    }
  }
  if (s.newborn) {
    const row = rowFor(s.newborn.table, h.annualIncome);
    const i = termIndex(s.newborn.table.terms, termYears);
    const rate = row?.rates[i];
    if (row && rate !== null && rate !== undefined) {
      out.newborn = { rate, basis: `주택도시기금 신생아 특례 ${row.label} ${fmtTerm(s.newborn.table.terms, i)}(${s.fetchedAt.slice(0, 10)} 수집)`, url: s.newborn.url };
    }
  }
  return out;
}

/** autoRates가 켜져 있으면 공시 금리로 바꾼 대출 조건을 돌려준다(공시가 없는 상품은 입력값 유지) */
export function withLiveRates(loan: LoanOptions, s: LoanInfoSnapshot | null, h: Household): LoanOptions {
  if (!loan.autoRates || !s) return loan;
  const live = suggestRates(s, h, loan.termYears);
  const rates = { ...loan.rates };
  for (const [id, v] of Object.entries(live) as [LoanProductId, SuggestedRate][]) rates[id] = v.rate;
  return { ...loan, rates };
}
