// Anthropic Messages API를 fetch로 호출하는 서버 전용 클라이언트와 모델 설정·한국어 오류 문구

import { getSetting, redactSecret, setSetting } from "@/lib/settings";

const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

export const DEFAULT_LLM_MODEL = "claude-sonnet-5-5";
const MODEL_SETTING = "llm.model";
const MODEL_PATTERN = /^[a-z0-9][a-z0-9._-]{1,99}$/i;

export function isValidModelId(v: string): boolean {
  return MODEL_PATTERN.test(v);
}

export function getLlmModel(): string {
  const stored = getSetting(MODEL_SETTING);
  return stored && isValidModelId(stored) ? stored : DEFAULT_LLM_MODEL;
}

export function setLlmModel(model: string | null): void {
  setSetting(MODEL_SETTING, model);
}

export interface WebSearchCitation {
  type: string;
  url?: string;
  title?: string;
  cited_text?: string;
}

export type ContentBlock =
  | { type: "text"; text: string; citations?: WebSearchCitation[] | null }
  | { type: "web_search_tool_result"; content: unknown }
  | { type: string; [key: string]: unknown };

export interface MessagesResponse {
  id: string;
  model: string;
  content: ContentBlock[];
  stop_reason: string | null;
  usage?: { server_tool_use?: { web_search_requests?: number } };
}

export interface MessagesRequest {
  model: string;
  max_tokens: number;
  system?: string;
  messages: { role: "user" | "assistant"; content: string | ContentBlock[] }[];
  tools?: Record<string, unknown>[];
}

export class AnthropicError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errorType: string | null,
  ) {
    super(message);
  }
}

export async function createMessage(body: MessagesRequest, key: string, timeoutMs: number): Promise<MessagesResponse> {
  const res = await fetch(MESSAGES_URL, {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": API_VERSION, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = (await res.json().catch(() => null)) as (MessagesResponse & { error?: { type?: string; message?: string } }) | null;
  if (!res.ok || !json || !Array.isArray(json.content)) {
    const message = json?.error?.message ?? `HTTP ${res.status}`;
    throw new AnthropicError(redactSecret(message, key), res.status, json?.error?.type ?? null);
  }
  return json;
}

export function textOf(content: ContentBlock[]): string {
  return content
    .filter((b): b is { type: "text"; text: string } => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
}

export function describeAnthropicError(e: unknown, key: string, model: string): string {
  if (e instanceof DOMException && e.name === "TimeoutError") return "Anthropic 응답이 늦어 시간이 초과됐습니다. 잠시 뒤 다시 시도하세요.";
  if (e instanceof TypeError && e.message === "fetch failed") return "Anthropic API에 연결하지 못했습니다. 인터넷 연결을 확인하세요.";
  if (!(e instanceof AnthropicError)) return redactSecret(e instanceof Error ? e.message : String(e), key);
  const detail = `(${e.message})`;
  if (e.status === 401 || e.errorType === "authentication_error") return `API 키가 올바르지 않습니다. Anthropic 콘솔에서 키를 다시 확인하세요. ${detail}`;
  if (e.status === 403 || e.errorType === "permission_error") return `이 키로는 요청한 기능을 쓸 권한이 없습니다. 콘솔의 조직 설정에서 웹 검색 허용 여부를 확인하세요. ${detail}`;
  if (e.status === 404 || e.errorType === "not_found_error") return `모델 '${model}'을 찾을 수 없습니다. API 설정의 모델 ID를 확인하세요. ${detail}`;
  if (e.status === 429 || e.errorType === "rate_limit_error") return `호출 한도를 넘었습니다. 잠시 뒤 다시 시도하세요. ${detail}`;
  if (e.status === 529 || e.errorType === "overloaded_error") return `Anthropic 서버가 혼잡합니다. 잠시 뒤 다시 시도하세요. ${detail}`;
  if (/credit balance/i.test(e.message)) return `Anthropic 크레딧 잔액이 부족합니다. 콘솔의 Billing에서 충전 상태를 확인하세요. ${detail}`;
  if (e.status === 400 || e.errorType === "invalid_request_error") return `요청이 거부됐습니다. ${detail}`;
  return `Anthropic API 오류입니다. ${detail}`;
}
