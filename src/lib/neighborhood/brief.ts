// 단지 사실 정보로 프롬프트를 만들어 Claude 웹 검색으로 동네 브리핑을 생성하고 JSON 답을 견고하게 해석한다(서버 전용)

import { haversineKm } from "@/lib/commute/estimate";
import { STATIONS } from "@/lib/commute/stations";
import { createMessage, textOf, type ContentBlock, type MessagesRequest, type WebSearchCitation } from "@/lib/llm/anthropic";
import type { BriefConfidence, BriefLink, BriefQuote, Complex, NearbySchool, NeighborhoodBriefContent } from "@/lib/types";

export const SCHOOLZONE_URL = "https://schoolzone.emac.kr/";
const MAX_WEB_SEARCHES = 8;
const MAX_CONTINUATIONS = 3;
const REQUEST_TIMEOUT_MS = 240_000;
const MAX_SOURCES = 20;

export class BriefParseError extends Error {}

export function briefLinks(complex: Complex): BriefLink[] {
  const links: BriefLink[] = [];
  const naverNo = /^naver-(\d+)$/.exec(complex.id)?.[1];
  if (naverNo) links.push({ title: "네이버페이 부동산 단지 정보", url: `https://fin.land.naver.com/complexes/${naverNo}` });
  links.push({ title: "호갱노노에서 검색", url: `https://hogangnono.com/search?q=${encodeURIComponent(complex.name)}` });
  links.push({ title: "학구도안내서비스(배정 학교 확인)", url: SCHOOLZONE_URL });
  return links;
}

const KIND_LABEL: Record<NearbySchool["kind"], string> = { elementary: "초", middle: "중", high: "고" };

function nearestStationLines(complex: Complex): string[] {
  return STATIONS.map((s) => ({ s, km: haversineKm(complex.location, s) }))
    .filter((x) => x.km <= 3)
    .sort((a, b) => a.km - b.km)
    .slice(0, 3)
    .map(({ s, km }) => `${s.name}역(${s.lines.join("·")}) 직선 ${km.toFixed(1)}km`);
}

export function buildBriefPrompt(complex: Complex, schools: NearbySchool[]): { system: string; user: string } {
  const stations = nearestStationLines(complex);
  const schoolLines = schools.slice(0, 12).map((s) => `${s.name}(${KIND_LABEL[s.kind]}) 직선 ${s.distanceM}m`);
  const facts = [
    `단지명: ${complex.name}`,
    `주소: ${complex.address}`,
    `시군구: ${complex.region.sido} ${complex.region.sigungu}`,
    `세대수: ${complex.households ?? "모름"}`,
    `사용승인 연도: ${complex.approvalYear ?? "모름"}`,
    `좌표: 위도 ${complex.location.lat.toFixed(5)}, 경도 ${complex.location.lng.toFixed(5)}`,
    `가까운 철도역(앱 내장 표 기준): ${stations.length > 0 ? stations.join(", ") : "반경 3km 안에 없음"}`,
    `주변 학교(카카오 로컬 반경 1.5km, 직선거리): ${schoolLines.length > 0 ? schoolLines.join(", ") : "자료 없음"}`,
  ].join("\n");

  const system = [
    "당신은 한국 아파트 매수자를 돕는 동네 조사원입니다. 웹 검색 도구로 공개 웹에서 찾은 사실만 한국어로 정리합니다.",
    "규칙:",
    "1. 검색해서 출처 URL로 뒷받침되는 내용만 씁니다. 확실하지 않으면 지어내지 말고 '모름'이라고 씁니다.",
    "2. 입주민 평판은 호갱노노, 네이버 부동산, 블로그, 카페 등 검색되는 공개 후기에서 찾습니다. 분양·중개 홍보성 글은 광고로 보고 걸러 내거나 낮게 평가합니다.",
    "3. 실명, 닉네임, 전화번호, 동·호수 같은 개인 정보는 절대 넣지 않습니다. 인용은 개인을 알아볼 수 없게 짧게 요약합니다.",
    "4. 배정 초등학교는 근거(교육지원청 공지, 학구도, 뉴스, 부동산 단지 정보 등)를 basis와 url에 적습니다. 공식 근거로 확인되면 '확인됨', 정황상 추정이면 '추정', 근거가 없으면 '모름'으로 합니다.",
    "5. 배정 학교는 해마다 바뀔 수 있으니 학구도안내서비스(https://schoolzone.emac.kr/)에서 직접 확인하라는 안내를 cautions에 넣습니다.",
    "6. 검색은 꼭 필요한 만큼만 하고, 마지막 답은 아래 JSON 하나만 ```json 코드 블록으로 출력합니다. JSON 앞뒤에 다른 설명을 붙이지 않습니다.",
  ].join("\n");

  const user = [
    "아래 단지의 동네 브리핑을 만들어 주세요.",
    "",
    facts,
    "",
    "출력 JSON 형식(모든 값은 한국어 문자열, 모르면 '모름' 또는 빈 배열):",
    "```json",
    JSON.stringify(
      {
        summary: "두세 문장 요약",
        location: { transit: "교통", amenities: "상권·생활편의", education: "학원가·교육 환경", nature: "공원·녹지" },
        reputation: {
          pros: ["장점"],
          cons: ["단점"],
          quotes: [{ text: "후기 요지(개인 정보 없이)", source: "출처 이름(예: 호갱노노)", url: "https://..." }],
        },
        schools: {
          assignedElementary: { name: "OO초등학교 또는 null", confidence: "확인됨 | 추정 | 모름", basis: "근거 설명", url: "https://... 또는 null" },
          middleSchoolNote: "중학교 배정(학군) 관련 메모",
        },
        cautions: ["매수 전 주의할 점"],
        sources: [{ title: "출처 제목", url: "https://..." }],
      },
      null,
      2,
    ),
    "```",
  ].join("\n");

  return { system, user };
}

// ---------------------------------------------------------------------------
// 답 해석

function balancedObjectAt(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function looksLikeBrief(v: unknown): v is Record<string, unknown> {
  return isRecord(v) && ("summary" in v || "location" in v || "reputation" in v);
}

function tryParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** 코드 블록 → 본문 속 가장 큰 JSON 객체 순으로 브리핑 모양의 객체를 찾는다 */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const fences = [...text.matchAll(/```(?:json|JSON)?\s*\n?([\s\S]*?)```/g)].map((m) => m[1].trim());
  for (const body of fences.reverse()) {
    const direct = tryParse(body);
    if (looksLikeBrief(direct)) return direct;
    const start = body.indexOf("{");
    const inner = start >= 0 ? balancedObjectAt(body, start) : null;
    const parsed = inner ? tryParse(inner) : undefined;
    if (looksLikeBrief(parsed)) return parsed;
  }
  let best: Record<string, unknown> | null = null;
  let bestLength = 0;
  let checked = 0;
  for (let i = text.indexOf("{"); i >= 0 && checked < 300; i = text.indexOf("{", i + 1), checked++) {
    const candidate = balancedObjectAt(text, i);
    if (!candidate || candidate.length <= bestLength) continue;
    const parsed = tryParse(candidate);
    if (looksLikeBrief(parsed)) {
      best = parsed;
      bestLength = candidate.length;
    }
  }
  return best;
}

const PHONE = /\b0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g;

function str(v: unknown, fallback = "모름", max = 1200): string {
  if (typeof v !== "string") return fallback;
  const t = v.replace(PHONE, "(연락처 생략)").trim();
  return t === "" ? fallback : t.slice(0, max);
}

function httpUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function strList(v: unknown, max = 8): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => str(x, ""))
    .filter((x) => x !== "")
    .slice(0, max);
}

const CONFIDENCES: readonly BriefConfidence[] = ["확인됨", "추정", "모름"];

function normalizeQuote(v: unknown): BriefQuote | null {
  if (!isRecord(v)) return null;
  const text = str(v.text, "", 400);
  if (!text) return null;
  return { text, source: str(v.source, "출처 미상", 80), url: httpUrl(v.url) };
}

function normalizeLink(v: unknown): BriefLink | null {
  if (!isRecord(v)) return null;
  const url = httpUrl(v.url);
  return url ? { title: str(v.title, url, 200), url } : null;
}

function isLink<T>(v: T | null): v is T {
  return v !== null;
}

export function normalizeBrief(raw: Record<string, unknown>): NeighborhoodBriefContent {
  const location = isRecord(raw.location) ? raw.location : {};
  const reputation = isRecord(raw.reputation) ? raw.reputation : {};
  const schools = isRecord(raw.schools) ? raw.schools : {};
  const assigned = isRecord(schools.assignedElementary) ? schools.assignedElementary : {};
  const assignedName = typeof assigned.name === "string" && assigned.name.trim() !== "" && assigned.name.trim() !== "모름" ? str(assigned.name, "", 80) : null;
  const confidence = CONFIDENCES.find((c) => c === assigned.confidence) ?? "모름";
  return {
    summary: str(raw.summary, "요약을 받지 못했습니다."),
    location: {
      transit: str(location.transit),
      amenities: str(location.amenities),
      education: str(location.education),
      nature: str(location.nature),
    },
    reputation: {
      pros: strList(reputation.pros),
      cons: strList(reputation.cons),
      quotes: (Array.isArray(reputation.quotes) ? reputation.quotes : []).map(normalizeQuote).filter(isLink).slice(0, 8),
    },
    schools: {
      assignedElementary: {
        name: assignedName,
        confidence: assignedName ? confidence : "모름",
        basis: str(assigned.basis, "근거를 찾지 못했습니다."),
        url: httpUrl(assigned.url),
      },
      middleSchoolNote: str(schools.middleSchoolNote),
    },
    cautions: strList(raw.cautions, 10),
    sources: (Array.isArray(raw.sources) ? raw.sources : []).map(normalizeLink).filter(isLink),
  };
}

export function parseBriefAnswer(text: string): NeighborhoodBriefContent {
  const obj = extractJsonObject(text);
  if (!obj) throw new BriefParseError("AI 답에서 브리핑 JSON을 찾지 못했습니다. 다시 생성해 보세요.");
  return normalizeBrief(obj);
}

export function citationLinks(content: ContentBlock[]): BriefLink[] {
  const out: BriefLink[] = [];
  for (const block of content) {
    if (block.type !== "text" || !Array.isArray(block.citations)) continue;
    for (const c of block.citations as WebSearchCitation[]) {
      const url = httpUrl(c.url);
      if (url) out.push({ title: str(c.title, url, 200), url });
    }
  }
  return out;
}

export function mergeSources(...lists: BriefLink[][]): BriefLink[] {
  const seen = new Set<string>();
  const out: BriefLink[] = [];
  for (const l of lists.flat()) {
    const key = l.url.replace(/[#/]+$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out.slice(0, MAX_SOURCES);
}

// ---------------------------------------------------------------------------
// 생성

export async function generateBrief(
  complex: Complex,
  schools: NearbySchool[],
  key: string,
  model: string,
): Promise<{ content: NeighborhoodBriefContent; model: string; webSearches: number | null }> {
  const { system, user } = buildBriefPrompt(complex, schools);
  const request: MessagesRequest = {
    model,
    max_tokens: 8000,
    system,
    messages: [{ role: "user", content: user }],
    tools: [
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: MAX_WEB_SEARCHES,
        user_location: { type: "approximate", country: "KR", region: complex.region.sido, city: complex.region.sigungu, timezone: "Asia/Seoul" },
      },
    ],
  };

  const blocks: ContentBlock[] = [];
  let searches: number | null = null;
  let usedModel = model;
  let stopReason: string | null = null;
  for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
    const res = await createMessage(request, key, REQUEST_TIMEOUT_MS);
    blocks.push(...res.content);
    usedModel = res.model || model;
    const n = res.usage?.server_tool_use?.web_search_requests;
    if (typeof n === "number") searches = (searches ?? 0) + n;
    stopReason = res.stop_reason;
    if (stopReason !== "pause_turn") break;
    request.messages = [...request.messages, { role: "assistant", content: res.content }];
  }

  let content: NeighborhoodBriefContent;
  try {
    content = parseBriefAnswer(textOf(blocks));
  } catch (e) {
    if (e instanceof BriefParseError && stopReason === "max_tokens") throw new BriefParseError("AI 답이 길이 제한에 걸려 잘렸습니다. 다시 생성해 보세요.");
    if (e instanceof BriefParseError && stopReason === "pause_turn") throw new BriefParseError("AI 검색이 너무 길어져 끝나지 않았습니다. 다시 생성해 보세요.");
    throw e;
  }
  content.sources = mergeSources(content.sources, citationLinks(blocks));
  return { content, model: usedModel, webSearches: searches };
}
