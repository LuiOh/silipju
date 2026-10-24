// 저장된 외부 API 키로 최소 1회 실제 호출해 연결 상태를 확인한다(서버 전용, 키 원문은 결과 문구에 넣지 않는다)

import { TmapError, tmapCarRoute } from "@/lib/commute/tmap";
import { createMessage, describeAnthropicError, getLlmModel } from "@/lib/llm/anthropic";
import { fetchTradeMonth, monthsBack } from "@/lib/molit";
import { getApiKey, redactSecret } from "@/lib/settings";
import type { ApiKeyName, ApiKeyTestResult } from "@/lib/types";

const PANGYO = { lat: 37.39477, lng: 127.11116 };
const JEONGJA = { lat: 37.36689, lng: 127.10818 };

function describeError(e: unknown, key: string): string {
  if (e instanceof DOMException && e.name === "TimeoutError") return "응답이 늦어 시간이 초과됐습니다. 잠시 뒤 다시 시도하세요.";
  if (e instanceof TypeError && e.message === "fetch failed") return "네트워크에 연결하지 못했습니다. 인터넷 연결을 확인하세요.";
  return redactSecret(e instanceof Error ? e.message : String(e), key);
}

async function checkTmap(key: string): Promise<ApiKeyTestResult> {
  try {
    const props = await tmapCarRoute(PANGYO, JEONGJA, key);
    return { ok: true, message: `연결됐습니다. 판교역에서 정자역까지 자동차로 약 ${Math.round((props.totalTime ?? 0) / 60)}분입니다.` };
  } catch (e) {
    if (e instanceof TmapError) {
      if (e.status === 401 || e.code === "INVALID_API_KEY") return { ok: false, message: "앱키가 올바르지 않습니다. SK open API 콘솔에서 앱키를 다시 확인하세요." };
      if (e.status === 403) return { ok: false, message: "이 앱키에 TMAP 상품이 구독되어 있지 않거나 사용 권한이 없습니다. 콘솔에서 TMAP API 사용 신청을 확인하세요." };
      if (e.status === 429) return { ok: false, message: "호출 한도를 넘었습니다. 잠시 뒤 다시 시도하세요." };
    }
    return { ok: false, message: describeError(e, key) };
  }
}

async function checkKakao(key: string): Promise<ApiKeyTestResult> {
  const res = await fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?size=1&query=${encodeURIComponent("판교역")}`, {
    headers: { Authorization: `KakaoAK ${key}` },
    signal: AbortSignal.timeout(8000),
  });
  const json = (await res.json().catch(() => null)) as { documents?: { place_name?: string }[]; message?: string } | null;
  if (res.ok) {
    const place = json?.documents?.[0]?.place_name;
    return { ok: true, message: place ? `연결됐습니다. '판교역' 검색 결과는 ${place}입니다.` : "연결됐습니다." };
  }
  const detail = redactSecret(json?.message ?? `HTTP ${res.status}`, key);
  if (res.status === 401) return { ok: false, message: `REST API 키가 올바르지 않습니다. (${detail})` };
  if (res.status === 403) return { ok: false, message: `카카오맵(로컬) 사용 설정이 꺼져 있거나 권한이 없습니다. (${detail})` };
  return { ok: false, message: `카카오 로컬 API 오류입니다. (${detail})` };
}

async function checkMolit(key: string): Promise<ApiKeyTestResult> {
  const ym = monthsBack(2)[1];
  try {
    const rows = await fetchTradeMonth("41135", ym, key);
    return { ok: true, message: `연결됐습니다. 성남시 분당구 ${ym.slice(0, 4)}년 ${Number(ym.slice(4))}월 매매 ${rows.length.toLocaleString()}건을 받았습니다.` };
  } catch (e) {
    return { ok: false, message: describeError(e, key) };
  }
}

async function checkFinlife(key: string): Promise<ApiKeyTestResult> {
  const params = new URLSearchParams({ auth: key, topFinGrpNo: "020000", pageNo: "1" });
  const res = await fetch(`https://finlife.fss.or.kr/finlifeapi/mortgageLoanProductsSearch.json?${params}`, { signal: AbortSignal.timeout(10_000) });
  const json = (await res.json().catch(() => null)) as {
    result?: { err_cd?: string; err_msg?: string; total_count?: string | number; baseList?: { dcls_month?: string }[] };
  } | null;
  const r = json?.result;
  if (!r) return { ok: false, message: `금융감독원 API 응답을 읽지 못했습니다. (HTTP ${res.status})` };
  if (r.err_cd !== "000") return { ok: false, message: redactSecret(`${r.err_msg ?? "알 수 없는 오류"}(${r.err_cd ?? "?"})`, key) };
  const month = r.baseList?.map((b) => b.dcls_month).find((m): m is string => !!m && /^\d{6}$/.test(m));
  const when = month ? ` 공시 기준은 ${month.slice(0, 4)}년 ${Number(month.slice(4))}월입니다.` : "";
  return { ok: true, message: `연결됐습니다. 은행 주택담보대출 상품 ${Number(r.total_count ?? 0).toLocaleString()}개를 확인했습니다.${when}` };
}

async function checkAnthropic(key: string): Promise<ApiKeyTestResult> {
  const model = getLlmModel();
  try {
    const res = await createMessage({ model, max_tokens: 16, messages: [{ role: "user", content: "ping" }] }, key, 20_000);
    return { ok: true, message: `연결됐습니다. 모델 ${res.model}이 응답했습니다.` };
  } catch (e) {
    return { ok: false, message: describeAnthropicError(e, key, model) };
  }
}

const CHECKS: Record<ApiKeyName, (key: string) => Promise<ApiKeyTestResult>> = {
  tmap: checkTmap,
  kakao: checkKakao,
  molit: checkMolit,
  finlife: checkFinlife,
  anthropic: checkAnthropic,
};

export async function checkApiKey(name: ApiKeyName): Promise<ApiKeyTestResult> {
  const key = getApiKey(name);
  if (!key) return { ok: false, message: "저장된 키가 없습니다. 키를 입력하고 저장한 뒤 테스트하세요." };
  try {
    return await CHECKS[name](key);
  } catch (e) {
    return { ok: false, message: `호출하지 못했습니다. ${describeError(e, key)}` };
  }
}
