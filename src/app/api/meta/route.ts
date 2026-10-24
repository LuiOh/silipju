// 기본 검색조건·대출상품·규정 기준일·외부 API 연결 상태를 내려주는 메타 API

import path from "node:path";
import { connection } from "next/server";
import type { MetaResponse } from "@/lib/types";
import { defaultConditions } from "@/lib/defaults";
import { LOAN_PRODUCTS, POLICY_AS_OF, POLICY_SOURCES } from "@/lib/finance/policy";
import { getStore, realDataSummary } from "@/lib/data/store";
import { tmapAvailable } from "@/lib/commute/tmap";
import { molitAvailable } from "@/lib/molit";
import { getApiKey } from "@/lib/settings";
import { loadLoanInfo } from "@/lib/finance/live-rates-fetch";
import { stationLines } from "@/lib/rank/station-access";

export async function GET() {
  await connection();
  const realData = realDataSummary();
  const hasReal = realData.units > 0;
  const regions = [...new Set([...getStore().complexes.values()].filter((c) => hasReal ? c.source !== "demo" : true).map((c) => c.region.sigungu))].sort(
    (a, b) => a.localeCompare(b, "ko"),
  );
  const base = defaultConditions();
  const defaults = hasReal
    ? { ...base, includeDemo: false, priceMin: null, priceMax: null, areaMin: null, areaMax: null, maxCommuteMinutes: null }
    : base;
  const body: MetaResponse = {
    policyAsOf: POLICY_AS_OF,
    providers: { tmap: tmapAvailable(), kakao: !!getApiKey("kakao"), molit: molitAvailable(), finlife: !!getApiKey("finlife") },
    regions,
    stationLines: stationLines(),
    loanProducts: LOAN_PRODUCTS,
    sources: POLICY_SOURCES,
    defaults,
    realData,
    extensionPath: path.join(process.cwd(), "extension"),
    loanInfo: loadLoanInfo(),
  };
  return Response.json(body);
}
