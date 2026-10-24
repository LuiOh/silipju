"use client";
// 검색 결과 요약: 단계별 걸러진 수, 세안고 포함/실입주 최저가 비교, 데이터 출처(실매물/샘플) 안내와 빈 결과 다음 행동
import type { ReactNode } from "react";
import { AlertTriangle, ArrowRight, Database, Info, PlusCircle } from "lucide-react";
import type { SearchResponse } from "@/lib/types";
import { formatWon } from "@/lib/format";
import { cx } from "./ui";

function Stat({ label, value, tone }: { label: string; value: number; tone?: "seango" | "muted" }) {
  return (
    <div className="min-w-0 rounded-control bg-surface px-2.5 py-1.5">
      <dt className="truncate text-[11px] text-ink-3">{label}</dt>
      <dd className={cx("text-[15px] font-bold tnum", tone === "seango" ? "text-seango" : tone === "muted" ? "text-ink-3" : "text-ink")}>
        {value.toLocaleString("ko-KR")}
      </dd>
    </div>
  );
}

function ActionButton({ onClick, children, primary }: { onClick: () => void; children: ReactNode; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "inline-flex h-8 items-center gap-1.5 rounded-control px-3 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
        primary ? "bg-brand-600 text-white hover:bg-brand-700" : "bg-surface-3 text-ink hover:bg-line",
      )}
    >
      {children}
    </button>
  );
}

export default function ResultsHeader({
  response,
  onOpenCollect,
  onRelaxFilters,
  onIncludeDemo,
}: {
  response: SearchResponse;
  onOpenCollect: () => void;
  onRelaxFilters: () => void;
  onIncludeDemo: (include: boolean) => void;
}) {
  const s = response.stats;
  const ds = response.dataSources;
  const diff = s.lowestPriceAll !== null && s.lowestPriceMoveIn !== null ? s.lowestPriceMoveIn - s.lowestPriceAll : null;
  const empty = response.items.length === 0;

  return (
    <div className="space-y-2.5">
      <dl className="grid grid-cols-3 gap-1.5 rounded-card bg-surface-3 p-1.5 sm:grid-cols-6">
        <Stat label="기본조건 일치" value={s.matchedBasic} />
        <Stat label="세안고 판정" value={s.seangoDetected} tone="seango" />
        <Stat label="세안고 제외" value={s.seangoExcluded} tone="muted" />
        <Stat label="통근 초과" value={s.overCommute} tone="muted" />
        <Stat label="현금 부족" value={s.unaffordable} tone="muted" />
        <Stat label="표시" value={s.returned} />
      </dl>

      {s.householdsUnknownExcluded > 0 ? (
        <p className="rounded-control bg-surface-2 px-3 py-2 text-xs leading-relaxed text-ink-3">
          세대수 정보가 아직 없는 단지의 매물 {s.householdsUnknownExcluded.toLocaleString("ko-KR")}건은 최소 세대수 조건에서 뺐습니다. &lsquo;실매물 수집&rsquo;의 &lsquo;세대수 빈 단지 채우기&rsquo;로 채울 수 있습니다.
        </p>
      ) : null}

      {!empty ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card bg-brand-900 px-4 py-3 text-white">
          <span className="text-xs font-medium text-white/70">세안고 포함 최저가</span>
          <span className="text-lg font-extrabold tnum">{formatWon(s.lowestPriceAll)}</span>
          <ArrowRight aria-hidden className="size-4 text-white/60" />
          <span className="text-xs font-medium text-white/70">실입주 최저가</span>
          <span className="text-lg font-extrabold tnum">{formatWon(s.lowestPriceMoveIn)}</span>
          {diff !== null && diff > 0 ? (
            <span className="ml-auto rounded-full bg-white/15 px-2 py-0.5 text-xs font-semibold tnum">세안고 착시 {formatWon(diff)}</span>
          ) : null}
        </div>
      ) : null}

      <div className={cx("flex flex-wrap items-center gap-2 rounded-control px-3 py-2 text-xs", ds.demo ? "bg-suspect-soft text-suspect" : "bg-movein-soft text-movein")}>
        <Database aria-hidden className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1">
          {ds.demo
            ? `샘플 데이터를 섞어 검색 중입니다. 카드에 '샘플'이 붙은 매물은 실제 매물이 아닙니다.${ds.realUnits > 0 ? ` 수집된 실매물 ${ds.importedComplexes}개 단지 ${ds.realUnits}개 매물도 함께 나옵니다.` : " 수집된 실매물은 아직 없습니다."}`
            : `실매물만 검색 중입니다. 수집된 ${ds.importedComplexes}개 단지 ${ds.realUnits}개 매물이 대상입니다.`}
        </span>
        <button
          type="button"
          onClick={() => onIncludeDemo(!ds.demo)}
          className="rounded-control bg-surface px-2 py-1 font-semibold text-ink hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-brand-500"
        >
          {ds.demo ? "실매물만 보기" : "샘플 포함"}
        </button>
        <button
          type="button"
          onClick={onOpenCollect}
          className="inline-flex items-center gap-1 rounded-control bg-surface px-2 py-1 font-semibold text-ink hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-brand-500"
        >
          <PlusCircle className="size-3.5" aria-hidden />
          실매물 수집
        </button>
      </div>

      {response.warnings.length > 0 ? (
        <ul className="space-y-1">
          {response.warnings.map((w) => (
            <li key={w} className="flex items-start gap-2 rounded-control bg-suspect-soft px-3 py-2 text-xs text-suspect">
              <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {w}
            </li>
          ))}
        </ul>
      ) : null}

      {empty ? (
        <div className="rounded-card border border-dashed border-line-strong bg-surface px-4 py-5 text-sm text-ink-2">
          <p className="flex items-start gap-2 font-semibold text-ink">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
            {!ds.demo && ds.realUnits === 0
              ? "아직 수집된 실매물이 없습니다."
              : !ds.demo
                ? `수집된 실매물 ${ds.importedComplexes}개 단지 중 조건에 맞는 매물이 없습니다.`
                : "조건에 맞는 매물이 없습니다."}
          </p>
          <p className="mt-1.5 pl-6 text-[13px] leading-relaxed text-ink-3">
            {!ds.demo && ds.realUnits === 0
              ? "상단 '실매물 수집'에서 시·구를 고르고 '오늘 매물 수집하기'를 누르면 확장프로그램이 네이버페이 부동산 지도에서 매물을 모아 옵니다. 이 화면은 수집되는 대로 다시 검색합니다."
              : !ds.demo
                ? "가격·면적·지역·통근 제한을 풀어 수집된 매물을 모두 보거나, 원하는 지역 단지를 더 수집하세요."
                : "가격·면적 범위를 넓히거나 최대 통근시간을 늘려 보세요."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2 pl-6">
            {ds.realUnits > 0 || ds.demo ? (
              <ActionButton onClick={onRelaxFilters} primary>
                가격·면적·지역·통근 제한 풀기
              </ActionButton>
            ) : null}
            <ActionButton onClick={onOpenCollect} primary={ds.realUnits === 0 && !ds.demo}>
              실매물 수집 방법
            </ActionButton>
            {!ds.demo ? <ActionButton onClick={() => onIncludeDemo(true)}>샘플로 둘러보기</ActionButton> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
