// 확장프로그램·파일·배치로 수집된 실매물 단지 목록(단지별 매물 수·가격대·최근 수집 시각)

import { connection } from "next/server";
import { listCollected, realDataSummary } from "@/lib/data/store";

export async function GET() {
  await connection();
  return Response.json({ items: listCollected(), total: realDataSummary() });
}
