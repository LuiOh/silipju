// 지역 자동 수집을 끝까지 마친 뒤, 그 수집에서 다시 보이지 않은(팔렸거나 내려간) 매물을 정리하는 API

import type { NextRequest } from "next/server";
import { pruneUnseen } from "@/lib/data/store";
import { readRegions } from "../regions";

interface PruneRequest {
  since?: unknown;
  regions?: unknown;
}

export async function POST(req: NextRequest) {
  let body: PruneRequest;
  try {
    body = (await req.json()) as PruneRequest;
  } catch {
    return Response.json({ error: "JSON 본문이 필요합니다." }, { status: 400 });
  }
  const regions = readRegions(body.regions);
  const since = typeof body.since === "string" && !Number.isNaN(Date.parse(body.since)) ? new Date(body.since).toISOString() : null;
  if (!regions || regions.length === 0 || !since) {
    return Response.json({ error: "since(수집 시작 시각)와 regions(시·구 이름 목록)가 필요합니다." }, { status: 400 });
  }
  return Response.json({ ok: true, removed: pruneUnseen(since, regions) });
}
