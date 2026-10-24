"use client";
// 같은 평형(±3㎡) 실거래가 산점도와 현재 매물 가격 기준선을 그리는 SVG 차트
import type { RealTrade } from "@/lib/types";
import { formatEokShort, formatWon } from "@/lib/format";

const W = 560;
const H = 220;
const PAD = { l: 48, r: 14, t: 14, b: 28 };

function niceStep(range: number): number {
  const raw = range / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

export default function TradeChart({ trades, listingPrice, area }: { trades: RealTrade[]; listingPrice: number; area: number }) {
  const pts = trades
    .filter((t) => Math.abs(t.exclusiveArea - area) <= 3)
    .map((t) => ({ ...t, ts: Date.parse(t.date) }))
    .filter((t) => Number.isFinite(t.ts))
    .sort((a, b) => a.ts - b.ts);

  if (pts.length === 0) {
    return <p className="rounded-control bg-surface-2 px-3 py-4 text-xs text-ink-3">전용 {area}㎡ ±3㎡ 범위의 실거래 내역이 없습니다.</p>;
  }

  const prices = [...pts.map((p) => p.price), listingPrice];
  const step = niceStep(Math.max(Math.max(...prices) - Math.min(...prices), 50_000_000));
  const yMin = Math.floor(Math.min(...prices) / step) * step;
  const yMax = Math.ceil(Math.max(...prices) / step) * step;
  const tMin = pts[0].ts;
  const tMax = pts.length > 1 ? pts[pts.length - 1].ts : tMin + 86_400_000;
  const x = (ts: number) => PAD.l + ((ts - tMin) / (tMax - tMin || 1)) * (W - PAD.l - PAD.r);
  const y = (p: number) => PAD.t + (1 - (p - yMin) / (yMax - yMin || 1)) * (H - PAD.t - PAD.b);

  const yTicks: number[] = [];
  for (let v = yMin; v <= yMax + 1; v += step) yTicks.push(v);
  const xTicks = Array.from({ length: 4 }, (_, i) => tMin + ((tMax - tMin) * i) / 3);
  const fmtDate = (ts: number) => {
    const d = new Date(ts);
    return `${String(d.getFullYear()).slice(2)}.${String(d.getMonth() + 1).padStart(2, "0")}`;
  };
  const latest = pts[pts.length - 1];
  const yListing = y(listingPrice);

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`전용 ${area}㎡ 실거래 ${pts.length}건과 현재 매물 가격 비교 차트`}>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeWidth={1} />
            <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--color-ink-3)" className="tnum">
              {formatEokShort(v)}
            </text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={i} x={x(t)} y={H - 8} textAnchor={i === 0 ? "start" : i === 3 ? "end" : "middle"} fontSize={11} fill="var(--color-ink-3)" className="tnum">
            {fmtDate(t)}
          </text>
        ))}
        <polyline
          fill="none"
          stroke="var(--color-brand-200)"
          strokeWidth={1.5}
          points={pts.map((p) => `${x(p.ts)},${y(p.price)}`).join(" ")}
        />
        {pts.map((p, i) => (
          <circle key={`${p.date}-${i}`} cx={x(p.ts)} cy={y(p.price)} r={4} fill="var(--color-brand-600)" stroke="#fff" strokeWidth={1.5}>
            <title>{`${p.date} · ${p.floor ?? "-"}층 · 전용 ${p.exclusiveArea}㎡ · ${formatWon(p.price)}`}</title>
          </circle>
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={yListing} y2={yListing} stroke="var(--color-seango)" strokeWidth={1.5} strokeDasharray="5 4" />
        <text x={W - PAD.r} y={yListing - 6} textAnchor="end" fontSize={11} fontWeight={700} fill="var(--color-seango)">
          이 매물 {formatEokShort(listingPrice)}
        </text>
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-3 text-[11.5px] text-ink-3 tnum">
        <span>거래 {pts.length}건</span>
        <span>최근 {latest.date} {formatWon(latest.price)}</span>
        <span>
          범위 {formatWon(Math.min(...pts.map((p) => p.price)))} ~ {formatWon(Math.max(...pts.map((p) => p.price)))}
        </span>
      </figcaption>
    </figure>
  );
}
