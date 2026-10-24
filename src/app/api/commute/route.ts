// 매물→직장 정밀 경로 조회(TMAP 키가 있으면 실경로, 없거나 실패하면 추정치와 사유 반환)

import type { NextRequest } from "next/server";
import type { CommuteMode, GeoPoint, Workplace } from "@/lib/types";
import { estimateCommute } from "@/lib/commute/estimate";
import { TmapError, tmapAvailable, tmapRoute } from "@/lib/commute/tmap";

interface CommuteRequest {
  origin: GeoPoint;
  originName: string;
  workplace: Workplace;
  mode: CommuteMode;
}

function validPoint(p: GeoPoint | undefined): p is GeoPoint {
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng);
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as CommuteRequest | null;
  if (!body || !validPoint(body.origin) || !validPoint(body.workplace?.location)) {
    return Response.json({ error: "origin, workplace.location 좌표가 필요합니다." }, { status: 400 });
  }
  const mode: CommuteMode = body.mode === "car" ? "car" : "transit";
  const appUrl = req.nextUrl.origin;
  const fallback = () => estimateCommute(body.origin, body.originName ?? "출발지", body.workplace, mode, appUrl);

  if (!tmapAvailable()) {
    return Response.json({ route: fallback(), notice: "TMAP 키가 없어 추정치를 보여줍니다. 상단 API 설정에서 키를 넣을 수 있습니다." });
  }
  try {
    const route = await tmapRoute(body.origin, body.originName ?? "출발지", body.workplace, mode, appUrl);
    return Response.json({ route, notice: null });
  } catch (e) {
    const msg = e instanceof TmapError ? e.message : "TMAP 호출 실패";
    return Response.json({ route: fallback(), notice: `${msg} — 추정치로 대체했습니다.` });
  }
}
