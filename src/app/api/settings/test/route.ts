// 저장된 외부 API 키로 실제 최소 호출을 한 번 해 연결 여부를 알려주는 API

import { checkApiKey } from "@/lib/api-key-check";
import { isApiKeyName } from "@/lib/settings";
import type { ApiKeyTestResult } from "@/lib/types";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
  if (!isApiKeyName(body?.name)) return Response.json({ error: "name은 tmap, kakao, molit, finlife, anthropic 중 하나여야 합니다." }, { status: 400 });
  const result: ApiKeyTestResult = await checkApiKey(body.name);
  return Response.json(result);
}
