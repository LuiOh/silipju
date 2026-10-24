// 단지 동네 브리핑: 캐시된 AI 브리핑·카카오 주변 학교·바로가기 조회(GET)와 Claude 웹 검색으로 새로 생성(POST)

import { connection, type NextRequest } from "next/server";
import type { ComplexBriefResponse, NeighborhoodBrief } from "@/lib/types";
import { getStore } from "@/lib/data/store";
import { describeAnthropicError, getLlmModel } from "@/lib/llm/anthropic";
import { BriefParseError, briefLinks, generateBrief } from "@/lib/neighborhood/brief";
import { nearbySchoolsFor } from "@/lib/neighborhood/schools";
import { finishGenerating, isGenerating, loadBrief, saveBrief, startGenerating } from "@/lib/neighborhood/store";
import { getApiKey } from "@/lib/settings";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/complex/[id]/brief">) {
  await connection();
  const { id } = await ctx.params;
  const complex = getStore().complexes.get(id);
  if (!complex) return Response.json({ error: "단지를 찾을 수 없습니다." }, { status: 404 });

  const { schools, note } = await nearbySchoolsFor(id, complex.location);
  const body: ComplexBriefResponse = {
    brief: loadBrief(id),
    schools,
    schoolsNote: note,
    links: briefLinks(complex),
    llmAvailable: !!getApiKey("anthropic"),
    generating: isGenerating(id),
  };
  return Response.json(body);
}

export async function POST(_req: NextRequest, ctx: RouteContext<"/api/complex/[id]/brief">) {
  const { id } = await ctx.params;
  const complex = getStore().complexes.get(id);
  if (!complex) return Response.json({ error: "단지를 찾을 수 없습니다." }, { status: 404 });
  const key = getApiKey("anthropic");
  if (!key) return Response.json({ error: "Anthropic API 키가 없습니다. 상단 API 설정에서 Anthropic 키를 넣은 뒤 다시 시도하세요." }, { status: 400 });
  if (!startGenerating(id)) return Response.json({ error: "이 단지의 브리핑을 이미 만들고 있습니다. 잠시 뒤 다시 확인하세요." }, { status: 409 });

  const model = getLlmModel();
  try {
    const { schools } = await nearbySchoolsFor(id, complex.location);
    const result = await generateBrief(complex, schools, key, model);
    const brief: NeighborhoodBrief = {
      complexId: id,
      model: result.model,
      createdAt: new Date().toISOString(),
      webSearches: result.webSearches,
      content: result.content,
    };
    saveBrief(brief);
    return Response.json({ brief });
  } catch (e) {
    const message = e instanceof BriefParseError ? e.message : describeAnthropicError(e, key, model);
    return Response.json({ error: `브리핑을 만들지 못했습니다. ${message}` }, { status: 502 });
  } finally {
    finishGenerating(id);
  }
}
