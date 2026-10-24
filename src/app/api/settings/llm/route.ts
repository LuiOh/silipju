// 동네 브리핑에 쓸 LLM 모델 ID 조회·저장 API(빈 값이면 기본 모델로 되돌린다)

import { connection } from "next/server";
import { DEFAULT_LLM_MODEL, getLlmModel, isValidModelId, setLlmModel } from "@/lib/llm/anthropic";
import type { LlmSettings } from "@/lib/types";

function current(): LlmSettings {
  return { model: getLlmModel(), defaultModel: DEFAULT_LLM_MODEL };
}

export async function GET() {
  await connection();
  return Response.json(current());
}

export async function PUT(req: Request) {
  const body = (await req.json().catch(() => null)) as { model?: unknown } | null;
  if (!body || (body.model !== null && typeof body.model !== "string")) {
    return Response.json({ error: "model은 문자열이나 null이어야 합니다." }, { status: 400 });
  }
  const model = (body.model ?? "").trim();
  if (model !== "" && !isValidModelId(model)) {
    return Response.json({ error: "모델 ID는 영문·숫자·점·하이픈·밑줄만 쓸 수 있습니다. 예를 들면 claude-sonnet-5-5입니다." }, { status: 400 });
  }
  setLlmModel(model === "" || model === DEFAULT_LLM_MODEL ? null : model);
  return Response.json(current());
}
