"use client";
// 실매물 수집 모달: 지역 자동 수집(확장프로그램), 수집된 단지 목록(자동 갱신), 파일(JSON/HAR) 가져오기, 초기화
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { FileUp, Loader2, RefreshCw, Trash2, X } from "lucide-react";
import type { CollectedComplex, ImportResult } from "@/lib/types";
import { formatWon } from "@/lib/format";
import { api, errorMessage, isAbort } from "./api";
import AutoCollect from "./AutoCollect";
import { cx } from "./ui";

const POLL_MS = 4000;

function timeAgo(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h}시간 전` : `${Math.round(h / 24)}일 전`;
}

export default function ImportModal({
  onClose,
  onChanged,
  extensionPath,
}: {
  onClose: () => void;
  onChanged: () => void;
  extensionPath: string;
}) {
  const [busy, setBusy] = useState<"import" | "clear" | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cleared, setCleared] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [collected, setCollected] = useState<CollectedComplex[] | null>(null);
  const [total, setTotal] = useState<{ complexes: number; units: number } | null>(null);
  const [refreshSeq, setRefreshSeq] = useState(0);
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

  const applyCollected = useEffectEvent((r: { items: CollectedComplex[]; total: { complexes: number; units: number } }) => {
    setCollected(r.items);
    setTotal(r.total);
  });
  const failCollected = useEffectEvent((e: unknown) => setError(errorMessage(e)));

  useEffect(() => {
    const ctrl = new AbortController();
    const tick = () => {
      api
        .collected(ctrl.signal)
        .then(applyCollected)
        .catch((e: unknown) => {
          if (!isAbort(e)) failCollected(e);
        });
    };
    tick();
    const t = window.setInterval(tick, POLL_MS);
    return () => {
      window.clearInterval(t);
      ctrl.abort();
    };
  }, [refreshSeq]);

  const refresh = () => setRefreshSeq((n) => n + 1);

  const upload = async (file: File) => {
    setBusy("import");
    setError(null);
    setResult(null);
    setCleared(false);
    setFileName(file.name);
    try {
      const r = await api.importFile(await file.text());
      setResult(r);
      refresh();
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const clear = async () => {
    setBusy("clear");
    setError(null);
    setResult(null);
    try {
      await api.clearImport();
      setCleared(true);
      refresh();
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

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
            실매물 수집
          </h2>
          {total ? (
            <span className="rounded-full bg-movein-soft px-2 py-0.5 text-xs font-semibold text-movein tnum">
              {total.complexes}개 단지 · {total.units}개 매물
            </span>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="ml-auto grid size-8 place-items-center rounded-control text-ink-3 hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-brand-500"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <div className="scroll-thin min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4 text-[13px] text-ink-2">
          <section aria-labelledby={`${titleId}-ext`}>
            <h3 id={`${titleId}-ext`} className="mb-2 text-sm font-bold text-ink">
              1. 오늘 매물 자동 수집(추천)
            </h3>
            <AutoCollect extensionPath={extensionPath} />
            <p className="mt-3 text-xs leading-relaxed text-ink-3">
              특정 지역만 필터를 걸어 받고 싶으면{" "}
              <a
                href="https://fin.land.naver.com/map?tradeTypes=A1&realEstateTypes=A01"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-brand-700 underline underline-offset-2"
              >
                네이버페이 부동산 지도
              </a>
              에서 필터를 건 뒤 오른쪽 아래 &lsquo;실입주 수집기&rsquo; 패널의 &lsquo;실입주로 가져오기&rsquo;를 누르세요. 관심 매물의 상세를 열면 입주가능일·기보증금까지 저장되어 세안고 판별이 더 정확해집니다.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-ink-3">
              확장프로그램은 네이버 API를 직접 부르지 않고, 지도와 목록이 받은 응답만 이 컴퓨터의 앱으로 보냅니다. 칸마다 몇 초, 목록은 쪽마다 1~2초씩 쉬며 진행하고 네이버가 요청을 막으면(429) 바로 멈춥니다. 네이버 이용약관은 자동 수집을 금지하므로 본인 확인용으로 하루 한 번 정도만 쓰세요.
            </p>
          </section>

          <section aria-labelledby={`${titleId}-list`}>
            <div className="mb-2 flex items-center gap-2">
              <h3 id={`${titleId}-list`} className="text-sm font-bold text-ink">
                2. 수집된 실매물
              </h3>
              <span className="text-xs text-ink-4">이 창을 열어 두면 {POLL_MS / 1000}초마다 새로 고칩니다.</span>
              <button
                type="button"
                onClick={refresh}
                aria-label="수집 목록 새로 고침"
                className="ml-auto grid size-7 place-items-center rounded-control text-ink-3 hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-brand-500"
              >
                <RefreshCw className="size-3.5" aria-hidden />
              </button>
            </div>
            {collected === null ? (
              <p className="flex items-center gap-2 text-xs text-ink-3">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                불러오는 중입니다.
              </p>
            ) : collected.length === 0 ? (
              <p className="rounded-control bg-surface-2 px-3 py-3 text-xs text-ink-3">아직 수집된 단지가 없습니다. 위 방법으로 가져오면 여기에 나타납니다.</p>
            ) : (
              <ul className="scroll-thin max-h-56 divide-y divide-line overflow-y-auto rounded-control border border-line">
                {collected.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-ink">{c.name}</p>
                      <p className="text-xs text-ink-3">{c.sigungu}</p>
                    </div>
                    <div className="text-right text-xs tnum">
                      <p className="font-semibold text-ink">매물 {c.units}개</p>
                      <p className="text-ink-3">
                        {formatWon(c.minPrice)} ~ {formatWon(c.maxPrice)}
                      </p>
                    </div>
                    <span className="w-14 shrink-0 text-right text-[11px] text-ink-4">{timeAgo(c.lastSeenAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby={`${titleId}-file`}>
            <h3 id={`${titleId}-file`} className="mb-2 text-sm font-bold text-ink">
              3. 파일로 가져오기
            </h3>
            <p className="mb-2 text-xs leading-relaxed text-ink-3">
              개발자도구 Network 탭에서 저장한 complex/article/list 응답(JSON)이나 HAR 파일을 올립니다. 파일이 많으면 .data/inbox 폴더에 넣고 터미널에서 npm run batch -- ingest를 실행해도 됩니다.
            </p>
            <label
              className={cx(
                "flex cursor-pointer flex-col items-center gap-1.5 rounded-card border border-dashed border-line-strong bg-surface-2 px-4 py-4 text-center hover:bg-surface-3 focus-within:outline-2 focus-within:outline-brand-500",
                busy && "pointer-events-none opacity-60",
              )}
            >
              {busy === "import" ? <Loader2 className="size-5 animate-spin text-brand-600" aria-hidden /> : <FileUp className="size-5 text-brand-600" aria-hidden />}
              <span className="font-semibold text-ink">{busy === "import" ? `${fileName ?? "파일"} 분석 중` : "파일 선택(.json, .har)"}</span>
              <input
                type="file"
                accept=".json,.har,application/json"
                className="sr-only"
                disabled={busy !== null}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                  e.target.value = "";
                }}
              />
            </label>
          </section>

          <div aria-live="polite" className="space-y-2">
            {error ? <p className="rounded-control bg-seango-soft px-3 py-2 text-xs text-seango">{error}</p> : null}
            {cleared ? <p className="rounded-control bg-movein-soft px-3 py-2 text-xs text-movein">수집한 실매물을 모두 지웠습니다.</p> : null}
            {result ? (
              <div className={cx("rounded-control px-3 py-2.5 text-xs", result.units > 0 ? "bg-movein-soft text-movein" : "bg-seango-soft text-seango")}>
                <p className="font-semibold">
                  {result.units > 0 ? `${fileName ?? "파일"}을 반영했습니다. 지금 실매물은 ${result.complexes}개 단지 ${result.units}개 매물입니다.` : "가져올 수 있는 매매 매물이 없습니다."}
                </p>
                {result.warnings.length > 0 ? (
                  <ul className="scroll-thin mt-1.5 max-h-24 list-disc space-y-0.5 overflow-y-auto pl-4 text-[11.5px] text-ink-2">
                    {result.warnings.map((w, i) => (
                      <li key={`${i}-${w}`}>{w}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-line px-5 py-3">
          <button
            type="button"
            onClick={() => void clear()}
            disabled={busy !== null || (total?.units ?? 0) === 0}
            className="inline-flex h-9 items-center gap-1.5 rounded-control px-3 text-[13px] font-medium text-seango hover:bg-seango-soft focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-40"
          >
            {busy === "clear" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
            수집한 실매물 지우기
          </button>
          <button
            type="button"
            onClick={() => {
              onChanged();
              onClose();
            }}
            className="ml-auto h-9 rounded-control bg-ink px-4 text-[13px] font-semibold text-white hover:bg-ink-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
          >
            닫고 다시 검색
          </button>
        </div>
      </div>
    </div>
  );
}
