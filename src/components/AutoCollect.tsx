"use client";
// 실매물 자동 수집: 수집할 시·구를 고르면 확장프로그램 설치 여부를 확인해 바로 수집을 맡기거나 설치 방법을 안내
import { useEffect, useState } from "react";
import { Building2, Check, Copy, Loader2, Play, RefreshCw, RotateCcw, Square } from "lucide-react";
import { COLLECT_REGIONS, COLLECT_SIDOS, DEFAULT_COLLECT_REGION_IDS, type CollectSido } from "@/lib/collect-regions";
import { Chip, cx } from "./ui";

type JobStatus = "planning" | "running" | "stopped" | "blocked" | "stalled" | "done";
type JobMode = "full" | "households";

interface JobSummary {
  id: string;
  date: string;
  mode: JobMode;
  phase: "listings" | "households";
  status: JobStatus;
  message: string;
  regionIds: string[];
  cellsTotal: number;
  cellsDone: number;
  region: string | null;
  groups: number;
  households: { cellsTotal: number; cellsDone: number; found: number; missingAtStart: number; missingLeft: number } | null;
  startedAt: string | null;
  updatedAt: string | null;
  finishedAt: string | null;
}

type ExtState = "checking" | "missing" | { version: string };

type ExtMessage =
  | { source: "silipju-ext"; type: "hello"; version: string; job: JobSummary | null }
  | { source: "silipju-ext"; type: "job"; job: JobSummary | null }
  | { source: "silipju-ext"; type: "job-reply"; ok: boolean; error?: string };

const SELECTION_KEY = "silipju:collect-regions:v1";
const CHECK_TIMEOUT_MS = 1500;
const ACTIVE: JobStatus[] = ["planning", "running"];
const KNOWN_IDS = new Set(COLLECT_REGIONS.map((r) => r.id));

function isExtMessage(v: unknown): v is ExtMessage {
  return typeof v === "object" && v !== null && "source" in v && v.source === "silipju-ext" && "type" in v;
}

function loadSelection(): string[] {
  try {
    const raw = window.localStorage.getItem(SELECTION_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === "string" && KNOWN_IDS.has(v));
  } catch (e) {
    console.warn("수집 지역 선택을 불러오지 못했습니다.", e);
  }
  return DEFAULT_COLLECT_REGION_IDS;
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const fmt = (n: number) => n.toLocaleString("ko-KR");
const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "");

function statusText(job: JobSummary): string {
  const h = job.households;
  switch (job.status) {
    case "planning":
      return job.phase === "households" ? "지도 창에서 세대수가 빈 단지를 찾는 중입니다." : "지도 창에서 수집할 칸을 나누는 중입니다.";
    case "running":
      if (job.phase === "households" && h) {
        return `세대수가 빈 단지 주변을 확대해 확인하는 중입니다. ${fmt(h.cellsDone)}/${fmt(h.cellsTotal)}곳 · 새로 채운 단지 ${fmt(h.found)}곳 · ${clock(job.updatedAt)} 기준`;
      }
      return `${job.region ?? ""} 수집 중입니다. ${fmt(job.cellsDone)}/${fmt(job.cellsTotal)}칸 · 매물 ${fmt(job.groups)}건 확인 · ${clock(job.updatedAt)} 기준`;
    case "done":
      return job.message || `${job.date} 수집을 마쳤습니다. ${fmt(job.cellsTotal)}칸 · 매물 ${fmt(job.groups)}건 · ${clock(job.finishedAt)} 완료`;
    default:
      return job.message || `${fmt(job.cellsDone)}/${fmt(job.cellsTotal)}칸까지 받았습니다.`;
  }
}

const percent = (done: number, total: number) => (total > 0 ? Math.round((done / total) * 100) : 0);

export default function AutoCollect({ extensionPath }: { extensionPath: string }) {
  const [ext, setExt] = useState<ExtState>("checking");
  const [checkSeq, setCheckSeq] = useState(0);
  const [job, setJob] = useState<JobSummary | null>(null);
  const [selected, setSelected] = useState<string[]>(loadSelection);
  const [sido, setSido] = useState<CollectSido>("경기도");
  const [guideOpen, setGuideOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== window.location.origin || !isExtMessage(e.data)) return;
      const m = e.data;
      if (m.type === "hello") {
        setExt({ version: m.version });
        setJob(m.job);
      } else if (m.type === "job") {
        setJob(m.job);
      } else {
        setSending(false);
        if (!m.ok) setError(m.error ?? "자동 수집을 시작하지 못했습니다.");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    window.postMessage({ source: "silipju-app", type: "ping" }, window.location.origin);
    const t = window.setTimeout(() => setExt((v) => (v === "checking" ? "missing" : v)), CHECK_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [checkSeq]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SELECTION_KEY, JSON.stringify(selected));
    } catch (e) {
      console.warn("수집 지역 선택을 저장하지 못했습니다.", e);
    }
  }, [selected]);

  const chosen = COLLECT_REGIONS.filter((r) => selected.includes(r.id));
  const chosenIds = chosen.map((r) => r.id);
  const installed = typeof ext === "object";
  const active = job !== null && ACTIVE.includes(job.status);
  const sameSelection = job !== null && sameIds(job.regionIds, chosenIds);
  const hh = job?.households ?? null;
  const started = job !== null && (job.cellsTotal > 0 || (hh?.cellsTotal ?? 0) > 0);
  const resumable = job !== null && !active && job.status !== "done" && sameSelection && started;
  const inHouseholds = job !== null && job.phase === "households" && hh !== null && hh.cellsTotal > 0;
  const progress = !job ? 0 : inHouseholds && hh ? percent(hh.cellsDone, hh.cellsTotal) : percent(job.cellsDone, job.cellsTotal);
  const showBar = started && (inHouseholds || (job?.cellsTotal ?? 0) > 0);

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const recheck = () => {
    setExt("checking");
    setCheckSeq((n) => n + 1);
  };

  const start = (restart: boolean, mode: JobMode) => {
    setError(null);
    if (!installed) {
      setGuideOpen(true);
      recheck();
      return;
    }
    setSending(true);
    window.postMessage({ source: "silipju-app", type: "job-start", regions: chosen, restart, mode }, window.location.origin);
  };

  const stop = () => window.postMessage({ source: "silipju-app", type: "job-stop" }, window.location.origin);

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(extensionPath);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      setError(`경로를 복사하지 못했습니다. 직접 선택해 복사하세요. (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  const showGuide = guideOpen || ext === "missing";
  const primaryClass =
    "inline-flex h-9 items-center gap-1.5 rounded-control bg-brand-600 px-4 text-[13px] font-semibold text-white hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-50";
  const secondaryClass =
    "inline-flex h-9 items-center gap-1.5 rounded-control border border-line bg-surface px-3 text-[13px] font-semibold text-ink hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-50";

  return (
    <div className="space-y-3">
      <div className="rounded-card border border-line bg-surface-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-ink">수집할 지역</span>
          <div role="tablist" aria-label="시·도" className="flex gap-1">
            {COLLECT_SIDOS.map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={sido === s}
                onClick={() => setSido(s)}
                className={cx(
                  "h-7 rounded-full px-2.5 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-brand-500",
                  sido === s ? "bg-ink text-white" : "text-ink-3 hover:bg-surface-3",
                )}
              >
                {s}
              </button>
            ))}
          </div>
          <span className="ml-auto text-xs text-ink-3 tnum">{chosen.length}곳 선택</span>
        </div>
        <div className="scroll-thin mt-2 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto" role="group" aria-label={`${sido} 지역`}>
          {COLLECT_REGIONS.filter((r) => r.sido === sido).map((r) => (
            <Chip key={r.id} active={selected.includes(r.id)} onClick={() => toggle(r.id)} ariaLabel={`${sido} ${r.name}`}>
              {r.name}
            </Chip>
          ))}
        </div>
        <p className="mt-2 text-xs leading-relaxed text-ink-3">
          {chosen.length > 0 ? `${chosen.map((r) => r.name).join(" · ")}을 매매 아파트 기준으로 모읍니다.` : "지역을 하나 이상 고르세요."}
          {chosen.length > 0 ? (
            <button type="button" onClick={() => setSelected([])} className="ml-1.5 font-semibold text-ink-2 underline underline-offset-2">
              선택 지우기
            </button>
          ) : null}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {active ? (
            <button type="button" onClick={stop} className={secondaryClass}>
              <Square className="size-3.5" aria-hidden />
              중지
            </button>
          ) : resumable && job ? (
            <>
              <button type="button" onClick={() => start(false, job.mode)} disabled={sending} className={primaryClass}>
                <Play className="size-4" aria-hidden />
                {job.mode === "households" ? "세대수 채우기 이어서" : "이어서 수집"}
              </button>
              <button type="button" onClick={() => start(true, job.mode)} disabled={sending} className={secondaryClass}>
                <RotateCcw className="size-3.5" aria-hidden />
                처음부터 다시
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => start(sameSelection, "full")} disabled={sending || chosen.length === 0} className={primaryClass}>
                {sending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />}
                {job?.status === "done" && sameSelection && job.mode === "full" ? "다시 수집" : "오늘 매물 수집하기"}
              </button>
              <button
                type="button"
                onClick={() => start(true, "households")}
                disabled={sending || chosen.length === 0}
                title="매물은 다시 모으지 않고, 세대수가 빈 단지 주변 지도만 확대해 엽니다."
                className={secondaryClass}
              >
                <Building2 className="size-3.5" aria-hidden />
                세대수 빈 단지 채우기
              </button>
            </>
          )}
          <span className="text-xs text-ink-3">
            {ext === "checking" ? "확장프로그램 확인 중입니다." : installed ? `확장프로그램 ${ext.version} 연결됨` : "확장프로그램이 아직 없습니다."}
          </span>
        </div>

        {job ? (
          <div aria-live="polite" className="mt-3">
            {showBar ? (
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                <div className="h-full rounded-full bg-brand-600 transition-[width]" style={{ width: `${progress}%` }} />
              </div>
            ) : null}
            <p className={cx("mt-1.5 text-xs leading-relaxed", job.status === "blocked" || job.status === "stalled" ? "text-seango" : "text-ink-2")}>
              {statusText(job)}
            </p>
            {active ? <p className="mt-0.5 text-[11.5px] text-ink-4">열린 지도 창을 닫거나 최소화하지 마세요. 이 화면은 수집되는 대로 다시 검색합니다.</p> : null}
            {!active && job.mode === "full" ? (
              <p className="mt-0.5 text-[11.5px] text-ink-4">오늘 매물 수집은 끝에 세대수가 빈 단지를 자동으로 채웁니다. 세대수만 다시 채우려면 &lsquo;세대수 빈 단지 채우기&rsquo;를 누르세요.</p>
            ) : null}
          </div>
        ) : null}
        {error ? <p className="mt-2 rounded-control bg-seango-soft px-3 py-2 text-xs text-seango">{error}</p> : null}
      </div>

      {showGuide ? (
        <div className="rounded-card border border-dashed border-line-strong p-3">
          <p className="text-[13px] font-semibold text-ink">{installed ? "확장프로그램 설치·갱신 방법" : "먼저 확장프로그램을 한 번 설치하세요."}</p>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[13px] leading-relaxed text-ink-2">
            <li>
              크롬 주소창에 <code className="rounded bg-surface-3 px-1">chrome://extensions</code>를 열고 오른쪽 위 개발자 모드를 켭니다.
            </li>
            <li>
              &lsquo;압축해제된 확장 프로그램을 로드합니다&rsquo;를 눌러 아래 폴더를 고릅니다. 이미 설치했다면 실입주 수집기 카드의 새로고침(↻)을 누릅니다.
              <div className="mt-1 flex items-center gap-2 rounded-control bg-surface-3 px-2 py-1.5">
                <code className="min-w-0 flex-1 truncate text-xs text-ink">{extensionPath}</code>
                <button
                  type="button"
                  onClick={() => void copyPath()}
                  className="inline-flex shrink-0 items-center gap-1 rounded-control bg-surface px-2 py-1 text-xs font-semibold text-ink hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-brand-500"
                >
                  {copied ? <Check className="size-3.5 text-movein" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                  {copied ? "복사됨" : "경로 복사"}
                </button>
              </div>
            </li>
            <li>이 페이지를 새로고침한 뒤 지역을 고르고 &lsquo;오늘 매물 수집하기&rsquo;를 누릅니다.</li>
          </ol>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => window.location.reload()} className={secondaryClass}>
              <RefreshCw className="size-3.5" aria-hidden />
              페이지 새로고침
            </button>
            {installed ? (
              <button type="button" onClick={() => setGuideOpen(false)} className={secondaryClass}>
                접기
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setGuideOpen(true)} className="text-xs font-semibold text-ink-3 underline underline-offset-2">
          확장프로그램 설치·갱신 방법 보기
        </button>
      )}
    </div>
  );
}
