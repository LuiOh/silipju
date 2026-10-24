"use client";
// API 설정 모달: 외부 API 키(TMAP·카카오·국토부·금융감독원·Anthropic) 저장·삭제·연결 테스트, 브리핑 모델 선택, 국토부 실거래가 즉시 수집
import { useEffect, useEffectEvent, useId, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, DatabaseZap, ExternalLink, Eye, EyeOff, Loader2, PlugZap, Trash2, X, XCircle } from "lucide-react";
import type { ApiKeyName, ApiKeyStatus, ApiKeyTestResult, ApiSettingsResponse, LlmSettings, MolitSyncResult } from "@/lib/types";
import { api, errorMessage, isAbort } from "./api";
import { Badge, FieldLabel, controlClass, cx } from "./ui";

interface KeySpec {
  name: ApiKeyName;
  title: string;
  enables: string;
  links: { label: string; url: string }[];
  hint: string;
  testNote: string;
}

const SPECS: KeySpec[] = [
  {
    name: "tmap",
    title: "TMAP 경로(SK open API)",
    enables: "실제 대중교통·자동차 통근시간을 계산합니다. 키가 없으면 역·노선 기반 추정치를 씁니다.",
    links: [{ label: "SK open API에서 앱키 발급", url: "https://openapi.sk.com" }],
    hint: "앱키(appKey)",
    testNote: "연결 테스트는 자동차 경로 1건만 호출합니다. 하루 무료 10건인 대중교통 호출은 쓰지 않습니다.",
  },
  {
    name: "kakao",
    title: "카카오 로컬",
    enables: "직장·장소 검색을 카카오 장소 데이터로 정확하게 찾습니다. 키가 없으면 내장 장소 사전과 OpenStreetMap을 씁니다.",
    links: [{ label: "카카오 개발자 콘솔에서 REST API 키 발급", url: "https://developers.kakao.com" }],
    hint: "REST API 키",
    testNote: "연결 테스트는 '판교역'을 1건 검색합니다.",
  },
  {
    name: "molit",
    title: "국토교통부 실거래가·전월세",
    enables: "아파트 매매 실거래가와 전월세 신고 자료를 가져와 실거래 비교와 세안고 판별 보조에 씁니다.",
    links: [
      { label: "공공데이터포털 매매 실거래가 활용신청", url: "https://www.data.go.kr/data/15126468/openapi.do" },
      { label: "전월세 실거래가 활용신청", url: "https://www.data.go.kr/data/15126474/openapi.do" },
    ],
    hint: "일반 인증키(Decoding)",
    testNote: "연결 테스트는 성남시 분당구의 지난달 매매 자료를 한 번 조회합니다. 두 데이터셋 모두 활용신청해야 합니다.",
  },
  {
    name: "finlife",
    title: "금융감독원 금융상품 한눈에",
    enables: "은행 주택담보대출 현행 공시 금리를 대출 계산에 자동으로 반영합니다.",
    links: [{ label: "금융상품 한눈에 오픈 API 인증키 신청", url: "https://finlife.fss.or.kr/finlife/main/contents.do?menuNo=700029" }],
    hint: "인증키(auth)",
    testNote: "연결 테스트는 은행권 주택담보대출 상품 목록 1쪽을 조회합니다.",
  },
  {
    name: "anthropic",
    title: "Anthropic Claude(AI 동네 브리핑)",
    enables:
      "상세 화면의 AI 동네 브리핑을 켭니다. Claude가 웹 검색으로 입지·입주민 평판·배정 초등학교 근거를 찾아 요약합니다. 브리핑을 만들 때마다 토큰과 웹 검색 비용이 드는 유료 호출입니다.",
    links: [{ label: "Anthropic 콘솔에서 API 키 발급", url: "https://console.anthropic.com/settings/keys" }],
    hint: "API 키(sk-ant-…)",
    testNote: "연결 테스트는 아주 짧은 메시지 1건만 보냅니다. 소액이지만 과금됩니다.",
  },
];

function SourceBadge({ status }: { status: ApiKeyStatus }) {
  if (status.source === "db") return <Badge className="bg-movein-soft text-movein">저장됨</Badge>;
  if (status.source === "env") return <Badge className="bg-brand-50 text-brand-700">.env에서 읽음</Badge>;
  return <Badge className="bg-surface-3 text-ink-3">없음</Badge>;
}

function Notice({ ok, children }: { ok: boolean; children: ReactNode }) {
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <div className={cx("flex items-start gap-2 rounded-control px-3 py-2 text-xs leading-relaxed", ok ? "bg-movein-soft text-movein" : "bg-seango-soft text-seango")}>
      <Icon className="mt-px size-3.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

const secondaryButton =
  "inline-flex h-8 items-center gap-1.5 rounded-control px-2.5 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-40";

function MolitSync({ enabled, onSynced }: { enabled: boolean; onSynced: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MolitSyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      const r = await api.syncMolit();
      setResult(r);
      if (r.ok) onSynced();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void run()}
          disabled={!enabled || busy}
          className="inline-flex h-8 items-center gap-1.5 rounded-control bg-ink px-3 text-xs font-semibold text-white hover:bg-ink-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <DatabaseZap className="size-3.5" aria-hidden />}
          {busy ? "가져오는 중" : "실거래가·전월세 지금 가져오기"}
        </button>
        <p className="min-w-0 flex-1 basis-56 text-[11.5px] leading-snug text-ink-3">
          {enabled
            ? "수집한 단지의 시군구마다 최근 12개월 치를 가져오고 세안고를 다시 판별합니다. 시군구가 많으면 1분 넘게 걸릴 수 있습니다."
            : "국토부 키를 저장하면 쓸 수 있습니다."}
        </p>
      </div>
      <div aria-live="polite" className="mt-2 space-y-2 empty:hidden">
        {error ? <Notice ok={false}>{error}</Notice> : null}
        {result ? (
          <Notice ok={result.ok}>
            <p className="font-semibold">{result.message}</p>
            {result.trades || result.rents ? (
              <p className="mt-0.5 text-ink-2 tnum">
                {result.trades ? `매매 수신 ${result.trades.fetched.toLocaleString()}건(요청 ${result.trades.requests}회)` : ""}
                {result.trades && result.rents ? " · " : ""}
                {result.rents ? `전월세 수신 ${result.rents.fetched.toLocaleString()}건(요청 ${result.rents.requests}회)` : ""}
              </p>
            ) : null}
            {result.warnings.length > 0 ? (
              <ul className="scroll-thin mt-1.5 max-h-28 list-disc space-y-0.5 overflow-y-auto pl-4 text-[11.5px] text-ink-2">
                {result.warnings.map((w, i) => (
                  <li key={`${i}-${w}`}>{w}</li>
                ))}
              </ul>
            ) : null}
          </Notice>
        ) : null}
      </div>
    </div>
  );
}

function LlmModelField() {
  const [settings, setSettings] = useState<LlmSettings | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<ApiKeyTestResult | null>(null);
  const id = useId();

  const applySettings = useEffectEvent((s: LlmSettings) => {
    setSettings(s);
    setDraft(s.model);
  });
  const failSettings = useEffectEvent((e: unknown) => setNotice({ ok: false, message: `모델 설정을 불러오지 못했습니다. ${errorMessage(e)}` }));
  useEffect(() => {
    const ctrl = new AbortController();
    api
      .llmSettings(ctrl.signal)
      .then(applySettings)
      .catch((e: unknown) => {
        if (!isAbort(e)) failSettings(e);
      });
    return () => ctrl.abort();
  }, []);

  const save = async (model: string | null) => {
    setBusy(true);
    setNotice(null);
    try {
      const next = await api.saveLlmModel(model);
      setSettings(next);
      setDraft(next.model);
      setNotice({ ok: true, message: `브리핑 모델을 ${next.model}(으)로 정했습니다.` });
    } catch (e) {
      setNotice({ ok: false, message: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="mt-3 border-t border-line pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save(draft.trim() || null);
      }}
    >
      <FieldLabel htmlFor={`${id}-model`} hint={settings ? `기본값 ${settings.defaultModel}` : undefined}>
        브리핑 모델 ID
      </FieldLabel>
      <div className="flex flex-wrap gap-2">
        <input
          id={`${id}-model`}
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={settings?.defaultModel ?? "claude-sonnet-5-5"}
          disabled={busy || settings === null}
          className={cx(controlClass, "min-w-0 flex-1 basis-48 font-mono text-[13px] placeholder:font-sans")}
        />
        <button
          type="submit"
          disabled={busy || settings === null || draft.trim() === settings.model}
          className={cx(secondaryButton, "h-9 bg-surface-3 text-ink hover:bg-line")}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
          모델 저장
        </button>
        <button
          type="button"
          onClick={() => void save(null)}
          disabled={busy || settings === null || settings.model === settings.defaultModel}
          className={cx(secondaryButton, "h-9 text-ink-2 hover:bg-surface-3")}
        >
          기본값으로
        </button>
      </div>
      <p className="mt-1 text-[11.5px] leading-snug text-ink-4">
        웹 검색을 지원하는 Claude 모델이어야 합니다. 더 빠르고 싸게 쓰려면 claude-haiku-5-5, 더 꼼꼼하게 쓰려면 claude-opus-5-5를 넣으세요.
      </p>
      <div aria-live="polite" className="mt-2 empty:hidden">
        {notice ? <Notice ok={notice.ok}>{notice.message}</Notice> : null}
      </div>
    </form>
  );
}

function KeyCard({
  spec,
  status,
  onSaved,
  onSynced,
}: {
  spec: KeySpec;
  status: ApiKeyStatus;
  onSaved: (next: ApiSettingsResponse) => void;
  onSynced: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState<"save" | "clear" | "test" | null>(null);
  const [notice, setNotice] = useState<ApiKeyTestResult | null>(null);
  const id = useId();
  const inputId = `${id}-key`;

  const save = async (value: string | null) => {
    setBusy(value === null ? "clear" : "save");
    setNotice(null);
    try {
      const next = await api.saveSettings({ [spec.name]: value });
      setDraft("");
      setReveal(false);
      const after = next[spec.name];
      const message =
        value === null
          ? after.source === "env"
            ? "앱에 저장한 키를 지웠습니다. 이제 .env의 키를 씁니다."
            : "앱에 저장한 키를 지웠습니다."
          : "키를 저장했습니다. 연결 테스트로 확인해 보세요.";
      setNotice({ ok: true, message });
      onSaved(next);
    } catch (e) {
      setNotice({ ok: false, message: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy("test");
    setNotice(null);
    try {
      setNotice(await api.testSetting(spec.name));
    } catch (e) {
      setNotice({ ok: false, message: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby={`${id}-title`} className="rounded-card border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`${id}-title`} className="text-sm font-bold text-ink">
          {spec.title}
        </h3>
        <SourceBadge status={status} />
        {status.masked ? (
          <code className="rounded bg-surface-3 px-1.5 py-0.5 text-[11.5px] text-ink-2">
            {status.masked}
          </code>
        ) : null}
      </div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">{spec.enables}</p>
      <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {spec.links.map((l) => (
          <li key={l.url}>
            <a
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-control text-xs font-semibold text-brand-700 underline underline-offset-2 hover:text-brand-900 focus-visible:outline-2 focus-visible:outline-brand-500"
            >
              <ExternalLink className="size-3" aria-hidden />
              {l.label}
            </a>
          </li>
        ))}
      </ul>

      <form
        className="mt-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) void save(draft.trim());
        }}
      >
        <FieldLabel htmlFor={inputId} hint={spec.hint}>
          {status.set ? "새 키로 바꾸기" : "키 입력"}
        </FieldLabel>
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <input
              id={inputId}
              type={reveal ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={status.set ? "새 키를 붙여넣으면 바꿉니다" : "키를 붙여넣으세요"}
              disabled={busy !== null}
              className={cx(controlClass, "pr-10 font-mono text-[13px] placeholder:font-sans")}
            />
            <button
              type="button"
              onClick={() => setReveal((v) => !v)}
              aria-label={reveal ? "키 가리기" : "키 보기"}
              aria-pressed={reveal}
              aria-controls={inputId}
              className="absolute inset-y-0 right-0 grid w-9 place-items-center rounded-r-control text-ink-3 hover:text-ink focus-visible:outline-2 focus-visible:outline-brand-500"
            >
              {reveal ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
            </button>
          </div>
          <button
            type="submit"
            disabled={busy !== null || draft.trim() === ""}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-control bg-brand-600 px-4 text-[13px] font-semibold text-white hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-40"
          >
            {busy === "save" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            저장
          </button>
        </div>
      </form>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => void test()}
          disabled={busy !== null || !status.set}
          className={cx(secondaryButton, "bg-surface-3 text-ink hover:bg-line")}
        >
          {busy === "test" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <PlugZap className="size-3.5" aria-hidden />}
          연결 테스트
        </button>
        <button
          type="button"
          onClick={() => void save(null)}
          disabled={busy !== null || status.source !== "db"}
          title={status.source === "env" ? ".env 값은 파일에서 지워야 합니다." : undefined}
          className={cx(secondaryButton, "text-seango hover:bg-seango-soft")}
        >
          {busy === "clear" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Trash2 className="size-3.5" aria-hidden />}
          지우기
        </button>
        <p className="min-w-0 flex-1 basis-56 text-[11.5px] leading-snug text-ink-4">{spec.testNote}</p>
      </div>

      <div aria-live="polite" className="mt-2 empty:hidden">
        {notice ? <Notice ok={notice.ok}>{notice.message}</Notice> : null}
      </div>

      {spec.name === "molit" ? <MolitSync enabled={status.set} onSynced={onSynced} /> : null}
      {spec.name === "anthropic" ? <LlmModelField /> : null}
    </section>
  );
}

export default function SettingsModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [statuses, setStatuses] = useState<ApiSettingsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const close = useEffectEvent(() => onClose());
  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const applyStatuses = useEffectEvent((s: ApiSettingsResponse) => setStatuses(s));
  const failStatuses = useEffectEvent((e: unknown) => setLoadError(errorMessage(e)));
  useEffect(() => {
    const ctrl = new AbortController();
    api
      .settings(ctrl.signal)
      .then(applyStatuses)
      .catch((e: unknown) => {
        if (!isAbort(e)) failStatuses(e);
      });
    return () => ctrl.abort();
  }, []);

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-ink/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex max-h-[92dvh] w-full max-w-2xl flex-col rounded-card bg-surface shadow-pop outline-none"
      >
        <div className="flex items-center gap-2 border-b border-line px-5 py-4">
          <h2 id={titleId} className="text-base font-bold text-ink">
            API 설정
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="ml-auto grid size-8 place-items-center rounded-control text-ink-3 hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-brand-500"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <div className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto bg-surface-2 px-5 py-4 text-[13px] text-ink-2">
          <p className="text-xs leading-relaxed text-ink-3">
            모두 선택 사항입니다. 키는 이 컴퓨터의 앱 DB(.data/silipju.db)에만 저장되고 화면에는 앞뒤 몇 글자만 보입니다. 앱에 저장한 키가 .env.local 값보다 먼저 쓰입니다.
          </p>
          {loadError ? <Notice ok={false}>설정을 불러오지 못했습니다. {loadError}</Notice> : null}
          {statuses === null && !loadError ? (
            <p className="flex items-center gap-2 text-xs text-ink-3">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              불러오는 중입니다.
            </p>
          ) : null}
          {statuses
            ? SPECS.map((spec) => (
                <KeyCard
                  key={spec.name}
                  spec={spec}
                  status={statuses[spec.name]}
                  onSaved={(next) => {
                    setStatuses(next);
                    onChanged();
                  }}
                  onSynced={onChanged}
                />
              ))
            : null}
        </div>

        <div className="flex items-center gap-2 border-t border-line px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="ml-auto h-9 rounded-control bg-ink px-4 text-[13px] font-semibold text-white hover:bg-ink-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
