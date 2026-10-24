"use client";
// 매물 설명 텍스트에서 세안고·실입주 단서 구간을 색으로 강조해 렌더링
import type { ReactNode } from "react";
import { highlightRanges } from "@/lib/seango/rules";

export default function Highlight({ text }: { text: string }) {
  const ranges = highlightRanges(text);
  const out: ReactNode[] = [];
  let cursor = 0;
  for (const r of ranges) {
    const start = Math.max(r.start, cursor);
    if (r.end <= start) continue;
    if (start > cursor) out.push(text.slice(cursor, start));
    out.push(
      <mark
        key={`${start}-${r.end}`}
        className={
          r.kind === "seango"
            ? "rounded-[3px] bg-seango-soft px-0.5 font-semibold text-seango"
            : "rounded-[3px] bg-movein-soft px-0.5 font-semibold text-movein"
        }
      >
        {text.slice(start, r.end)}
      </mark>,
    );
    cursor = r.end;
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  return <>{out}</>;
}
