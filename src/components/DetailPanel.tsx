"use client";
// 매물 상세 패널: 세안고 근거, 필요 현금 내역·대출 견적, 통근 경로, 실거래가 차트, AI 동네 브리핑·주변 학교, 점수 내역
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { ExternalLink, Loader2, Navigation, RefreshCw, School, Smartphone, Sparkles, X } from "lucide-react";
import type {
  BriefConfidence,
  BriefLink,
  CommuteRoute,
  ComplexBriefResponse,
  ComplexDetail,
  LoanQuote,
  NearbySchool,
  NeighborhoodBrief,
  SearchResultItem,
  Workplace,
} from "@/lib/types";
import { formatMinutes, formatWon, toPyeong } from "@/lib/format";
import { api, errorMessage, isAbort } from "./api";
import CommuteLegs from "./CommuteLegs";
import Highlight from "./Highlight";
import { LEG_MODE, LIMITING_FACTOR, MOVING_IN } from "./labels";
import { CashGap, SeangoBadge, ageLabel, householdsLabel, unitTitle } from "./ResultCard";
import TradeChart from "./TradeChart";
import { Badge, cx } from "./ui";

const naverArticleUrl = (articleNo: string) => `https://fin.land.naver.com/articles/${articleNo}`;

function Block({ id, title, children, aside }: { id: string; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-14 border-b border-line px-5 py-5">
      <div className="mb-3 flex items-center gap-2">
        <h3 id={`${id}-h`} className="text-[15px] font-bold text-ink">
          {title}
        </h3>
        {aside ? <div className="ml-auto">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

function SeangoSection({ item }: { item: SearchResultItem }) {
  const { seango, unit } = item;
  return (
    <Block id="d-seango" title="세안고 근거" aside={<SeangoBadge status={seango.status} />}>
      <p className="text-[13px] text-ink-2">{seango.summary}</p>
      <dl className="mt-2 grid grid-cols-2 gap-1.5 text-xs sm:grid-cols-4 tnum">
        <div className="rounded-control bg-surface-2 px-2.5 py-1.5">
          <dt className="text-ink-3">세안고 확률</dt>
          <dd className="font-bold text-ink">{Math.round(seango.probability * 100)}%</dd>
        </div>
        <div className="rounded-control bg-surface-2 px-2.5 py-1.5">
          <dt className="text-ink-3">광고 중개사</dt>
          <dd className="font-bold text-ink">{seango.totalAds}곳</dd>
        </div>
        <div className="rounded-control bg-surface-2 px-2.5 py-1.5">
          <dt className="text-ink-3">세안고 언급</dt>
          <dd className="font-bold text-seango">{seango.explicitAds}곳</dd>
        </div>
        <div className="rounded-control bg-surface-2 px-2.5 py-1.5">
          <dt className="text-ink-3">실입주 언급</dt>
          <dd className="font-bold text-movein">{seango.moveInAds}곳</dd>
        </div>
      </dl>
      {seango.depositEstimate !== null || seango.moveInFrom ? (
        <p className="mt-2 text-xs text-ink-2 tnum">
          {seango.depositEstimate !== null ? `승계 보증금 추정 ${formatWon(seango.depositEstimate)}. ` : ""}
          {seango.moveInFrom ? `입주 가능 시기 ${seango.moveInFrom}.` : ""}
        </p>
      ) : null}
      <p className="mt-3 rounded-control bg-surface-2 px-3 py-2 text-[12px] leading-relaxed text-ink-2">
        네이버 매물 데이터에서 세안고는 대부분 자유 텍스트로만 적히고, 같은 호실을 올린 여러 중개사 중 일부만 언급합니다. 그래서 같은 호실 광고를 묶어 근거를 합산합니다.
      </p>

      <h4 className="mt-4 mb-2 text-xs font-semibold text-ink-2">판정 근거</h4>
      {seango.evidence.length === 0 ? (
        <p className="text-xs text-ink-3">세안고나 실입주를 가리키는 단서를 찾지 못했습니다.</p>
      ) : (
        <ul className="space-y-1.5">
          {seango.evidence.map((ev, i) => {
            const up = ev.weight > 0;
            const flat = ev.weight === 0;
            return (
              <li key={`${ev.kind}-${i}`} className="rounded-control border border-line bg-surface px-3 py-2">
                <div className="flex items-start gap-2 text-[13px]">
                  <span
                    className={cx("mt-px shrink-0 text-xs font-bold tnum", flat ? "text-ink-4" : up ? "text-seango" : "text-movein")}
                    aria-label={flat ? "참고" : up ? "세안고 쪽 근거" : "실입주 쪽 근거"}
                  >
                    {flat ? "·" : up ? "▲" : "▼"} {flat ? "" : Math.abs(ev.weight).toFixed(1)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-ink">{ev.label}</span>
                    <span className="block text-[11.5px] text-ink-3">{ev.source}</span>
                    {ev.snippet ? (
                      <span className="mt-1 block text-[12.5px] leading-relaxed text-ink-2">
                        <Highlight text={ev.snippet.trim()} />
                      </span>
                    ) : null}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <h4 className="mt-4 mb-2 text-xs font-semibold text-ink-2">같은 호실 중개사 광고 {unit.ads.length}건</h4>
      <ul className="divide-y divide-line rounded-control border border-line bg-surface">
        {unit.ads.map((ad) => (
          <li key={ad.articleNo} className="px-3 py-2">
            <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
              <span className="font-semibold text-ink">{ad.realtorName}</span>
              {ad.cpName ? <span className="text-ink-4">{ad.cpName}</span> : null}
              {ad.confirmedAt ? <span className="ml-auto text-ink-4 tnum">확인 {ad.confirmedAt}</span> : null}
              {/^\d+$/.test(ad.articleNo) ? (
                <a
                  href={naverArticleUrl(ad.articleNo)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cx("inline-flex items-center gap-0.5 font-semibold text-brand-700 hover:underline", !ad.confirmedAt && "ml-auto")}
                >
                  네이버에서 보기
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              ) : null}
            </div>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-2">
              <Highlight text={ad.featureText} />
            </p>
            {ad.description ? (
              <p className="mt-1 text-[12px] leading-relaxed whitespace-pre-line text-ink-3">
                <Highlight text={ad.description} />
              </p>
            ) : null}
            {ad.movingIn || ad.previousDeposit !== null || ad.isLeaseHold !== null ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {ad.movingIn ? (
                  <Badge className="bg-surface-3 text-ink-2">
                    입주 {ad.movingIn.type ? MOVING_IN[ad.movingIn.type] : "미기재"}
                    {ad.movingIn.date ? ` ${ad.movingIn.date}` : ""}
                    {ad.movingIn.negotiable ? " · 협의 가능" : ""}
                  </Badge>
                ) : null}
                {ad.previousDeposit !== null ? (
                  <Badge className="bg-seango-soft text-seango">기보증금 {formatWon(ad.previousDeposit)}</Badge>
                ) : null}
                {ad.isLeaseHold !== null ? (
                  <Badge className={ad.isLeaseHold ? "bg-seango-soft text-seango" : "bg-movein-soft text-movein"}>
                    {ad.isLeaseHold ? "임대 승계 표시" : "승계 없음 표시"}
                  </Badge>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Block>
  );
}

function QuoteCard({ q, best }: { q: LoanQuote; best: boolean }) {
  return (
    <li className={cx("rounded-control border px-3 py-2.5", best ? "border-brand-200 bg-brand-50" : "border-line bg-surface")}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[13px] font-bold text-ink">{q.productName}</span>
        {best ? <Badge className="bg-brand-600 text-white">적용</Badge> : null}
        {q.eligible ? (
          <Badge className="bg-surface-3 text-ink-2">한도 결정 {LIMITING_FACTOR[q.limitingFactor]}</Badge>
        ) : (
          <Badge className="bg-seango-soft text-seango">불가</Badge>
        )}
        <span className="ml-auto text-sm font-extrabold text-ink tnum">{q.eligible ? formatWon(q.maxLoan) : "-"}</span>
      </div>
      {q.eligible ? (
        <>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs tnum sm:grid-cols-3">
            <div>
              <dt className="text-ink-3">LTV {Math.round(q.ltvRate * 100)}%</dt>
              <dd className="font-semibold text-ink">{formatWon(q.ltvAmount)}</dd>
            </div>
            <div>
              <dt className="text-ink-3">방공제</dt>
              <dd className="font-semibold text-ink">{q.roomDeduction > 0 ? `−${formatWon(q.roomDeduction)}` : "없음"}</dd>
            </div>
            <div>
              <dt className="text-ink-3">상한</dt>
              <dd className="font-semibold text-ink">{q.capAmount !== null ? formatWon(q.capAmount) : "-"}</dd>
            </div>
            <div>
              <dt className="text-ink-3">소득 기준 한도</dt>
              <dd className="font-semibold text-ink">{q.incomeLimitAmount !== null ? formatWon(q.incomeLimitAmount) : "-"}</dd>
            </div>
            <div>
              <dt className="text-ink-3">금리(스트레스)</dt>
              <dd className="font-semibold text-ink">
                {q.rate}% (+{q.stressRate}%p)
              </dd>
            </div>
            <div>
              <dt className="text-ink-3">월 상환 {q.termYears}년</dt>
              <dd className="font-semibold text-ink">{formatWon(q.monthlyPayment)}</dd>
            </div>
          </dl>
          {q.notes.length > 0 ? (
            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11.5px] leading-snug text-ink-3">
              {q.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[12px] text-seango">
          {q.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

function CashSection({ item, cash }: { item: SearchResultItem; cash: number }) {
  const f = item.finance;
  const c = f.costs;
  const loan = f.best?.maxLoan ?? 0;
  const rows: [string, number][] = [
    ["취득세", c.acquisitionTax],
    ["생애최초·출산 감면", -c.taxRelief],
    ["지방교육세", c.localEducationTax],
    ["농어촌특별세", c.ruralSpecialTax],
    ["중개보수(VAT 포함)", c.brokerageFee],
    ["법무사", c.legalFee],
    ["국민주택채권 할인", c.bondCost],
    ["인지세", c.stampDuty],
  ];
  return (
    <Block id="d-cash" title="필요 현금 내역">
      <div className="rounded-card bg-brand-900 px-4 py-3 text-white">
        <p className="text-xs text-white/70">필요 현금</p>
        <p className="text-2xl font-extrabold tnum">{formatWon(f.requiredCash)}</p>
        <p className="mt-1 text-[12px] text-white/80 tnum">
          매매가 {formatWon(f.price)} + 부대비용 {formatWon(c.total)} − 대출 {formatWon(loan)} = 필요현금 {formatWon(f.requiredCash)}
        </p>
        <p className="mt-1 text-[12px] tnum">
          보유 현금 {formatWon(cash)} 기준 <span className="rounded bg-white px-1.5 py-0.5"><CashGap gap={f.cashGap} /></span>
        </p>
      </div>
      {f.seangoCash !== null ? (
        <p className="mt-2 rounded-control bg-seango-soft px-3 py-2 text-xs text-seango tnum">
          세안고로 매수 시(보증금 승계) 필요 현금 <b className="font-bold">{formatWon(f.seangoCash)}</b>. 대출 없이 보증금을 떠안는 대신 바로 입주할 수 없습니다.
        </p>
      ) : null}
      <table className="mt-3 w-full text-[13px] tnum">
        <caption className="sr-only">부대비용 내역</caption>
        <tbody className="divide-y divide-line">
          {rows.map(([label, v]) => (
            <tr key={label}>
              <th scope="row" className="py-1.5 text-left font-normal text-ink-2">
                {label}
              </th>
              <td className={cx("py-1.5 text-right", v < 0 ? "text-movein" : "text-ink")}>
                {v < 0 ? `−${formatWon(-v)}` : formatWon(v, { zero: "0원" })}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line-strong">
            <th scope="row" className="pt-2 text-left font-bold text-ink">
              합계
            </th>
            <td className="pt-2 text-right font-bold text-ink">{formatWon(c.total)}</td>
          </tr>
        </tfoot>
      </table>
      <h4 className="mt-4 mb-2 text-xs font-semibold text-ink-2">대출 견적</h4>
      {f.quotes.length === 0 ? (
        <p className="text-xs text-ink-3">선택한 대출 상품이 없습니다.</p>
      ) : (
        <ul className="space-y-2">
          {f.quotes.map((q) => (
            <QuoteCard key={q.product} q={q} best={f.best?.product === q.product} />
          ))}
        </ul>
      )}
    </Block>
  );
}

type PreciseState = { loading: boolean; error: string | null; route: CommuteRoute | null; notice: string | null };

function RouteLinks({ route }: { route: CommuteRoute }) {
  const cls =
    "inline-flex h-7 items-center gap-1 rounded-control bg-surface-3 px-2 text-[11.5px] font-medium text-ink-2 hover:bg-line focus-visible:outline-2 focus-visible:outline-brand-500";
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      <a href={route.links.kakaoWeb} target="_blank" rel="noopener noreferrer" className={cls}>
        <ExternalLink className="size-3" aria-hidden />
        카카오맵 웹
      </a>
      <a href={route.links.kakaoApp} className={cls}>
        <Smartphone className="size-3" aria-hidden />
        카카오맵 앱
      </a>
      <a href={route.links.naverApp} className={cls}>
        <Smartphone className="size-3" aria-hidden />
        네이버지도 앱
      </a>
      <a href={route.links.tmapApp} className={cls}>
        <Smartphone className="size-3" aria-hidden />
        TMAP 앱
      </a>
    </div>
  );
}

function CommuteSection({ item, workplaces }: { item: SearchResultItem; workplaces: Workplace[] }) {
  const [precise, setPrecise] = useState<Record<string, PreciseState>>({});

  const lookup = (route: CommuteRoute) => {
    const wp = workplaces.find((w) => w.id === route.workplaceId);
    if (!wp) {
      setPrecise((p) => ({ ...p, [route.workplaceId]: { loading: false, error: "검색 당시 직장 정보를 찾지 못했습니다. 다시 검색해 주세요.", route: null, notice: null } }));
      return;
    }
    setPrecise((p) => ({ ...p, [route.workplaceId]: { loading: true, error: null, route: p[route.workplaceId]?.route ?? null, notice: null } }));
    api
      .commute({ origin: item.complex.location, originName: item.complex.name, workplace: wp, mode: route.mode })
      .then((r) => setPrecise((p) => ({ ...p, [route.workplaceId]: { loading: false, error: null, route: r.route, notice: r.notice } })))
      .catch((e: unknown) =>
        setPrecise((p) => ({ ...p, [route.workplaceId]: { loading: false, error: errorMessage(e), route: p[route.workplaceId]?.route ?? null, notice: null } })),
      );
  };

  if (item.commutes.length === 0) {
    return (
      <Block id="d-commute" title="통근 경로">
        <p className="text-xs text-ink-3">직장을 추가하고 검색하면 경로가 표시됩니다.</p>
      </Block>
    );
  }

  return (
    <Block id="d-commute" title="통근 경로">
      <ul className="space-y-3">
        {item.commutes.map((base) => {
          const st = precise[base.workplaceId];
          const r = st?.route ?? base;
          return (
            <li key={base.workplaceId} className="rounded-control border border-line bg-surface p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-bold text-ink">{r.workplaceLabel}</span>
                <span className="text-base font-extrabold text-ink tnum">{formatMinutes(r.minutes)}</span>
                <Badge className={r.source === "tmap" ? "bg-brand-50 text-brand-700" : "bg-surface-3 text-ink-3"}>
                  {r.source === "tmap" ? "TMAP" : "추정"}
                </Badge>
                <span className="text-[11.5px] text-ink-3 tnum">
                  {[
                    r.transfers !== null ? `환승 ${r.transfers}회` : null,
                    r.walkMinutes !== null ? `도보 ${r.walkMinutes}분` : null,
                    r.fare !== null ? `요금 ${r.fare.toLocaleString("ko-KR")}원` : null,
                    r.distanceKm !== null ? `${r.distanceKm.toFixed(1)}km` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <button
                  type="button"
                  onClick={() => lookup(base)}
                  disabled={st?.loading}
                  className="ml-auto inline-flex h-7 items-center gap-1 rounded-control bg-brand-600 px-2.5 text-[11.5px] font-semibold text-white hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500 disabled:opacity-60"
                >
                  {st?.loading ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <Navigation className="size-3" aria-hidden />}
                  정확한 경로 조회(TMAP)
                </button>
              </div>
              <div className="mt-2">
                <CommuteLegs legs={r.legs} />
              </div>
              <ol className="mt-2.5 space-y-0">
                {r.legs.map((leg, i) => (
                  <li key={`${leg.mode}-${i}`} className="grid grid-cols-[14px_1fr_auto] gap-2 text-xs">
                    <span className="flex flex-col items-center">
                      <span
                        aria-hidden
                        className="mt-1 size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: leg.color ?? "var(--color-line-strong)" }}
                      />
                      {i < r.legs.length - 1 ? <span aria-hidden className="w-px flex-1 bg-line" /> : null}
                    </span>
                    <span className="pb-2">
                      <span className="font-medium text-ink">
                        {leg.label.startsWith(LEG_MODE[leg.mode]) ? leg.label : `${LEG_MODE[leg.mode]} · ${leg.label}`}
                      </span>
                      {leg.from || leg.to ? (
                        <span className="block text-[11.5px] text-ink-3">
                          {leg.from ?? ""}
                          {leg.from && leg.to ? " → " : ""}
                          {leg.to ?? ""}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-ink-2 tnum">{leg.minutes}분</span>
                  </li>
                ))}
              </ol>
              {st?.notice ? <p className="mt-1 rounded-control bg-suspect-soft px-2.5 py-1.5 text-[11.5px] text-suspect">{st.notice}</p> : null}
              {st?.error ? <p className="mt-1 rounded-control bg-seango-soft px-2.5 py-1.5 text-[11.5px] text-seango">{st.error}</p> : null}
              <RouteLinks route={r} />
            </li>
          );
        })}
      </ul>
    </Block>
  );
}

function TradesSection({ item }: { item: SearchResultItem }) {
  const [detail, setDetail] = useState<(ComplexDetail & { notice: string | null }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = item.complex.id;

  useEffect(() => {
    const ctrl = new AbortController();
    api
      .complex(id, ctrl.signal)
      .then(setDetail)
      .catch((e: unknown) => {
        if (!isAbort(e)) setError(errorMessage(e));
      });
    return () => ctrl.abort();
  }, [id]);

  const sourceLabel = detail ? { demo: "샘플 실거래", molit: "국토부 실거래가", none: "실거래 없음" }[detail.tradesSource] : null;
  return (
    <Block id="d-trades" title="실거래가" aside={sourceLabel ? <Badge className="bg-surface-3 text-ink-2">{sourceLabel}</Badge> : null}>
      {error ? <p className="rounded-control bg-seango-soft px-3 py-2 text-xs text-seango">{error}</p> : null}
      {!detail && !error ? (
        <p className="flex items-center gap-2 text-xs text-ink-3">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> 실거래가를 불러오는 중입니다.
        </p>
      ) : null}
      {detail ? (
        <>
          {detail.notice ? <p className="mb-2 rounded-control bg-suspect-soft px-3 py-2 text-xs text-suspect">{detail.notice}</p> : null}
          <p className="mb-2 text-xs text-ink-3">
            전용 {item.unit.exclusiveArea}㎡ ±3㎡ 거래만 표시합니다. 점선은 이 매물 호가입니다.
          </p>
          <TradeChart trades={detail.trades} listingPrice={item.unit.price} area={item.unit.exclusiveArea} />
          <p className="mt-2 text-[11.5px] text-ink-3">
            {detail.complex.address} · 매매 매물 {detail.units.length}개 호실
          </p>
        </>
      ) : null}
    </Block>
  );
}

const linkClass =
  "inline-flex items-center gap-1 rounded-control font-semibold text-brand-700 underline underline-offset-2 hover:text-brand-900 focus-visible:outline-2 focus-visible:outline-brand-500";

function OutLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cx(linkClass, className)}>
      {children}
      <ExternalLink className="size-3 shrink-0" aria-hidden />
    </a>
  );
}

const CONFIDENCE_STYLE: Record<BriefConfidence, string> = {
  확인됨: "bg-movein-soft text-movein",
  추정: "bg-suspect-soft text-suspect",
  모름: "bg-surface-3 text-ink-3",
};

const SCHOOL_KIND: Record<NearbySchool["kind"], string> = { elementary: "초", middle: "중", high: "고" };

function SchoolList({ schools, note }: { schools: NearbySchool[]; note: string | null }) {
  return (
    <>
      <h4 className="mt-4 mb-2 text-xs font-semibold text-ink-2">주변 학교(카카오 로컬, 반경 1.5km 직선거리)</h4>
      {note ? <p className="mb-2 rounded-control bg-surface-2 px-3 py-2 text-xs text-ink-3">{note}</p> : null}
      {schools.length > 0 ? (
        <ul className="divide-y divide-line rounded-control border border-line bg-surface">
          {schools.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-2 text-[13px]">
              <Badge className={s.kind === "elementary" ? "bg-brand-50 text-brand-700" : "bg-surface-3 text-ink-2"}>{SCHOOL_KIND[s.kind]}</Badge>
              {s.url ? (
                <OutLink href={s.url} className="min-w-0 text-[13px]">
                  {s.name}
                </OutLink>
              ) : (
                <span className="font-medium text-ink">{s.name}</span>
              )}
              <span className="ml-auto text-xs text-ink-2 tnum">
                {s.distanceM.toLocaleString("ko-KR")}m · 도보 약 {s.walkMinutes}분
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function BulletList({ items, tone }: { items: string[]; tone: string }) {
  if (items.length === 0) return <p className="text-xs text-ink-3">찾은 내용이 없습니다.</p>;
  return (
    <ul className={cx("list-disc space-y-1 pl-4 text-[13px] leading-relaxed", tone)}>
      {items.map((t, i) => (
        <li key={`${i}-${t}`}>
          <span className="text-ink-2">{t}</span>
        </li>
      ))}
    </ul>
  );
}

function BriefBody({ brief }: { brief: NeighborhoodBrief }) {
  const c = brief.content;
  const a = c.schools.assignedElementary;
  const place: [string, string][] = [
    ["교통", c.location.transit],
    ["상권·생활", c.location.amenities],
    ["학원가·교육", c.location.education],
    ["공원·녹지", c.location.nature],
  ];
  return (
    <div className="space-y-4">
      <p className="rounded-control bg-brand-50 px-3 py-2.5 text-[13px] leading-relaxed text-ink">{c.summary}</p>

      <div>
        <h4 className="mb-2 text-xs font-semibold text-ink-2">입지</h4>
        <dl className="grid gap-1.5 sm:grid-cols-2">
          {place.map(([label, text]) => (
            <div key={label} className="rounded-control bg-surface-2 px-3 py-2">
              <dt className="text-[11.5px] font-semibold text-ink-3">{label}</dt>
              <dd className="mt-0.5 text-[12.5px] leading-relaxed text-ink-2">{text}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div>
        <h4 className="mb-2 text-xs font-semibold text-ink-2">평판</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-[11.5px] font-semibold text-movein">장점</p>
            <BulletList items={c.reputation.pros} tone="marker:text-movein" />
          </div>
          <div>
            <p className="mb-1 text-[11.5px] font-semibold text-seango">단점</p>
            <BulletList items={c.reputation.cons} tone="marker:text-seango" />
          </div>
        </div>
        {c.reputation.quotes.length > 0 ? (
          <ul className="mt-2 space-y-1.5">
            {c.reputation.quotes.map((q, i) => (
              <li key={`${i}-${q.text}`} className="rounded-control border border-line bg-surface px-3 py-2">
                <p className="text-[12.5px] leading-relaxed text-ink-2">“{q.text}”</p>
                <p className="mt-0.5 text-[11.5px] text-ink-3">
                  {q.url ? (
                    <OutLink href={q.url} className="text-[11.5px]">
                      {q.source}
                    </OutLink>
                  ) : (
                    q.source
                  )}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div>
        <h4 className="mb-2 text-xs font-semibold text-ink-2">배정 초등학교</h4>
        <div className="rounded-control border border-line bg-surface px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-bold text-ink">{a.name ?? "확인하지 못했습니다"}</span>
            <Badge className={CONFIDENCE_STYLE[a.confidence]}>{a.confidence}</Badge>
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{a.basis}</p>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {a.url ? <OutLink href={a.url}>근거 보기</OutLink> : null}
            <OutLink href="https://schoolzone.emac.kr/">학구도안내서비스에서 확인</OutLink>
          </div>
          {c.schools.middleSchoolNote !== "모름" ? (
            <p className="mt-2 border-t border-line pt-2 text-[12px] leading-relaxed text-ink-3">중학교 배정 참고. {c.schools.middleSchoolNote}</p>
          ) : null}
        </div>
      </div>

      {c.cautions.length > 0 ? (
        <div>
          <h4 className="mb-2 text-xs font-semibold text-ink-2">주의할 점</h4>
          <ul className="space-y-1 rounded-control bg-suspect-soft px-3 py-2 text-[12.5px] leading-relaxed text-suspect">
            {c.cautions.map((t, i) => (
              <li key={`${i}-${t}`}>· {t}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {c.sources.length > 0 ? (
        <div>
          <h4 className="mb-2 text-xs font-semibold text-ink-2">출처 {c.sources.length}건</h4>
          <ol className="list-decimal space-y-1 pl-5 text-xs text-ink-3">
            {c.sources.map((src) => (
              <li key={src.url} className="break-all">
                <OutLink href={src.url} className="font-medium">
                  {src.title}
                </OutLink>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

function QuickLinks({ links }: { links: BriefLink[] }) {
  return (
    <>
      <h4 className="mt-4 mb-2 text-xs font-semibold text-ink-2">바로가기</h4>
      <div className="flex flex-wrap gap-1.5">
        {links.map((l) => (
          <a
            key={l.url}
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-7 items-center gap-1 rounded-control bg-surface-3 px-2 text-[11.5px] font-medium text-ink-2 hover:bg-line focus-visible:outline-2 focus-visible:outline-brand-500"
          >
            <ExternalLink className="size-3" aria-hidden />
            {l.title}
          </a>
        ))}
      </div>
    </>
  );
}

function formatCreatedAt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

function BriefSection({ item }: { item: SearchResultItem }) {
  const id = item.complex.id;
  const [data, setData] = useState<ComplexBriefResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const genCtrl = useRef<AbortController | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    api
      .complexBrief(id, ctrl.signal)
      .then(setData)
      .catch((e: unknown) => {
        if (!isAbort(e)) setLoadError(errorMessage(e));
      });
    return () => {
      ctrl.abort();
      genCtrl.current?.abort();
    };
  }, [id]);

  const generate = async () => {
    const ctrl = new AbortController();
    genCtrl.current = ctrl;
    setBusy(true);
    setGenError(null);
    try {
      const { brief } = await api.generateBrief(id, ctrl.signal);
      setData((d) => (d ? { ...d, brief, generating: false } : d));
    } catch (e) {
      if (!isAbort(e)) setGenError(errorMessage(e));
    } finally {
      if (!ctrl.signal.aborted) setBusy(false);
    }
  };

  const brief = data?.brief ?? null;
  const generateButton = (label: string, Icon: typeof Sparkles, primary: boolean) => (
    <button
      type="button"
      onClick={() => void generate()}
      disabled={busy || data?.generating}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-control font-semibold focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500 disabled:opacity-60",
        primary ? "h-9 bg-brand-600 px-3.5 text-[13px] text-white hover:bg-brand-700" : "h-7 bg-surface-3 px-2.5 text-[11.5px] text-ink hover:bg-line",
      )}
    >
      {busy ? <Loader2 className={primary ? "size-4 animate-spin" : "size-3 animate-spin"} aria-hidden /> : <Icon className={primary ? "size-4" : "size-3"} aria-hidden />}
      {busy ? "알아보는 중" : label}
    </button>
  );

  return (
    <Block id="d-brief" title="동네 브리핑" aside={<Badge className="bg-brand-50 text-brand-700">AI·웹 검색</Badge>}>
      {loadError ? <p className="rounded-control bg-seango-soft px-3 py-2 text-xs text-seango">{loadError}</p> : null}
      {!data && !loadError ? (
        <p className="flex items-center gap-2 text-xs text-ink-3">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> 동네 정보를 불러오는 중입니다.
        </p>
      ) : null}

      {data ? (
        <>
          {!data.llmAvailable && !brief ? (
            <div className="rounded-control border border-dashed border-line-strong bg-surface-2 px-3 py-3 text-[12.5px] leading-relaxed text-ink-2">
              <p className="flex items-center gap-1.5 font-semibold text-ink">
                <Sparkles className="size-4 text-brand-600" aria-hidden />
                AI가 이 단지의 입지·평판·배정 초등학교를 찾아 정리해 줍니다.
              </p>
              <p className="mt-1">
                Claude가 웹 검색으로 호갱노노·네이버 부동산·블로그 등 공개 후기와 교통·상권·학원가 정보를 찾아 출처와 함께 요약합니다. 상단 API 설정에서 Anthropic 키를 넣으면 쓸 수 있습니다.
              </p>
            </div>
          ) : null}

          {data.llmAvailable && !brief ? (
            <div className="rounded-control bg-surface-2 px-3 py-3">
              <p className="text-[12.5px] leading-relaxed text-ink-2">
                Claude가 웹 검색으로 교통·상권·학원가·공원, 입주민 후기, 배정 초등학교 근거를 찾아 정리합니다. 한 번 만들 때마다 유료 호출이며 보통 20~60초 걸립니다.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {generateButton("AI로 평판·입지·배정학교 알아보기", Sparkles, true)}
                {busy ? <span className="text-[11.5px] text-ink-3">검색하고 정리하는 중입니다. 창을 닫으면 결과를 받지 못할 수 있습니다.</span> : null}
              </div>
            </div>
          ) : null}

          {data.generating && !busy ? (
            <p className="mt-2 rounded-control bg-suspect-soft px-3 py-2 text-xs text-suspect">이 단지 브리핑을 다른 창에서 만들고 있습니다. 잠시 뒤 상세를 다시 열어 보세요.</p>
          ) : null}

          <div aria-live="polite" aria-busy={busy} className="empty:hidden">
            {genError ? <p className="mt-2 rounded-control bg-seango-soft px-3 py-2 text-xs text-seango">{genError}</p> : null}
            {brief ? (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-ink-3 tnum">
                  <span>생성 {formatCreatedAt(brief.createdAt)}</span>
                  <span aria-hidden>·</span>
                  <span>모델 {brief.model}</span>
                  {brief.webSearches !== null ? (
                    <>
                      <span aria-hidden>·</span>
                      <span>웹 검색 {brief.webSearches}회</span>
                    </>
                  ) : null}
                  <span className="ml-auto">{data.llmAvailable ? generateButton("다시 생성", RefreshCw, false) : null}</span>
                </div>
                {busy ? <p className="mb-2 text-[11.5px] text-ink-3">새 브리핑을 만드는 중입니다. 보통 20~60초 걸립니다.</p> : null}
                <BriefBody brief={brief} />
              </>
            ) : null}
          </div>

          <SchoolList schools={data.schools} note={data.schoolsNote} />
          <QuickLinks links={data.links} />

          <p className="mt-4 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-ink-4">
            <School className="mt-px size-3.5 shrink-0" aria-hidden />
            AI 요약은 틀리거나 오래된 내용일 수 있습니다. 배정 초등학교는 해마다 바뀔 수 있으니 학구도안내서비스와 관할 교육지원청에서 꼭 확인하세요.
          </p>
        </>
      ) : null}
    </Block>
  );
}

function ScoreSection({ item }: { item: SearchResultItem }) {
  return (
    <Block id="d-score" title="점수 내역" aside={<span className="text-lg font-extrabold text-brand-700 tnum">{item.score.total.toFixed(1)}점</span>}>
      <ul className="space-y-2">
        {item.score.parts.map((p) => (
          <li key={p.key} className="text-xs">
            <div className="flex items-baseline gap-2">
              <span className="font-medium text-ink">{p.label}</span>
              <span className="text-ink-4 tnum">가중치 {p.weight}</span>
              <span className="ml-auto font-semibold text-ink tnum">{Math.round(p.score * 100)}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.round(p.score * 100)}%` }} />
            </div>
            <p className="mt-0.5 text-[11.5px] text-ink-3">{p.detail}</p>
          </li>
        ))}
      </ul>
    </Block>
  );
}

export default function DetailPanel({
  item,
  workplaces,
  cash,
  onClose,
}: {
  item: SearchResultItem;
  workplaces: Workplace[];
  cash: number;
  onClose: () => void;
}) {
  const close = useEffectEvent(() => onClose());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { complex, unit } = item;
  const naverArticle = complex.source === "naver-import" ? (unit.ads.find((a) => /^\d+$/.test(a.articleNo))?.articleNo ?? null) : null;
  const nav = [
    ["d-seango", "세안고 근거"],
    ["d-cash", "필요 현금"],
    ["d-commute", "통근"],
    ["d-trades", "실거래가"],
    ["d-brief", "동네 브리핑"],
    ["d-score", "점수"],
  ];
  return (
    <aside
      aria-label={`${complex.name} 상세`}
      className="fixed inset-x-0 top-14 bottom-0 z-40 flex flex-col bg-surface shadow-pop sm:left-auto sm:w-[min(620px,100vw)]"
    >
      <div className="border-b border-line px-5 pt-4 pb-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-ink-3">{complex.address}</p>
            <h2 className="mt-0.5 text-lg font-extrabold text-ink">{complex.name}</h2>
            <p className="mt-0.5 text-[13px] font-semibold text-ink tnum">
              {householdsLabel(complex) ?? <span className="font-normal text-ink-4">세대수 미확인</span>}
              {ageLabel(complex, true) ? <span className="font-normal text-ink-2"> · {ageLabel(complex, true)}</span> : null}
            </p>
            <p className="mt-0.5 text-[13px] text-ink-2 tnum">
              {unitTitle(item)} · 전용 {unit.exclusiveArea}㎡({toPyeong(unit.exclusiveArea).toFixed(1)}평)
              {unit.supplyArea ? ` · 공급 ${unit.supplyArea}㎡` : ""} · 방 {unit.roomCount}
              {unit.direction ? ` · ${unit.direction}` : ""}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xl font-extrabold text-ink tnum">{formatWon(unit.price)}</p>
            <div className="mt-1">
              <SeangoBadge status={item.seango.status} />
            </div>
            {naverArticle ? (
              <a
                href={naverArticleUrl(naverArticle)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 inline-flex h-7 items-center gap-1 rounded-control bg-[#03c75a] px-2.5 text-[11.5px] font-bold whitespace-nowrap text-white hover:bg-[#02b350] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
              >
                네이버에서 이 매물 보기
                <ExternalLink className="size-3" aria-hidden />
              </a>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="상세 닫기"
            className="grid size-8 shrink-0 place-items-center rounded-control text-ink-3 hover:bg-surface-3 hover:text-ink focus-visible:outline-2 focus-visible:outline-brand-500"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <nav aria-label="상세 섹션" className="mt-3 flex gap-1 overflow-x-auto">
          {nav.map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="shrink-0 rounded-full bg-surface-3 px-2.5 py-1 text-xs font-medium text-ink-2 hover:bg-line focus-visible:outline-2 focus-visible:outline-brand-500"
            >
              {label}
            </a>
          ))}
        </nav>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <SeangoSection item={item} />
        <CashSection item={item} cash={cash} />
        <CommuteSection item={item} workplaces={workplaces} />
        <TradesSection item={item} />
        <BriefSection key={item.complex.id} item={item} />
        <ScoreSection item={item} />
      </div>
    </aside>
  );
}
