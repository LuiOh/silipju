// 백엔드 JSON API 호출 래퍼(브라우저 전용)와 검색 조건 저장/병합 유틸
import type {
  ApiKeyName,
  ApiKeyTestResult,
  ApiSettingsResponse,
  CollectedComplex,
  CommuteMode,
  CommuteRoute,
  ComplexBriefResponse,
  ComplexDetail,
  GeoPoint,
  ImportResult,
  LlmSettings,
  LoanInfoSnapshot,
  MetaResponse,
  MolitSyncResult,
  NeighborhoodBrief,
  PlaceSuggestion,
  SearchConditions,
  SearchResponse,
  Workplace,
} from "@/lib/types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function readError(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && "error" in body && typeof body.error === "string") return body.error;
  } catch {
    return `요청 실패(${res.status})`;
  }
  return `요청 실패(${res.status})`;
}

async function json<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return (await res.json()) as T;
}

export function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "알 수 없는 오류가 발생했습니다.";
}

export const api = {
  meta: (signal?: AbortSignal) => json<MetaResponse>("/api/meta", { signal }),
  search: (body: SearchConditions, signal?: AbortSignal) =>
    json<SearchResponse>("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    }),
  places: (q: string, signal?: AbortSignal) =>
    json<{ items: PlaceSuggestion[] }>(`/api/places?q=${encodeURIComponent(q)}`, { signal }),
  commute: (body: { origin: GeoPoint; originName: string; workplace: Workplace; mode: CommuteMode }) =>
    json<{ route: CommuteRoute; notice: string | null }>("/api/commute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  complex: (id: string, signal?: AbortSignal) =>
    json<ComplexDetail & { notice: string | null }>(`/api/complex/${encodeURIComponent(id)}`, { signal }),
  complexBrief: (id: string, signal?: AbortSignal) =>
    json<ComplexBriefResponse>(`/api/complex/${encodeURIComponent(id)}/brief`, { signal }),
  generateBrief: (id: string, signal?: AbortSignal) =>
    json<{ brief: NeighborhoodBrief }>(`/api/complex/${encodeURIComponent(id)}/brief`, { method: "POST", signal }),
  async importFile(text: string): Promise<ImportResult> {
    const res = await fetch("/api/import", { method: "POST", body: text });
    if (res.status === 422) return (await res.json()) as ImportResult;
    if (!res.ok) throw new ApiError(await readError(res), res.status);
    return (await res.json()) as ImportResult;
  },
  clearImport: () => json<{ ok: boolean }>("/api/import", { method: "DELETE" }),
  collected: (signal?: AbortSignal) =>
    json<{ items: CollectedComplex[]; total: { complexes: number; units: number } }>("/api/collected", { signal }),
  settings: (signal?: AbortSignal) => json<ApiSettingsResponse>("/api/settings", { signal }),
  saveSettings: (body: Partial<Record<ApiKeyName, string | null>>) =>
    json<ApiSettingsResponse>("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  testSetting: (name: ApiKeyName) =>
    json<ApiKeyTestResult>("/api/settings/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  llmSettings: (signal?: AbortSignal) => json<LlmSettings>("/api/settings/llm", { signal }),
  saveLlmModel: (model: string | null) =>
    json<LlmSettings>("/api/settings/llm", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
    }),
  syncMolit: () => json<MolitSyncResult>("/api/molit/sync", { method: "POST" }),
  refreshLoanInfo: () => json<{ snapshot: LoanInfoSnapshot }>("/api/loan-info", { method: "POST" }),
};

const STORAGE_KEY = "silipju:conditions:v2";
const LEGACY_STORAGE_KEY = "silipju:conditions:v1";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 저장된 조건을 기본값 위에 얹는다(스키마가 바뀌어도 빠진 필드는 기본값으로 채움) */
export function mergeConditions(defaults: SearchConditions, stored: unknown): SearchConditions {
  if (!isRecord(stored)) return defaults;
  const s = stored as Partial<SearchConditions>;
  return {
    ...defaults,
    ...s,
    household: { ...defaults.household, ...(isRecord(s.household) ? s.household : {}) },
    loan: {
      ...defaults.loan,
      ...(isRecord(s.loan) ? s.loan : {}),
      rates: { ...defaults.loan.rates, ...(isRecord(s.loan) && isRecord(s.loan.rates) ? s.loan.rates : {}) },
    },
    seango: { ...defaults.seango, ...(isRecord(s.seango) ? s.seango : {}) },
    weights: { ...defaults.weights, ...(isRecord(s.weights) ? s.weights : {}) },
    floors: { ...defaults.floors, ...(isRecord(s.floors) ? s.floors : {}) },
    excludedLines: Array.isArray(s.excludedLines) ? s.excludedLines.filter((l): l is string => typeof l === "string") : defaults.excludedLines,
    workplaces: Array.isArray(s.workplaces) ? s.workplaces : defaults.workplaces,
    regions: Array.isArray(s.regions) ? s.regions : defaults.regions,
  };
}

export function loadStoredConditions(defaults: SearchConditions): SearchConditions {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return mergeConditions(defaults, JSON.parse(raw));
    // v1에는 데이터 범위(includeDemo) 선택이 없었으므로 그 값만 버리고 나머지 조건을 옮긴다
    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacy) return defaults;
    const parsed: unknown = JSON.parse(legacy);
    if (isRecord(parsed)) delete parsed.includeDemo;
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    return mergeConditions(defaults, parsed);
  } catch {
    // 저장값이 깨졌으면 기본값으로 시작한다
    window.localStorage.removeItem(STORAGE_KEY);
    return defaults;
  }
}

export function storeConditions(c: SearchConditions): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch (e) {
    console.warn("검색 조건을 저장하지 못했습니다.", e);
  }
}
