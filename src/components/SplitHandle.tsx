"use client";
// 결과 목록과 지도 사이 경계선: 마우스로 끌어 지도 폭을 바꾸고, 두 번 누르면 기본 폭으로 되돌린다
import { useRef, type PointerEvent } from "react";

const MIN_MAP = 320;
const MIN_LIST = 420;

// 손잡이의 부모는 지도 영역, 조부모는 사이드바·목록·지도가 놓인 줄이라는 배치를 전제로 지도 폭과 한계를 잰다
function measure(handle: HTMLElement): { wrapper: HTMLElement; width: number; max: number } | null {
  const wrapper = handle.parentElement;
  const row = wrapper?.parentElement;
  if (!wrapper || !row) return null;
  const asideWidth = row.querySelector(":scope > aside")?.getBoundingClientRect().width ?? 0;
  const max = Math.max(MIN_MAP, row.getBoundingClientRect().width - asideWidth - MIN_LIST);
  return { wrapper, width: wrapper.getBoundingClientRect().width, max };
}

interface Drag {
  wrapper: HTMLElement;
  startX: number;
  startWidth: number;
  max: number;
  width: number;
  moved: boolean;
}

export default function SplitHandle({ onCommit }: { onCommit: (width: number | null) => void }) {
  const drag = useRef<Drag | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const m = e.button === 0 ? measure(e.currentTarget) : null;
    if (!m) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { wrapper: m.wrapper, startX: e.clientX, startWidth: m.width, max: m.max, width: m.width, moved: false };
    document.body.style.userSelect = "none";
  };

  // 끄는 동안에는 목록 전체를 다시 그리지 않도록 CSS 변수만 바꾸고, 손을 뗄 때 한 번만 상태에 반영한다
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    d.moved = true;
    d.width = Math.round(Math.max(MIN_MAP, Math.min(d.max, d.startWidth + d.startX - e.clientX)));
    d.wrapper.style.setProperty("--map-w", `${d.width}px`);
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    document.body.style.userSelect = "";
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (d.moved) onCommit(d.width);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      title="끌어서 지도 폭 조절 · 두 번 누르면 기본 폭"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => onCommit(null)}
      className="group absolute inset-y-0 -left-1 z-10 hidden w-3 cursor-col-resize touch-none xl:block"
    >
      <span aria-hidden className="absolute inset-y-0 left-1 w-0.5 -translate-x-1/2 bg-transparent transition-colors group-hover:bg-brand-500" />
      <span
        aria-hidden
        className="absolute top-1/2 left-1 flex h-10 w-3 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-0.5 rounded-full border border-line bg-surface shadow-card group-hover:border-brand-500"
      >
        <span className="size-0.5 rounded-full bg-ink-4" />
        <span className="size-0.5 rounded-full bg-ink-4" />
        <span className="size-0.5 rounded-full bg-ink-4" />
      </span>
    </div>
  );
}
