// 단지 상세: 단지 정보·매매 매물 그룹·실거래가(배치가 DB에 쌓은 국토부 데이터 → 즉석 조회 → 샘플 순)

import type { NextRequest } from "next/server";
import type { ComplexDetail, RealTrade } from "@/lib/types";
import { getStore } from "@/lib/data/store";
import { getDb } from "@/lib/db/client";
import { findTrades } from "@/lib/db/repo";
import { fetchComplexTrades, molitAvailable } from "@/lib/molit";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/complex/[id]">) {
  const { id } = await ctx.params;
  const store = getStore();
  const complex = store.complexes.get(id);
  if (!complex) return Response.json({ error: "단지를 찾을 수 없습니다." }, { status: 404 });

  let trades: RealTrade[] = [];
  let tradesSource: ComplexDetail["tradesSource"] = "none";
  let notice: string | null = null;
  const stored = complex.source !== "demo" && complex.region.lawdCd ? findTrades(getDb(), complex.region.lawdCd, complex.name) : [];
  if (complex.source === "demo") {
    trades = store.demoTrades.get(id) ?? [];
    tradesSource = "demo";
  } else if (stored.length > 0) {
    trades = stored;
    tradesSource = "molit";
  } else if (molitAvailable() && complex.region.lawdCd) {
    try {
      trades = await fetchComplexTrades(complex.region.lawdCd, complex.name, 12);
      tradesSource = "molit";
    } catch (e) {
      notice = e instanceof Error ? e.message : "실거래가 조회 실패";
    }
  } else {
    notice = molitAvailable() ? "시군구 코드가 없어 실거래가를 조회하지 못했습니다." : "상단 API 설정에서 국토부 키를 넣으면 실거래가를 보여줍니다.";
  }

  const body: ComplexDetail & { notice: string | null } = {
    complex,
    units: store.units.filter((u) => u.complexId === id),
    trades,
    tradesSource,
    notice,
  };
  return Response.json(body);
}
