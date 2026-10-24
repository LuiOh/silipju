"use client";
// 검색 조건 입력 사이드바(매물·직장/통근·가구·대출·세안고·정렬 전부 편집)
import type { ReactNode } from "react";
import { Banknote, Briefcase, ChevronDown, Home, Loader2, RotateCcw, Search, ShieldCheck, SlidersHorizontal, Users } from "lucide-react";
import type { FloorBand, FloorFilter, Household, LoanOptions, MetaResponse, RankWeights, SearchConditions, SeangoFilter } from "@/lib/types";
import { formatWon } from "@/lib/format";
import { suggestRates } from "@/lib/finance/live-rates";
import { FLOOR_BAND_LABELS, lineLabel, RATE_TYPES, SEANGO_MODES, SORT_OPTIONS, STRICTNESS, WEIGHT_LABELS } from "./labels";
import WorkplaceEditor from "./WorkplaceEditor";
import { Chip, FieldLabel, NumberInput, Section, Segmented, Slider, Switch, controlClass, cx } from "./ui";

const EOK = 100_000_000;
const MAN = 10_000;

const AREA_CHIPS: { label: string; min: number; max: number | null }[] = [
  { label: "59㎡", min: 55, max: 65 },
  { label: "74㎡", min: 70, max: 79 },
  { label: "84㎡", min: 80, max: 90 },
  { label: "101㎡+", min: 95, max: null },
];

const TERM_OPTIONS = [10, 15, 20, 25, 30, 35, 40, 50];
const LIMIT_OPTIONS = [30, 60, 100, 200, 300];

type Updater = (fn: (c: SearchConditions) => SearchConditions) => void;

function Row({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}

function MoneyField({
  id,
  label,
  value,
  onChange,
  placeholder,
  unit = "만원",
  scale = MAN,
  step = 100,
}: {
  id: string;
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  unit?: string;
  scale?: number;
  step?: number;
}) {
  return (
    <div>
      <FieldLabel htmlFor={id} hint={value !== null && value > 0 ? `= ${formatWon(value)}` : undefined}>
        {label}
      </FieldLabel>
      <NumberInput id={id} value={value} onChange={onChange} scale={scale} step={step} min={0} unit={unit} placeholder={placeholder} />
    </div>
  );
}

export default function ConditionsSidebar({
  meta,
  conditions: c,
  onChange,
  onSearch,
  onReset,
  loading,
  dirty,
  pickMode,
  onPickModeChange,
  focusWorkplaceId,
  realData,
}: {
  meta: MetaResponse;
  conditions: SearchConditions;
  onChange: Updater;
  onSearch: () => void;
  onReset: () => void;
  loading: boolean;
  dirty: boolean;
  pickMode: boolean;
  onPickModeChange: (v: boolean) => void;
  focusWorkplaceId: string | null;
  realData: { complexes: number; units: number };
}) {
  const set = (patch: Partial<SearchConditions>) => onChange((p) => ({ ...p, ...patch }));
  const setH = (patch: Partial<Household>) => onChange((p) => ({ ...p, household: { ...p.household, ...patch } }));
  const setL = (patch: Partial<LoanOptions>) => onChange((p) => ({ ...p, loan: { ...p.loan, ...patch } }));
  const setS = (patch: Partial<SeangoFilter>) => onChange((p) => ({ ...p, seango: { ...p.seango, ...patch } }));
  const setW = (patch: Partial<RankWeights>) => onChange((p) => ({ ...p, weights: { ...p.weights, ...patch } }));
  const weightOf = (k: keyof RankWeights) => c.weights[k] ?? 0;
  const commuteScored = c.workplaces.length > 0;
  const weightSum = WEIGHT_LABELS.reduce((s, w) => s + (w.key !== "commute" || commuteScored ? weightOf(w.key) : 0), 0);
  const shareOf = (k: keyof RankWeights) => (weightSum > 0 && (k !== "commute" || commuteScored) ? Math.round((weightOf(k) / weightSum) * 100) : 0);
  const excluded = c.excludedLines ?? [];
  const stationLines = meta.stationLines ?? [];
  const toggleLine = (line: string) =>
    onChange((p) => {
      const cur = p.excludedLines ?? [];
      return { ...p, excludedLines: cur.includes(line) ? cur.filter((x) => x !== line) : [...cur, line] };
    });
  const h = c.household;
  const l = c.loan;
  const live = suggestRates(meta.loanInfo, h, l.termYears);
  const f = c.floors;
  const setF = (patch: Partial<FloorFilter>) => onChange((p) => ({ ...p, floors: { ...p.floors, ...patch } }));
  const toggleBand = (b: FloorBand) => {
    const next = f.bands.includes(b) ? f.bands.filter((x) => x !== b) : [...f.bands, b];
    setF({ bands: next.length === FLOOR_BAND_LABELS.length ? [] : next });
  };
  const floorSummary = [
    f.bands.length === 0 ? "모든 층" : FLOOR_BAND_LABELS.filter((b) => f.bands.includes(b.value)).map((b) => b.label).join("·"),
    f.excludeFirst ? "1층 제외" : null,
    f.excludeTop ? "탑층 제외" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <form
      className="flex h-full min-h-0 flex-col"
      aria-label="검색 조건"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch();
      }}
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-sm font-bold text-ink">검색 조건</h2>
        <button
          type="button"
          onClick={onReset}
          className="flex h-7 items-center gap-1 rounded-control px-2 text-xs font-medium text-ink-3 hover:bg-surface-3 hover:text-ink focus-visible:outline-2 focus-visible:outline-brand-500"
        >
          <RotateCcw className="size-3.5" aria-hidden />
          기본값으로
        </button>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <Section title="매물 조건" icon={<Home className="size-4" aria-hidden />}>
          <div>
            <FieldLabel hint={realData.units > 0 ? `실매물 ${realData.complexes}개 단지 · ${realData.units}개 매물` : "수집된 실매물 없음"}>
              데이터
            </FieldLabel>
            <Segmented
              ariaLabel="검색할 데이터"
              value={c.includeDemo ? "all" : "real"}
              options={[
                { value: "real", label: "실매물만" },
                { value: "all", label: "샘플 포함" },
              ]}
              onChange={(v) => set({ includeDemo: v === "all" })}
            />
          </div>
          <div>
            <FieldLabel htmlFor="price-min" hint="비우면 제한 없음">
              매매가
            </FieldLabel>
            <Row>
              <NumberInput id="price-min" ariaLabel="최소 매매가(억)" value={c.priceMin} onChange={(v) => set({ priceMin: v })} scale={EOK} step={0.1} min={0} unit="억" placeholder="최소" />
              <NumberInput ariaLabel="최대 매매가(억)" value={c.priceMax} onChange={(v) => set({ priceMax: v })} scale={EOK} step={0.1} min={0} unit="억" placeholder="최대" />
            </Row>
          </div>
          <div>
            <FieldLabel htmlFor="area-min">전용면적</FieldLabel>
            <Row>
              <NumberInput id="area-min" ariaLabel="최소 전용면적(㎡)" value={c.areaMin} onChange={(v) => set({ areaMin: v })} step={1} min={0} unit="㎡" placeholder="최소" />
              <NumberInput ariaLabel="최대 전용면적(㎡)" value={c.areaMax} onChange={(v) => set({ areaMax: v })} step={1} min={0} unit="㎡" placeholder="최대" />
            </Row>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {AREA_CHIPS.map((a) => (
                <Chip
                  key={a.label}
                  active={c.areaMin === a.min && c.areaMax === a.max}
                  ariaLabel={`전용 ${a.label} 범위로 설정`}
                  onClick={() => set({ areaMin: a.min, areaMax: a.max })}
                >
                  {a.label}
                </Chip>
              ))}
              <Chip active={c.areaMin === null && c.areaMax === null} onClick={() => set({ areaMin: null, areaMax: null })}>
                전체
              </Chip>
            </div>
          </div>
          <fieldset>
            <legend className="mb-1 flex w-full items-baseline justify-between text-xs font-medium text-ink-2">
              층
              <span className="text-[11px] font-normal text-ink-4">{floorSummary}</span>
            </legend>
            <div className="flex flex-wrap items-center gap-1.5">
              <Chip active={f.bands.length === 0} onClick={() => setF({ bands: [] })}>
                전체
              </Chip>
              {FLOOR_BAND_LABELS.map((b) => (
                <Chip key={b.value} active={f.bands.includes(b.value)} onClick={() => toggleBand(b.value)}>
                  {b.label}
                </Chip>
              ))}
              <span aria-hidden className="mx-0.5 h-4 w-px bg-line-strong" />
              <Chip active={f.excludeFirst} onClick={() => setF({ excludeFirst: !f.excludeFirst })}>
                1층 제외
              </Chip>
              <Chip active={f.excludeTop} onClick={() => setF({ excludeTop: !f.excludeTop })}>
                탑층 제외
              </Chip>
            </div>
            <p className="mt-1 text-[11.5px] leading-snug text-ink-3">
              여러 개를 고를 수 있습니다. 저·중·고층은 건물 층수를 3등분한 기준이고, 네이버가 저/중/고로만 올린 매물도 그대로 따릅니다.
            </p>
          </fieldset>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <FieldLabel htmlFor="rooms-min">최소 방 수</FieldLabel>
              <NumberInput id="rooms-min" value={c.roomsMin} onChange={(v) => set({ roomsMin: v })} min={1} step={1} unit="개" placeholder="-" />
            </div>
            <div>
              <FieldLabel htmlFor="households-min">최소 세대수</FieldLabel>
              <NumberInput id="households-min" value={c.minHouseholds} onChange={(v) => set({ minHouseholds: v })} min={0} step={100} placeholder="-" />
            </div>
            <div>
              <FieldLabel htmlFor="age-max">최대 연식</FieldLabel>
              <NumberInput id="age-max" value={c.maxBuildingAge} onChange={(v) => set({ maxBuildingAge: v })} min={0} step={1} unit="년" placeholder="-" />
            </div>
          </div>
          <fieldset>
            <legend className="mb-1 flex w-full items-baseline justify-between text-xs font-medium text-ink-2">
              지역
              <span className="text-[11px] font-normal text-ink-4">{c.regions.length === 0 ? "전체 지역" : `${c.regions.length}곳 선택`}</span>
            </legend>
            <div className="scroll-thin flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
              <Chip active={c.regions.length === 0} onClick={() => set({ regions: [] })}>
                전체
              </Chip>
              {meta.regions.map((r) => {
                const on = c.regions.includes(r);
                return (
                  <Chip key={r} active={on} onClick={() => set({ regions: on ? c.regions.filter((x) => x !== r) : [...c.regions, r] })}>
                    {r}
                  </Chip>
                );
              })}
            </div>
          </fieldset>
        </Section>

        <Section title="직장·통근" icon={<Briefcase className="size-4" aria-hidden />}>
          <WorkplaceEditor
            workplaces={c.workplaces}
            onChange={(w) => set({ workplaces: w })}
            pickMode={pickMode}
            onPickModeChange={onPickModeChange}
            focusId={focusWorkplaceId}
          />
          <Segmented
            ariaLabel="통근 수단"
            value={c.commuteMode}
            onChange={(v) => set({ commuteMode: v })}
            options={[
              { value: "transit", label: "대중교통" },
              { value: "car", label: "자동차" },
            ]}
          />
          <div>
            <FieldLabel htmlFor="commute-max" hint={c.maxCommuteMinutes === null ? "제한 없음" : `${c.maxCommuteMinutes}분 이내`}>
              최대 통근시간(직장별 편도)
            </FieldLabel>
            <Slider
              id="commute-max"
              min={20}
              max={120}
              step={5}
              value={c.maxCommuteMinutes ?? 120}
              disabled={c.maxCommuteMinutes === null}
              onChange={(v) => set({ maxCommuteMinutes: v })}
            />
            <label className="mt-1 flex items-center gap-1.5 text-xs text-ink-2">
              <input
                type="checkbox"
                checked={c.maxCommuteMinutes === null}
                onChange={(e) => set({ maxCommuteMinutes: e.target.checked ? null : 70 })}
              />
              제한 없음
            </label>
          </div>
        </Section>

        <Section title="가구·자금" icon={<Users className="size-4" aria-hidden />}>
          <div className="grid grid-cols-1 gap-2.5">
            <Switch checked={h.homeless} onChange={(v) => setH({ homeless: v })} label="무주택 세대" />
            <Switch checked={h.firstTimeBuyer} onChange={(v) => setH({ firstTimeBuyer: v })} label="생애최초 주택 구입" description="LTV 우대와 취득세 감면 대상 여부를 판단합니다." />
            <Switch
              checked={h.newlywed}
              onChange={(v) => setH({ newlywed: v })}
              label="신혼(혼인 7년 이내·3개월 내 결혼 예정)"
              description="보금자리론 소득 기준이 8,500만(1자녀 9천만·2자녀 이상 1억)으로 오르고, 넘더라도 부부 중 한 명 소득이 7천만 이하면 그 사람 명의로 받을 수 있습니다."
            />
            <Switch checked={h.newbornWithin2y} onChange={(v) => setH({ newbornWithin2y: v })} label="2년 내 출산" description="신생아 특례 대출과 출산가구 취득세 감면에 쓰입니다." />
            <Switch checked={h.dualIncome} onChange={(v) => setH({ dualIncome: v })} label="맞벌이" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <FieldLabel htmlFor="children">자녀 수</FieldLabel>
              <NumberInput id="children" value={h.childrenCount} onChange={(v) => setH({ childrenCount: Math.max(0, v ?? 0) })} min={0} step={1} unit="명" placeholder="0" />
            </div>
            <MoneyField id="income" label="부부합산 연소득" value={h.annualIncome} onChange={(v) => setH({ annualIncome: v ?? 0 })} placeholder="0" />
          </div>
          {h.dualIncome ? (
            <div>
              <MoneyField
                id="single-income"
                label="부부 중 한 명 연소득(선택)"
                value={h.singleIncome}
                onChange={(v) => setH({ singleIncome: v })}
                placeholder="소득이 7천만 이하인 쪽"
              />
              <p className={cx("mt-1 text-[11.5px] leading-snug", h.newlywed ? "text-ink-3" : "text-suspect")}>
                {h.newlywed
                  ? "합산소득이 신혼 기준(8,500만·1자녀 9천만·2자녀 이상 1억)을 넘어도 한 명이 7천만 이하면 그 사람 명의로 보금자리론을 받을 수 있습니다(2026-10-19 신청분부터). 이때 DTI는 그 한 명의 소득으로 봅니다."
                  : "부부 중 한 명 7천만 기준은 신혼가구(혼인 7년 이내·3개월 내 결혼 예정)만 쓸 수 있습니다. 해당되면 위의 '신혼'을 켜세요."}
              </p>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <MoneyField id="cash" label="보유 현금" value={h.cash} onChange={(v) => setH({ cash: v ?? 0 })} placeholder="0" />
            <MoneyField id="debt" label="기존 대출 연 원리금" value={h.existingAnnualDebtPayment} onChange={(v) => setH({ existingAnnualDebtPayment: v ?? 0 })} placeholder="0" />
          </div>
          <MoneyField id="net-assets" label="순자산(선택)" value={h.netAssets} onChange={(v) => setH({ netAssets: v })} placeholder="모르면 비워 두세요" />
        </Section>

        <Section title="대출" icon={<Banknote className="size-4" aria-hidden />}>
          <Switch
            checked={l.autoRates}
            onChange={(v) => setL({ autoRates: v })}
            label="현행 공시 금리 자동 적용"
            description={
              meta.loanInfo
                ? `${new Date(meta.loanInfo.fetchedAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}에 주택금융공사·주택도시기금·은행연합회 공시를 가져왔습니다. 소득·만기에 맞는 금리를 쓰고, 끄면 아래 금리를 직접 넣습니다.`
                : "아직 현행 금리를 가져오지 못했습니다. 상단 규정 기준일에서 다시 가져오기를 누르세요."
            }
          />
          <ul className="space-y-2">
            {meta.loanProducts.map((p) => {
              const on = l.products.includes(p.id);
              const current = live[p.id];
              return (
                <li key={p.id} className={cx("rounded-control border p-2.5", on ? "border-line-strong bg-surface" : "border-line bg-surface-2")}>
                  <div className="flex items-center gap-2">
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-[13px] font-semibold text-ink">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) =>
                          setL({ products: e.target.checked ? [...l.products, p.id] : l.products.filter((x) => x !== p.id) })
                        }
                      />
                      {p.name}
                    </label>
                    <div className="w-[88px]">
                      {l.autoRates && current ? (
                        <p
                          aria-label={`${p.name} 현행 금리 ${current.rate.toFixed(2)}%`}
                          className={cx(controlClass, "flex items-center justify-end bg-surface-2 font-semibold text-ink-2 tnum")}
                        >
                          {current.rate.toFixed(2)}%
                        </p>
                      ) : (
                        <NumberInput
                          ariaLabel={`${p.name} 금리(%)`}
                          value={l.rates[p.id]}
                          onChange={(v) => setL({ rates: { ...l.rates, [p.id]: v ?? p.defaultRate } })}
                          scale={1}
                          step={0.05}
                          min={0}
                          unit="%"
                          placeholder={String(p.defaultRate)}
                        />
                      )}
                    </div>
                  </div>
                  <p className="mt-1 pl-6 text-[11.5px] leading-snug text-ink-3">{p.description}</p>
                  {current ? (
                    <p className="mt-0.5 pl-6 text-[11px] leading-snug text-ink-4">
                      현행 {current.rate.toFixed(2)}% ·{" "}
                      <a href={current.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-ink-2">
                        {current.basis}
                      </a>
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div>
            <FieldLabel>은행 금리유형</FieldLabel>
            <Segmented ariaLabel="은행 금리유형" size="sm" value={l.bankRateType} onChange={(v) => setL({ bankRateType: v })} options={RATE_TYPES} />
            <p className="mt-1 text-[11.5px] text-ink-3">스트레스 DSR 가산금리가 유형별로 달라 한도가 바뀝니다.</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <FieldLabel htmlFor="term">만기</FieldLabel>
              <select id="term" className={controlClass} value={l.termYears} onChange={(e) => setL({ termYears: Number(e.target.value) })}>
                {(TERM_OPTIONS.includes(l.termYears) ? TERM_OPTIONS : [...TERM_OPTIONS, l.termYears].sort((a, b) => a - b)).map((t) => (
                  <option key={t} value={t}>
                    {t}년
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel htmlFor="bank-cap" hint={l.bankSelfCap ? `= ${formatWon(l.bankSelfCap)}` : undefined}>
                은행 자체 한도(선택)
              </FieldLabel>
              <NumberInput id="bank-cap" value={l.bankSelfCap} onChange={(v) => setL({ bankSelfCap: v })} scale={EOK} step={0.1} min={0} unit="억" placeholder="예: KB 3억" />
            </div>
          </div>
          <Switch
            checked={l.useMciMcg}
            onChange={(v) => setL({ useMciMcg: v })}
            label="은행이 MCI·MCG를 받아 줌(은행 주담대 방공제 면제)"
            description="방공제는 최우선변제금(서울 5,500만·경기 과밀억제권역·용인 4,800만 등)을 한도에서 빼는 것입니다. 2026년 5~7월부터 국민·신한·하나·농협 등 대형 은행 대부분이 MCI·MCG 가입을 막아 수도권 은행 주담대는 방공제가 붙는 경우가 많고, iM·SC제일·경남 등 일부만 다시 받습니다. 보금자리론 아파트는 원래 방공제가 없고, 디딤돌 수도권 아파트는 생애최초여도 방공제가 의무입니다."
          />
        </Section>

        <Section title="세안고 필터" icon={<ShieldCheck className="size-4" aria-hidden />}>
          <Segmented ariaLabel="세안고 처리 방식" value={c.seango.mode} onChange={(v) => setS({ mode: v })} options={SEANGO_MODES} />
          <fieldset>
            <legend className="mb-1 text-xs font-medium text-ink-2">판정 기준</legend>
            <div className="space-y-1">
              {STRICTNESS.map((s) => (
                <label
                  key={s.value}
                  className={cx(
                    "flex cursor-pointer items-start gap-2 rounded-control px-2.5 py-2",
                    c.seango.strictness === s.value ? "bg-brand-50" : "hover:bg-surface-2",
                  )}
                >
                  <input
                    type="radio"
                    name="strictness"
                    className="mt-0.5"
                    checked={c.seango.strictness === s.value}
                    onChange={() => setS({ strictness: s.value })}
                  />
                  <span>
                    <span className="block text-[13px] font-semibold text-ink">{s.label}</span>
                    <span className="block text-[11.5px] leading-snug text-ink-3">{s.help}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <FieldLabel htmlFor="movein-months" hint={c.seango.acceptMoveInWithinMonths === 0 ? "즉시입주만" : `${c.seango.acceptMoveInWithinMonths}개월 이내`}>
              N개월 이내 입주 가능하면 포함
            </FieldLabel>
            <Slider
              id="movein-months"
              min={0}
              max={12}
              value={c.seango.acceptMoveInWithinMonths}
              onChange={(v) => setS({ acceptMoveInWithinMonths: v })}
            />
          </div>
        </Section>

        <Section title="정렬·가중치" icon={<SlidersHorizontal className="size-4" aria-hidden />}>
          <div>
            <FieldLabel htmlFor="sort">정렬 기준</FieldLabel>
            <select id="sort" className={controlClass} value={c.sortBy} onChange={(e) => set({ sortBy: e.target.value as SearchConditions["sortBy"] })}>
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <p className="flex items-baseline justify-between text-xs font-medium text-ink-2">
              종합점수 가중치
              <span className="text-[11px] font-normal text-ink-4">%는 점수에서 차지하는 비중</span>
            </p>
            {WEIGHT_LABELS.map((w) => (
              <div key={w.key} className="grid grid-cols-[72px_1fr_52px] items-center gap-2">
                <label htmlFor={`weight-${w.key}`} className="text-xs text-ink-2">
                  {w.label}
                </label>
                <Slider id={`weight-${w.key}`} min={0} max={5} value={weightOf(w.key)} onChange={(v) => setW({ [w.key]: v })} />
                <span className="text-right text-xs font-semibold text-ink tnum">
                  {weightOf(w.key)}
                  <span className="ml-1 inline-block w-7 text-[11px] font-normal text-ink-4">{shareOf(w.key)}%</span>
                </span>
              </div>
            ))}
            {stationLines.length > 0 ? (
              <details className="group rounded-control border border-line px-2.5 py-2">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-ink-2">
                  역세권에서 뺄 노선
                  <span className="ml-auto truncate text-[11px] font-normal text-ink-4">
                    {excluded.length > 0 ? `${excluded.map(lineLabel).join("·")} 뺌` : "모든 노선 포함"}
                  </span>
                  <ChevronDown className="size-3.5 shrink-0 text-ink-4 transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {stationLines.map((line) => (
                    <Chip
                      key={line}
                      active={excluded.includes(line)}
                      ariaLabel={`${lineLabel(line)} ${excluded.includes(line) ? "다시 포함" : "역세권에서 빼기"}`}
                      onClick={() => toggleLine(line)}
                    >
                      {lineLabel(line)}
                    </Chip>
                  ))}
                </div>
                <p className="mt-1.5 text-[11.5px] leading-snug text-ink-3">
                  고른 노선만 지나는 역은 없는 것으로 보고 다음으로 가까운 역으로 계산합니다. 환승역은 남은 노선만 셉니다.
                </p>
              </details>
            ) : null}
            <p className="text-[11.5px] leading-snug text-ink-3">
              정렬과 가중치는 바꾸면 바로 다시 검색합니다. 종합점수는 항목별 점수를 % 비중대로 섞은 값이라, 가중치 5인 항목이 0점이어도 다른 항목 점수가 높으면 위에 올 수 있습니다.
            </p>
            <p className="text-[11.5px] leading-snug text-ink-3">
              역세권은 가장 가까운 지하철·전철역까지 거리(300m 이내 만점, 1.5km 0점, 환승역 가산), 재개발 호재는 준공 연식(재건축 연한 30년)·용적률·1기 신도시(노후계획도시 특별법) 여부, 학군은 가장 가까운 초등학교·중학교까지 거리로 계산합니다. 연식은 새 아파트일수록, 재개발 호재는 오래된 아파트일수록 높아서 둘을 같이 올리면 서로 깎아 먹습니다.
            </p>
          </div>
          <Switch checked={c.onlyAffordable} onChange={(v) => set({ onlyAffordable: v })} label="보유현금 안에서 가능한 매물만" />
          <div>
            <FieldLabel htmlFor="limit">표시 개수</FieldLabel>
            <select id="limit" className={controlClass} value={c.limit} onChange={(e) => set({ limit: Number(e.target.value) })}>
              {(LIMIT_OPTIONS.includes(c.limit) ? LIMIT_OPTIONS : [...LIMIT_OPTIONS, c.limit].sort((a, b) => a - b)).map((n) => (
                <option key={n} value={n}>
                  최대 {n}건
                </option>
              ))}
            </select>
          </div>
        </Section>
      </div>

      <div className="border-t border-line bg-surface px-4 py-3">
        <button
          type="submit"
          disabled={loading}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-control bg-brand-600 text-sm font-bold text-white shadow-card transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-70"
        >
          {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Search className="size-4" aria-hidden />}
          {loading ? "검색 중" : "검색"}
        </button>
        <p className="mt-1.5 h-4 text-center text-[11.5px] text-ink-3" aria-live="polite">
          {dirty && !loading ? "조건이 바뀌었습니다. 검색을 눌러 반영하세요." : ""}
        </p>
      </div>
    </form>
  );
}
