"use client";
// 통근 경로 구간(도보·노선·환승)을 노선색 칩으로 보여주는 컴포넌트
import type { CSSProperties } from "react";
import { ArrowRight, Bus, Car, Footprints, Repeat, TrainFront } from "lucide-react";
import type { CommuteLeg, CommuteLegMode } from "@/lib/types";
import { cx } from "./ui";

const ICON: Record<CommuteLegMode, typeof Bus> = {
  WALK: Footprints,
  SUBWAY: TrainFront,
  TRAIN: TrainFront,
  BUS: Bus,
  CAR: Car,
  TRANSFER: Repeat,
};

export function legTint(color: string | null): CSSProperties | undefined {
  if (!color) return undefined;
  return { backgroundColor: `color-mix(in srgb, ${color} 13%, white)` };
}

export function LegChip({ leg }: { leg: CommuteLeg }) {
  const Icon = ICON[leg.mode];
  const muted = leg.mode === "WALK" || leg.mode === "TRANSFER";
  return (
    <span
      className={cx(
        "inline-flex h-[22px] max-w-[180px] items-center gap-1 rounded-[6px] px-1.5 text-[11.5px] font-medium tnum",
        muted || !leg.color ? "bg-surface-3 text-ink-3" : "text-ink",
      )}
      style={muted ? undefined : legTint(leg.color)}
      title={[leg.label, leg.from && leg.to ? `${leg.from} → ${leg.to}` : null, `${leg.minutes}분`].filter(Boolean).join(" · ")}
    >
      {leg.color && !muted ? (
        <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: leg.color }} />
      ) : (
        <Icon aria-hidden className="size-3 shrink-0" />
      )}
      <span className="truncate">{muted ? `${leg.minutes}분` : leg.label}</span>
    </span>
  );
}

export default function CommuteLegs({ legs }: { legs: CommuteLeg[] }) {
  return (
    <span className="flex flex-wrap items-center gap-0.5">
      {legs.map((leg, i) => (
        <span key={`${leg.mode}-${i}`} className="inline-flex items-center gap-0.5">
          {i > 0 ? <ArrowRight aria-hidden className="size-3 text-ink-4" /> : null}
          <LegChip leg={leg} />
        </span>
      ))}
    </span>
  );
}
