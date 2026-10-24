"use client";
// 검색 결과 매물 카드(세안고 판정·필요현금·통근·점수 요약)
import { CalendarClock } from "lucide-react";
import type { SearchResultItem } from "@/lib/types";
import { formatMinutes, formatWon, toPyeong } from "@/lib/format";
import CommuteLegs from "./CommuteLegs";
import { SEANGO_STATUS, SOURCE_BADGE } from "./labels";
import { Badge, cx } from "./ui";

const CURRENT_YEAR = new Date().getFullYear();

export function unitTitle(item: SearchResultItem): string {
  const u = item.unit;
  return [u.dong ? `${u.dong}동` : null, `${u.floorLabel}층`].filter(Boolean).join(" ");
}

export function householdsLabel(c: SearchResultItem["complex"]): string | null {
  return c.households ? `${c.households.toLocaleString("ko-KR")}세대` : null;
}

export function ageLabel(c: SearchResultItem["complex"], withYear = false): string | null {
  if (c.approvalYear === null) return null;
  const age = CURRENT_YEAR - c.approvalYear;
  const short = age <= 0 ? "신축" : `${age}년차`;
  return withYear ? `${c.approvalYear}년 준공(${short})` : short;
}

export function SeangoBadge({ status }: { status: SearchResultItem["seango"]["status"] }) {
  const s = SEANGO_STATUS[status];
  return (
    <Badge className={s.badge}>
      <span aria-hidden className={cx("size-1.5 rounded-full", s.dot)} />
      {s.label}
    </Badge>
  );
}

export function CashGap({ gap }: { gap: number }) {
  return (
    <span className={cx("font-semibold tnum", gap >= 0 ? "text-movein" : "text-seango")}>
      {gap >= 0 ? `+${formatWon(gap, { zero: "0원" })} 여유` : `−${formatWon(-gap)} 부족`}
    </span>
  );
}

export default function ResultCard({
  item,
  selected,
  highlighted,
  onSelect,
}: {
  item: SearchResultItem;
  selected: boolean;
  highlighted: boolean;
  onSelect: () => void;
}) {
  const { unit, complex, seango, finance, score, peers } = item;
  const area = unit.exclusiveArea;
  const best = finance.best;
  const otherQuotes = finance.quotes.filter((q) => q.product !== best?.product);
  const households = householdsLabel(complex);
  const age = ageLabel(complex);

  return (
    <article
      data-complex={complex.id}
      data-unit={unit.id}
      className={cx(
        "group relative rounded-card border bg-surface p-3.5 shadow-card transition-shadow hover:shadow-lift",
        selected ? "border-brand-200 bg-brand-50" : highlighted ? "border-line-strong bg-surface-2" : "border-line",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-label={`${complex.name} ${unitTitle(item)} 상세 보기`}
        aria-pressed={selected}
        className="absolute inset-0 z-0 rounded-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
      />
      <div className="pointer-events-none relative">
        <header className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="truncate text-[15px] font-bold text-ink">{complex.name}</h3>
              <Badge className="bg-surface-3 text-ink-3">{SOURCE_BADGE[complex.source]}</Badge>
              <span className="text-xs whitespace-nowrap tnum">
                {households ? <b className="font-semibold text-ink-2">{households}</b> : <span className="text-ink-4">세대수 미확인</span>}
                {age ? <span className="text-ink-3"> · {age}</span> : null}
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-ink-3 tnum">
              {complex.region.sigungu} · {unitTitle(item)} · 전용 {area}㎡({toPyeong(area).toFixed(1)}평) · 방 {unit.roomCount}
            </p>
          </div>
          <SeangoBadge status={seango.status} />
        </header>

        <div className="mt-3 grid grid-cols-[1fr_auto] items-end gap-3">
          <div>
            <p className="text-[22px] leading-none font-extrabold tracking-tight text-ink tnum">{formatWon(unit.price)}</p>
            <p className="mt-1 text-xs text-ink-3 tnum">평당 {formatWon(item.pricePerPyeong)}</p>
          </div>
          <div className="rounded-control bg-surface-3 px-3 py-2 text-right">
            <p className="text-[11px] font-medium text-ink-3">필요 현금</p>
            <p className="text-lg leading-tight font-extrabold text-ink tnum">{formatWon(finance.requiredCash)}</p>
            <p className="text-[11.5px] tnum">
              <CashGap gap={finance.cashGap} />
            </p>
          </div>
        </div>
        <p className="mt-1.5 text-xs text-ink-2 tnum">
          {best ? (
            <>
              {best.productName} 최대 <b className="font-semibold text-ink">{formatWon(best.maxLoan)}</b> · 월 {formatWon(best.monthlyPayment)}
            </>
          ) : (
            <span className="text-seango">이용 가능한 대출이 없어 전액 현금 기준입니다.</span>
          )}
        </p>
        {otherQuotes.length > 0 ? (
          <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-ink-3 tnum">
            {otherQuotes
              .map((q) => (q.eligible && q.maxLoan > 0 ? `${q.productName} ${formatWon(q.maxLoan)}` : `${q.productName} 불가(${q.reasons[0] ?? "조건 미충족"})`))
              .join(" · ")}
          </p>
        ) : null}

        <p className={cx("mt-2.5 text-xs", SEANGO_STATUS[seango.status].text)}>
          {seango.summary}
          {seango.moveInFrom ? (
            <span className="ml-1.5 inline-flex items-center gap-1 text-ink-2">
              <CalendarClock aria-hidden className="size-3.5" />
              {seango.moveInFrom} 입주 가능
            </span>
          ) : null}
        </p>

        {item.commutes.length > 0 ? (
          <ul className="mt-2.5 space-y-1.5 border-t border-line pt-2.5">
            {item.commutes.map((r) => (
              <li key={r.workplaceId} className="flex flex-wrap items-start gap-x-2 gap-y-1 text-xs">
                <span className="w-[86px] shrink-0 truncate pt-0.5 text-ink-3" title={r.workplaceLabel}>
                  {r.workplaceLabel}
                </span>
                <span className="w-14 shrink-0 pt-0.5 font-bold text-ink tnum">{formatMinutes(r.minutes)}</span>
                <span className="order-last w-full min-w-0 sm:order-none sm:w-auto sm:flex-1">
                  <CommuteLegs legs={r.legs} />
                </span>
                <span className="ml-auto shrink-0 pt-0.5 text-[11px] text-ink-4">
                  {r.transfers !== null ? `환승 ${r.transfers} · ` : ""}
                  {r.source === "tmap" ? "TMAP" : "추정"}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <footer className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2.5 text-[11.5px] text-ink-3 tnum">
          <span className="inline-flex items-center gap-1.5">
            <span className="font-medium text-ink-2">종합</span>
            <span className="text-sm font-extrabold text-brand-700">{score.total.toFixed(1)}</span>
          </span>
          <span className="hidden gap-2 sm:flex">
            {score.parts
              .filter((p) => p.weight > 0)
              .sort((a, b) => b.weight - a.weight)
              .slice(0, 4)
              .map((p) => (
                <span key={p.key} className="inline-flex items-center gap-1" title={p.detail}>
                  {p.label}
                  <span className="relative h-1 w-8 overflow-hidden rounded-full bg-line">
                    <span className="absolute inset-y-0 left-0 rounded-full bg-brand-500" style={{ width: `${Math.round(p.score * 100)}%` }} />
                  </span>
                </span>
              ))}
          </span>
          <span className="ml-auto">
            같은 단지·평형 최저가 전체 {formatWon(peers.lowestAll)} / 실입주 {formatWon(peers.lowestMoveIn)}
          </span>
        </footer>
      </div>
    </article>
  );
}
