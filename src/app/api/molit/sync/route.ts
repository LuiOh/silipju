// 저장된 국토부 키로 DB 단지의 시군구 실거래가·전월세(최근 12개월)를 가져오고 세안고를 다시 판별하는 API

import { openDb } from "@/lib/db/client";
import { syncMolitForApp } from "@/lib/jobs/molit-sync";
import { getApiKey } from "@/lib/settings";
import type { MolitSyncResult } from "@/lib/types";

let running = false;

export async function POST() {
  const key = getApiKey("molit");
  if (!key) return Response.json({ error: "국토부 키가 없습니다. API 설정에서 먼저 저장하세요." }, { status: 400 });
  if (running) return Response.json({ error: "이미 실거래가를 가져오는 중입니다. 끝난 뒤 다시 시도하세요." }, { status: 409 });
  running = true;
  // 웹 서버 공용 연결과 다른 연결에 써야 data_version이 바뀌어 메모리 스냅샷이 새 판별 결과로 다시 만들어진다
  const db = openDb();
  try {
    const result: MolitSyncResult = await syncMolitForApp(db, key);
    return Response.json(result);
  } finally {
    db.close();
    running = false;
  }
}
