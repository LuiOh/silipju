// 고른 지역에서 세대수가 아직 없는 실매물 단지(좌표 포함) 목록. 확장프로그램의 세대수 보완 단계가 쓴다

import type { NextRequest } from "next/server";
import { missingHouseholds } from "@/lib/data/store";
import { readRegions } from "../regions";

export async function POST(req: NextRequest) {
  let body: { regions?: unknown };
  try {
    body = (await req.json()) as { regions?: unknown };
  } catch {
    return Response.json({ error: "JSON 본문이 필요합니다." }, { status: 400 });
  }
  const regions = readRegions(body.regions);
  if (!regions || regions.length === 0) return Response.json({ error: "regions(시·구 이름 목록)가 필요합니다." }, { status: 400 });
  return Response.json({ items: missingHouseholds(regions) });
}
