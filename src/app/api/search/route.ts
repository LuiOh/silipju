// 검색조건을 받아 세안고 판별·필요현금·통근시간·점수를 계산한 매물 목록을 반환

import type { NextRequest } from "next/server";
import type { SearchConditions } from "@/lib/types";
import { normalizeConditions } from "@/lib/defaults";
import { runSearch } from "@/lib/search";
import { realDataSummary } from "@/lib/data/store";
import { loadLoanInfo } from "@/lib/finance/live-rates-fetch";

export async function POST(req: NextRequest) {
  let input: Partial<SearchConditions>;
  try {
    input = (await req.json()) as Partial<SearchConditions>;
  } catch {
    return Response.json({ error: "요청 본문이 JSON이 아닙니다." }, { status: 400 });
  }
  const conditions = normalizeConditions(input);
  if (typeof input.includeDemo !== "boolean") conditions.includeDemo = realDataSummary().units === 0;
  return Response.json(runSearch(conditions, req.nextUrl.origin, new Date(), loadLoanInfo()));
}
