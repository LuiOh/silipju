// 외부 API 키 저장 상태 조회(마스킹 값만)·저장·삭제 API

import { connection } from "next/server";
import type { ApiKeyName, ApiSettingsResponse } from "@/lib/types";
import { API_KEY_NAMES, apiKeyStatuses, setApiKey } from "@/lib/settings";

const MAX_KEY_LENGTH = 512;

function decodeIfEncoded(v: string): string {
  if (!/%[0-9a-f]{2}/i.test(v)) return v;
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

export async function GET() {
  await connection();
  const body: ApiSettingsResponse = apiKeyStatuses();
  return Response.json(body);
}

export async function PUT(req: Request) {
  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "JSON 객체로 보내야 합니다." }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  const updates: [ApiKeyName, string | null][] = [];
  for (const name of API_KEY_NAMES) {
    if (!(name in input)) continue;
    const raw = input[name];
    if (raw !== null && typeof raw !== "string") return Response.json({ error: `${name} 값은 문자열이나 null이어야 합니다.` }, { status: 400 });
    const trimmed = (raw ?? "").trim();
    if (trimmed.length > MAX_KEY_LENGTH) return Response.json({ error: `${name} 키가 너무 깁니다.` }, { status: 400 });
    // 공공데이터포털 Encoding 키를 붙여넣어도 요청 시 다시 인코딩되므로 Decoding 키로 바꿔 저장한다
    const value = name === "molit" ? decodeIfEncoded(trimmed) : trimmed;
    updates.push([name, value === "" ? null : value]);
  }
  for (const [name, value] of updates) setApiKey(name, value);
  const res: ApiSettingsResponse = apiKeyStatuses();
  return Response.json(res);
}
