"use client";
// 지도 영역 래퍼: Leaflet을 SSR 없이 지연 로드하고 범례·지하철 토글·직장 찍기 안내를 덧씌움
import dynamic from "next/dynamic";
import { useState, type ComponentProps } from "react";
import { Crosshair, Loader2, TrainFront } from "lucide-react";
import type LeafletMapType from "./LeafletMap";
import { cx } from "./ui";

const LeafletMap = dynamic(() => import("./LeafletMap"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center bg-surface-3 text-xs text-ink-3">
      <span className="flex items-center gap-2">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        지도를 불러오는 중입니다.
      </span>
    </div>
  ),
});

export default function MapPanel(
  props: Omit<ComponentProps<typeof LeafletMapType>, "showTransit"> & { onCancelPick: () => void },
) {
  const { onCancelPick, ...mapProps } = props;
  const [showTransit, setShowTransit] = useState(true);
  return (
    <div className="relative isolate h-full w-full">
      <LeafletMap {...mapProps} showTransit={showTransit} />
      <div className={cx("absolute right-3 z-[1000]", props.pickMode ? "top-14" : "top-3")}>
        <button
          type="button"
          aria-pressed={showTransit}
          onClick={() => setShowTransit((v) => !v)}
          title={showTransit ? "지하철 노선을 숨깁니다." : "지하철 노선을 보여 줍니다."}
          className={cx(
            "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold shadow-lift transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
            showTransit ? "bg-brand-600 text-white hover:bg-brand-700" : "bg-surface text-ink-2 hover:bg-surface-2",
          )}
        >
          <TrainFront className="size-3.5" aria-hidden />
          지하철
        </button>
      </div>
      {props.pickMode ? (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-[1000] flex justify-center px-3">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-brand-900 py-1.5 pr-1.5 pl-3 text-xs font-semibold text-white shadow-pop">
            <Crosshair className="size-3.5" aria-hidden />
            지도를 클릭하면 그 위치가 직장으로 추가됩니다.
            <button
              type="button"
              onClick={onCancelPick}
              className="rounded-full bg-white/15 px-2.5 py-1 hover:bg-white/25 focus-visible:outline-2 focus-visible:outline-white"
            >
              취소
            </button>
          </div>
        </div>
      ) : null}
      <div className="pointer-events-none absolute bottom-[4.5rem] left-3 z-[1000] xl:bottom-3 rounded-control bg-surface/95 px-2.5 py-2 text-[11px] text-ink-2 shadow-lift">
        <p className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full bg-movein" />
          실입주 가능 매물이 있는 단지
        </p>
        <p className="mt-1 flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full border border-line-strong bg-surface" />
          그 외 단지(가격은 최저가)
        </p>
        <p className="mt-1 flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-[3px] bg-brand-900" />
          직장
        </p>
      </div>
    </div>
  );
}
