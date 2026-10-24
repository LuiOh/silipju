"use client";
// 상단 헤더: 앱 이름·소개, 규정 기준일·현행 대출정보·출처 팝오버, 외부 데이터 연결 상태, API 설정·데이터 가져오기 버튼
import { useEffect, useRef, useState } from "react";
import { BookOpen, ExternalLink, FileUp, Loader2, RefreshCw, Settings } from "lucide-react";
import type { LoanInfoSnapshot, MetaResponse } from "@/lib/types";
import { api, errorMessage } from "./api";
import SettingsModal from "./SettingsModal";
import { cx } from "./ui";

function ProviderChip({ name, on, offLabel }: { name: string; on: boolean; offLabel: string }) {
  return (
    <span
      className={cx(
        "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium whitespace-nowrap",
        on ? "bg-movein-soft text-movein" : "bg-surface-3 text-ink-3",
      )}
    >
      <span aria-hidden className={cx("size-1.5 rounded-full", on ? "bg-movein" : "bg-ink-4")} />
      {name} {on ? "연결됨" : offLabel}
    </span>
  );
}

const fetchedLabel = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

function LoanInfoBlock({ info, onRefreshed }: { info: LoanInfoSnapshot | null; onRefreshed: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.refreshLoanInfo();
      onRefreshed();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const rows = info
    ? [
        info.bogeumjari ? `보금자리론 ${info.bogeumjari.asOf} · 아낌e ${info.bogeumjari.aggime[0]}~${info.bogeumjari.aggime.at(-1)}%` : null,
        info.didimdol ? `디딤돌 ${info.didimdol.asOf}` : null,
        info.newborn ? `신생아 특례 ${info.newborn.asOf}` : null,
        info.bank ? `은행 주담대 ${info.bank.asOf} 취급분 평균금리 중앙값 ${info.bank.median}%(${info.bank.banks.length}개 은행)` : null,
      ].filter((r): r is string => r !== null)
    : [];
  const changed = info ? info.ruleChecks.filter((c) => !c.ok) : [];
  return (
    <div className="mb-2 rounded-control bg-surface-2 p-2.5">
      <div className="flex items-center gap-2">
        <p className="text-xs font-semibold text-ink">현행 대출정보</p>
        <span className="text-[11px] text-ink-4 tnum">{info ? `${fetchedLabel(info.fetchedAt)} 가져옴` : "아직 가져오지 않았습니다."}</span>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={busy}
          className="ml-auto inline-flex h-7 items-center gap-1 rounded-control bg-surface px-2 text-[11.5px] font-semibold text-ink hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
          다시 가져오기
        </button>
      </div>
      {rows.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5 text-[11.5px] text-ink-2 tnum">
          {rows.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}
      {info && info.ruleChecks.length > 0 ? (
        <p className={cx("mt-1.5 text-[11.5px] leading-snug", changed.length === 0 ? "text-movein" : "text-seango")}>
          {changed.length === 0
            ? "보금자리론·디딤돌·신생아 특례 안내문의 핵심 규정 문구가 계산 기준과 같습니다."
            : `안내문 규정 문구가 바뀐 곳이 있습니다. ${changed.map((c) => `${c.label}(${c.missing.join(", ")})`).join(" · ")}`}
        </p>
      ) : null}
      {info && info.warnings.length > 0 ? (
        <ul className="mt-1 space-y-0.5 text-[11px] text-seango">
          {info.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      <p aria-live="polite" className="text-[11px] text-seango">
        {error}
      </p>
    </div>
  );
}

function PolicyPopover({ meta, onRefreshed }: { meta: MetaResponse; onRefreshed: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`규정 기준일 ${meta.policyAsOf} 출처 보기`}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-7 items-center gap-1.5 rounded-full bg-surface-3 px-2.5 text-[11.5px] font-medium whitespace-nowrap text-ink-2 hover:bg-line focus-visible:outline-2 focus-visible:outline-brand-500"
      >
        <BookOpen className="size-3.5" aria-hidden />
        <span className="hidden sm:inline">규정 기준일</span> <span className="tnum">{meta.policyAsOf}</span>
      </button>
      {open ? (
        <div role="dialog" aria-label="규정 출처" className="absolute top-9 right-0 z-[70] w-[min(400px,92vw)] rounded-card bg-surface p-3 shadow-pop">
          <LoanInfoBlock info={meta.loanInfo} onRefreshed={onRefreshed} />
          <p className="mb-2 px-1 text-xs text-ink-3">대출·세금 계산에 반영한 규정과 출처입니다.</p>
          <ul className="scroll-thin max-h-80 space-y-0.5 overflow-y-auto">
            {meta.sources.map((s) => (
              <li key={s.url}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-2 rounded-control px-2 py-1.5 text-[12.5px] text-ink hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-brand-500"
                >
                  <ExternalLink className="mt-0.5 size-3 shrink-0 text-ink-4" aria-hidden />
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export default function AppHeader({
  meta,
  realData,
  onImport,
  onSettingsChanged,
}: {
  meta: MetaResponse | null;
  realData: { complexes: number; units: number };
  onImport: () => void;
  onSettingsChanged: () => void;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
      <div className="flex min-w-0 items-baseline gap-3">
        <h1 className="flex shrink-0 items-center gap-1.5 text-lg font-black tracking-tight text-ink">
          <span aria-hidden className="grid size-6 place-items-center rounded-[7px] bg-brand-600 text-[13px] font-black text-white">
            실
          </span>
          실입주
        </h1>
        <p className="hidden truncate text-xs text-ink-3 md:block">세안고 걸러낸 진짜 실입주 매물 · 대출·통근까지 한 번에</p>
      </div>
      {meta ? (
        <div className="ml-auto flex items-center gap-1.5">
          <div className="hidden items-center gap-1.5 lg:flex">
            <ProviderChip name="TMAP" on={meta.providers.tmap} offLabel="미연결(추정)" />
            <ProviderChip name="카카오" on={meta.providers.kakao} offLabel="미연결(내장 장소)" />
            <ProviderChip name="실거래가" on={meta.providers.molit} offLabel="미연결(샘플)" />
            <span className="hidden xl:inline-flex">
              <ProviderChip name="공시 금리" on={meta.loanInfo !== null} offLabel="미수집(기본값)" />
            </span>
          </div>
          <PolicyPopover meta={meta} onRefreshed={onSettingsChanged} />
          <span
            className={cx(
              "hidden h-7 items-center rounded-full px-2.5 text-[11.5px] font-semibold whitespace-nowrap tnum sm:inline-flex",
              realData.units > 0 ? "bg-movein-soft text-movein" : "bg-surface-3 text-ink-3",
            )}
          >
            실매물 {realData.complexes}개 단지 · {realData.units}개
          </span>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-haspopup="dialog"
            aria-label="API 설정"
            className="inline-flex h-8 items-center gap-1.5 rounded-control bg-surface-3 px-2.5 text-xs font-semibold whitespace-nowrap text-ink-2 hover:bg-line focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
          >
            <Settings className="size-3.5" aria-hidden />
            <span className="hidden sm:inline lg:hidden xl:inline">API 설정</span>
          </button>
          <button
            type="button"
            onClick={onImport}
            className="inline-flex h-8 items-center gap-1.5 rounded-control bg-ink px-3 text-xs font-semibold whitespace-nowrap text-white hover:bg-ink-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
          >
            <FileUp className="size-3.5" aria-hidden />
            <span className="sm:hidden">수집</span>
            <span className="hidden sm:inline">실매물 수집</span>
          </button>
        </div>
      ) : null}
      {settingsOpen ? <SettingsModal onClose={() => setSettingsOpen(false)} onChanged={onSettingsChanged} /> : null}
    </header>
  );
}
