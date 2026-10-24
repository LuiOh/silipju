"use client";
// 앱 셸: 메타·검색 조건·검색 결과 상태를 관리하고 사이드바·결과·지도·상세를 배치
import { useEffect, useEffectEvent, useRef, useState, type CSSProperties } from "react";
import { AlertCircle, List, Loader2, Map as MapIcon, RefreshCw, SlidersHorizontal } from "lucide-react";
import type { GeoPoint, MetaResponse, SearchConditions, SearchResponse } from "@/lib/types";
import { LOAN_INFO_STALE_MS } from "@/lib/finance/live-rates";
import { api, errorMessage, isAbort, loadStoredConditions, storeConditions } from "./api";
import AppHeader from "./AppHeader";
import ConditionsSidebar from "./ConditionsSidebar";
import DetailPanel from "./DetailPanel";
import ImportModal from "./ImportModal";
import { SORT_OPTIONS } from "./labels";
import type { MapFocus } from "./LeafletMap";
import MapPanel from "./MapPanel";
import ResultCard from "./ResultCard";
import ResultsHeader from "./ResultsHeader";
import SplitHandle from "./SplitHandle";
import { cx } from "./ui";
import { MAX_WORKPLACES, newWorkplaceId } from "./WorkplaceEditor";

const autoKeyOf = (c: SearchConditions) => JSON.stringify([c.sortBy, c.weights, c.includeDemo, c.excludedLines]);
const COLLECT_POLL_MS = 5000;
const RESEARCH_GAP_MS = 30_000;
const MAP_WIDTH_KEY = "silipju:map-width:v1";

function readMapWidth(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const w = Number(window.localStorage.getItem(MAP_WIDTH_KEY));
    return Number.isFinite(w) && w > 0 ? w : null;
  } catch (e) {
    console.warn("저장된 지도 폭을 읽지 못했습니다.", e);
    return null;
  }
}

function storeMapWidth(w: number | null): void {
  try {
    if (w === null) window.localStorage.removeItem(MAP_WIDTH_KEY);
    else window.localStorage.setItem(MAP_WIDTH_KEY, String(w));
  } catch (e) {
    console.warn("지도 폭을 저장하지 못했습니다.", e);
  }
}

function Disclaimer() {
  return (
    <footer className="mt-6 border-t border-line pt-4 pb-20 text-[11.5px] leading-relaxed text-ink-3 xl:pb-6">
      대출 한도·세금은 2026-10-24 기준 규정을 단순화한 추정치입니다. 실제 한도는 KB시세·감정가·은행 심사에 따라 다릅니다. 통근시간은 TMAP 미연결 시
      역·노선 기반 추정치입니다.
    </footer>
  );
}

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-card border border-line bg-surface p-3.5" aria-hidden>
      <div className="h-4 w-1/3 rounded bg-surface-3" />
      <div className="mt-2 h-3 w-2/3 rounded bg-surface-3" />
      <div className="mt-4 h-6 w-1/4 rounded bg-surface-3" />
      <div className="mt-4 h-3 w-full rounded bg-surface-3" />
    </div>
  );
}

export default function SilipjuApp() {
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [metaAttempt, setMetaAttempt] = useState(0);
  const [conditions, setConditions] = useState<SearchConditions | null>(null);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [searched, setSearched] = useState<SearchConditions | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [highlightedComplexId, setHighlightedComplexId] = useState<string | null>(null);
  const [pickMode, setPickMode] = useState(false);
  const [focusWorkplaceId, setFocusWorkplaceId] = useState<string | null>(null);
  const [mapFocus, setMapFocus] = useState<MapFocus | null>(null);
  const [fitSeq, setFitSeq] = useState(0);
  const [importOpen, setImportOpen] = useState(() => typeof window !== "undefined" && window.location.hash === "#collect");
  const [showConditions, setShowConditions] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [mapWidth, setMapWidth] = useState<number | null>(readMapWidth);
  const [notice, setNotice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const autoKeyRef = useRef<string | null>(null);
  const collectSyncRef = useRef({ units: -1, stableTicks: 0, lastSearchAt: 0 });
  const loanInfoTriedRef = useRef(false);

  const commitMapWidth = (w: number | null) => {
    setMapWidth(w);
    storeMapWidth(w);
  };

  const runSearch = (cond: SearchConditions) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setSearchError(null);
    api
      .search(cond, ctrl.signal)
      .then((r) => {
        setResponse(r);
        setSearched(cond);
        setLoading(false);
        setFitSeq((s) => s + 1);
        setSelectedUnitId((id) => (id && r.items.some((i) => i.unit.id === id) ? id : null));
      })
      .catch((e: unknown) => {
        if (isAbort(e)) return;
        setSearchError(errorMessage(e));
        setLoading(false);
      });
  };

  const startSearch = useEffectEvent((c: SearchConditions) => {
    autoKeyRef.current = autoKeyOf(c);
    runSearch(c);
  });

  const refreshStaleLoanInfo = useEffectEvent((m: MetaResponse) => {
    if (loanInfoTriedRef.current) return;
    const age = m.loanInfo ? Date.now() - Date.parse(m.loanInfo.fetchedAt) : Number.POSITIVE_INFINITY;
    if (age < LOAN_INFO_STALE_MS) return;
    loanInfoTriedRef.current = true;
    api
      .refreshLoanInfo()
      .then(() => setMetaAttempt((n) => n + 1))
      .catch((e: unknown) => console.debug("현행 대출정보를 가져오지 못했습니다.", e));
  });

  useEffect(() => {
    const ctrl = new AbortController();
    api
      .meta(ctrl.signal)
      .then((m) => {
        const initial = loadStoredConditions(m.defaults);
        setMeta(m);
        setMetaError(null);
        setConditions(initial);
        startSearch(initial);
        refreshStaleLoanInfo(m);
      })
      .catch((e: unknown) => {
        if (!isAbort(e)) setMetaError(errorMessage(e));
      });
    return () => ctrl.abort();
  }, [metaAttempt]);

  useEffect(() => {
    if (conditions) storeConditions(conditions);
  }, [conditions]);

  const autoKey = conditions ? autoKeyOf(conditions) : null;
  const autoSearch = useEffectEvent(() => {
    if (conditions) runSearch(conditions);
  });
  useEffect(() => {
    if (autoKey === null || autoKeyRef.current === null || autoKeyRef.current === autoKey) return;
    autoKeyRef.current = autoKey;
    const t = setTimeout(autoSearch, 400);
    return () => clearTimeout(t);
  }, [autoKey]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  // 자동 수집 중에는 매물 수가 몇 초마다 늘어나므로, 수가 멈췄을 때나 30초에 한 번만 다시 검색한다
  const syncCollected = useEffectEvent((units: number) => {
    const s = collectSyncRef.current;
    s.stableTicks = units === s.units ? s.stableTicks + 1 : 0;
    s.units = units;
    if (!response || !searched || loading) return;
    const shown = response.dataSources.realUnits;
    if (units === shown) return;
    const now = Date.now();
    if (s.stableTicks < 1 && now - s.lastSearchAt < RESEARCH_GAP_MS) return;
    s.lastSearchAt = now;
    runSearch(searched);
    setNotice(
      units > shown
        ? `새로 가져온 실매물 ${(units - shown).toLocaleString("ko-KR")}건을 반영해 다시 검색했습니다.`
        : "실매물 목록이 바뀌어 다시 검색했습니다.",
    );
  });
  useEffect(() => {
    const ctrl = new AbortController();
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      api
        .collected(ctrl.signal)
        .then((r) => syncCollected(r.total.units))
        .catch((e: unknown) => {
          if (!isAbort(e)) console.debug("실매물 수집 현황을 확인하지 못했습니다.", e);
        });
    };
    const t = window.setInterval(tick, COLLECT_POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
      ctrl.abort();
    };
  }, []);

  const update = (fn: (c: SearchConditions) => SearchConditions) => setConditions((c) => (c ? fn(c) : c));

  const search = () => {
    if (!conditions) return;
    autoKeyRef.current = autoKeyOf(conditions);
    setShowConditions(false);
    runSearch(conditions);
  };

  const reset = () => {
    if (!meta) return;
    autoKeyRef.current = autoKeyOf(meta.defaults);
    setConditions(meta.defaults);
    setPickMode(false);
    runSearch(meta.defaults);
  };

  const addPickedWorkplace = (p: GeoPoint) => {
    if (!conditions) return;
    if (conditions.workplaces.length >= MAX_WORKPLACES) {
      setNotice("직장은 최대 5곳까지 넣을 수 있습니다.");
      setPickMode(false);
      return;
    }
    const id = newWorkplaceId();
    update((c) => ({ ...c, workplaces: [...c.workplaces, { id, label: "지도 선택 위치", location: p, weight: 1 }] }));
    setFocusWorkplaceId(id);
    setPickMode(false);
    setNotice("지도에서 찍은 위치를 직장으로 추가했습니다. 이름을 바꾸고 검색을 누르세요.");
  };

  const focusComplexCards = (complexId: string) => {
    setHighlightedComplexId(complexId);
    setShowMap(false);
    window.setTimeout(() => {
      document.querySelector(`[data-complex="${CSS.escape(complexId)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 60);
  };

  const toggleMap = () => {
    setShowMap((v) => !v);
    window.setTimeout(() => setFitSeq((s) => s + 1), 80);
  };

  const relaxFilters = () => {
    if (!conditions) return;
    const next: SearchConditions = { ...conditions, priceMin: null, priceMax: null, areaMin: null, areaMax: null, regions: [], maxCommuteMinutes: null };
    autoKeyRef.current = autoKeyOf(next);
    setConditions(next);
    runSearch(next);
  };

  const items = response?.items ?? [];
  const selected = selectedUnitId ? items.find((i) => i.unit.id === selectedUnitId) ?? null : null;
  const dirty = conditions !== null && searched !== null && JSON.stringify(conditions) !== JSON.stringify(searched);
  const realData = response
    ? { complexes: response.dataSources.importedComplexes, units: response.dataSources.realUnits }
    : meta?.realData ?? { complexes: 0, units: 0 };

  if (!meta || !conditions) {
    return (
      <div className="flex h-dvh flex-col">
        <AppHeader meta={null} realData={realData} onImport={() => setImportOpen(true)} onSettingsChanged={() => setMetaAttempt((n) => n + 1)} />
        <div className="grid flex-1 place-items-center p-6">
          {metaError ? (
            <div className="max-w-sm rounded-card bg-surface p-5 text-center shadow-card">
              <AlertCircle className="mx-auto size-6 text-seango" aria-hidden />
              <p className="mt-2 text-sm font-semibold text-ink">서버 설정을 불러오지 못했습니다.</p>
              <p className="mt-1 text-xs text-ink-3">{metaError}</p>
              <button
                type="button"
                onClick={() => setMetaAttempt((n) => n + 1)}
                className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-control bg-brand-600 px-4 text-[13px] font-semibold text-white hover:bg-brand-700"
              >
                <RefreshCw className="size-4" aria-hidden />
                다시 시도
              </button>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-sm text-ink-3">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              검색 조건을 불러오는 중입니다.
            </p>
          )}
        </div>
      </div>
    );
  }

  const mapWidthStyle: (CSSProperties & { "--map-w": string }) | undefined = mapWidth === null ? undefined : { "--map-w": `${mapWidth}px` };

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader meta={meta} realData={realData} onImport={() => setImportOpen(true)} onSettingsChanged={() => setMetaAttempt((n) => n + 1)} />
      <div className="relative flex min-h-0 flex-1">
        <aside
          className={cx(
            "flex-col border-r border-line bg-surface",
            showConditions ? "fixed inset-x-0 top-14 bottom-0 z-50 flex shadow-pop sm:right-auto sm:w-[380px]" : "hidden",
            "lg:static lg:z-auto lg:flex lg:w-[360px] lg:shrink-0 lg:shadow-none",
          )}
        >
          <ConditionsSidebar
            meta={meta}
            conditions={conditions}
            onChange={update}
            onSearch={search}
            onReset={reset}
            loading={loading}
            dirty={dirty}
            pickMode={pickMode}
            onPickModeChange={(v) => {
              setPickMode(v);
              if (v) {
                setShowConditions(false);
                setShowMap(true);
              }
            }}
            focusWorkplaceId={focusWorkplaceId}
            realData={realData}
          />
        </aside>

        <main className="scroll-thin min-w-0 flex-1 overflow-y-auto" aria-busy={loading}>
          <div className="p-3">
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-base font-bold text-ink">
                검색 결과
                {response ? <span className="ml-1.5 text-brand-700 tnum">{response.stats.returned.toLocaleString("ko-KR")}건</span> : null}
              </h2>
              {loading ? <Loader2 className="size-4 animate-spin text-brand-600" aria-label="검색 중" /> : null}
              <label className="ml-auto flex items-center gap-1.5 text-xs text-ink-3">
                정렬
                <select
                  className="h-8 rounded-control border border-line bg-surface px-2 text-[13px] text-ink focus-visible:outline-2 focus-visible:outline-brand-500"
                  value={conditions.sortBy}
                  onChange={(e) => update((c) => ({ ...c, sortBy: e.target.value as SearchConditions["sortBy"] }))}
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {searchError ? (
              <div role="alert" className="mb-3 flex items-center gap-2 rounded-control bg-seango-soft px-3 py-2.5 text-[13px] text-seango">
                <AlertCircle className="size-4 shrink-0" aria-hidden />
                검색에 실패했습니다. {searchError}
                <button type="button" onClick={search} className="ml-auto rounded-control bg-surface px-2.5 py-1 text-xs font-semibold text-seango hover:bg-surface-2">
                  다시 시도
                </button>
              </div>
            ) : null}

            {response ? (
              <ResultsHeader
                response={response}
                onOpenCollect={() => setImportOpen(true)}
                onRelaxFilters={relaxFilters}
                onIncludeDemo={(v) => update((c) => ({ ...c, includeDemo: v }))}
              />
            ) : (
              <div className="space-y-3">
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </div>
            )}

            <ol
              className={cx(
                "mt-3 grid gap-2.5 transition-opacity [grid-template-columns:repeat(auto-fill,minmax(min(100%,440px),1fr))]",
                loading && response && "opacity-60",
              )}
            >
              {items.map((it) => (
                <li key={it.unit.id} className="grid min-w-0">
                  <ResultCard
                    item={it}
                    selected={it.unit.id === selectedUnitId}
                    highlighted={it.complex.id === highlightedComplexId}
                    onSelect={() => {
                      setSelectedUnitId(it.unit.id);
                      setHighlightedComplexId(it.complex.id);
                      setMapFocus((f) => ({ point: it.complex.location, seq: (f?.seq ?? 0) + 1 }));
                    }}
                  />
                </li>
              ))}
            </ol>
            <Disclaimer />
          </div>
        </main>

        <div
          style={mapWidthStyle}
          className={cx(
            showMap ? "fixed inset-x-0 top-14 bottom-0 z-30 block" : "hidden",
            "xl:relative xl:z-auto xl:block xl:w-[min(var(--map-w,min(42%,760px)),calc(100%_-_780px))] xl:shrink-0 xl:border-l xl:border-line",
          )}
        >
          <SplitHandle onCommit={commitMapWidth} />
          <MapPanel
            items={items}
            workplaces={conditions.workplaces}
            selectedComplexId={selected?.complex.id ?? null}
            highlightedComplexId={highlightedComplexId}
            focus={mapFocus}
            fitSeq={fitSeq}
            pickMode={pickMode}
            onComplexClick={focusComplexCards}
            onPick={addPickedWorkplace}
            onCancelPick={() => setPickMode(false)}
          />
        </div>

        <div className={cx("fixed bottom-4 left-1/2 z-[55] -translate-x-1/2 gap-2 xl:hidden", selected ? "hidden" : "flex")}>
          <button
            type="button"
            onClick={() => {
              setShowConditions((v) => !v);
              setShowMap(false);
            }}
            aria-pressed={showConditions}
            className="inline-flex h-10 items-center gap-1.5 rounded-full bg-surface px-4 text-[13px] font-semibold text-ink shadow-pop lg:hidden"
          >
            <SlidersHorizontal className="size-4" aria-hidden />
            조건
          </button>
          <button
            type="button"
            onClick={toggleMap}
            aria-pressed={showMap}
            className="inline-flex h-10 items-center gap-1.5 rounded-full bg-ink px-4 text-[13px] font-semibold text-white shadow-pop"
          >
            {showMap ? <List className="size-4" aria-hidden /> : <MapIcon className="size-4" aria-hidden />}
            {showMap ? "목록 보기" : "지도 보기"}
          </button>
        </div>

        {notice ? (
          <div role="status" className="fixed bottom-20 left-1/2 z-[70] -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-xs font-medium text-white shadow-pop xl:bottom-6">
            {notice}
          </div>
        ) : null}
      </div>

      {selected && searched ? (
        <DetailPanel
          key={selected.unit.id}
          item={selected}
          workplaces={searched.workplaces}
          cash={searched.household.cash}
          onClose={() => setSelectedUnitId(null)}
        />
      ) : null}

      {importOpen ? (
        <ImportModal
          extensionPath={meta.extensionPath}
          onClose={() => {
            setImportOpen(false);
            if (window.location.hash === "#collect") window.history.replaceState(null, "", window.location.pathname + window.location.search);
          }}
          onChanged={() => {
            if (conditions) runSearch(conditions);
          }}
        />
      ) : null}
    </div>
  );
}
