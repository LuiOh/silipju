// 네이버페이 부동산 응답 JSON/HAR 가져오기(수동 업로드·확장프로그램 자동 수집 공용)·초기화 API

import type { NextRequest } from "next/server";
import { clearImported, importPayload } from "@/lib/data/store";

const MAX_BYTES = 80 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const text = await req.text();
  if (text.length > MAX_BYTES) return Response.json({ error: "80MB 이하 파일만 가져올 수 있습니다." }, { status: 413 });
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return Response.json({ error: "JSON 또는 HAR 파일이 아닙니다." }, { status: 400 });
  }
  const source = req.nextUrl.searchParams.get("source") === "extension" ? "extension" : "upload";
  const { accepted, result } = importPayload(payload, source, text);
  return Response.json(result, { status: accepted ? 200 : 422 });
}

export async function DELETE() {
  clearImported();
  return Response.json({ ok: true });
}
