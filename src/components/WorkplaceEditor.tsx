"use client";
// 직장(통근 목적지) 1~5곳 편집: 장소 자동완성, 출근 비중, 지도에서 찍기
import { useEffect, useId, useRef, useState } from "react";
import { Building2, Crosshair, Loader2, MapPin, Search, X } from "lucide-react";
import type { PlaceSuggestion, Workplace } from "@/lib/types";
import { api, errorMessage, isAbort } from "./api";
import { controlClass, cx } from "./ui";

export const MAX_WORKPLACES = 5;

export function newWorkplaceId(): string {
  return `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function PlaceSearch({ onPick, disabled }: { onPick: (p: PlaceSuggestion) => void; disabled: boolean }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const term = q.trim();

  useEffect(() => {
    if (term.length < 1) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      api
        .places(term, ctrl.signal)
        .then((r) => {
          setItems(r.items);
          setError(null);
          setActive(0);
          setLoading(false);
        })
        .catch((e: unknown) => {
          if (isAbort(e)) return;
          setError(errorMessage(e));
          setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [term]);

  const shown = term.length > 0 ? items : [];
  const pick = (p: PlaceSuggestion) => {
    onPick(p);
    setQ("");
    setItems([]);
    setOpen(false);
  };

  return (
    <div className="relative">
      <Search aria-hidden className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-ink-4" />
      <input
        type="search"
        role="combobox"
        aria-label="직장 검색"
        aria-expanded={open && shown.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        disabled={disabled}
        placeholder={disabled ? "직장은 최대 5곳까지 넣을 수 있습니다." : "역·회사·동네 이름으로 직장 추가"}
        className={cx(controlClass, "pl-8")}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!shown.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => (a + 1) % shown.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a - 1 + shown.length) % shown.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(shown[Math.min(active, shown.length - 1)]);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {loading ? <Loader2 aria-hidden className="absolute top-2.5 right-2.5 size-4 animate-spin text-ink-4" /> : null}
      {open && term.length > 0 && (shown.length > 0 || error || !loading) ? (
        <ul
          id={listId}
          role="listbox"
          className="scroll-thin absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-control border border-line bg-surface py-1 shadow-pop"
        >
          {error ? <li className="px-3 py-2 text-xs text-seango">{error}</li> : null}
          {!error && shown.length === 0 && !loading ? (
            <li className="px-3 py-2 text-xs text-ink-3">검색 결과가 없습니다. 지도에서 직접 찍을 수도 있습니다.</li>
          ) : null}
          {shown.map((p, i) => (
            <li
              key={`${p.label}-${p.location.lat}-${p.location.lng}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(p)}
              onMouseEnter={() => setActive(i)}
              className={cx("flex w-full cursor-pointer items-start gap-2 px-3 py-2 text-left", i === active ? "bg-brand-50" : "hover:bg-surface-2")}
            >
              {p.kind === "station" ? (
                <MapPin aria-hidden className="mt-0.5 size-3.5 shrink-0 text-brand-600" />
              ) : (
                <Building2 aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ink-3" />
              )}
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-ink">{p.label}</span>
                {p.detail ? <span className="block truncate text-[11.5px] text-ink-3">{p.detail}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default function WorkplaceEditor({
  workplaces,
  onChange,
  pickMode,
  onPickModeChange,
  focusId,
}: {
  workplaces: Workplace[];
  onChange: (w: Workplace[]) => void;
  pickMode: boolean;
  onPickModeChange: (v: boolean) => void;
  focusId: string | null;
}) {
  const full = workplaces.length >= MAX_WORKPLACES;
  const focusRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (focusId) focusRef.current?.select();
  }, [focusId]);

  const update = (id: string, patch: Partial<Workplace>) =>
    onChange(workplaces.map((w) => (w.id === id ? { ...w, ...patch } : w)));

  return (
    <div className="space-y-2">
      {workplaces.length === 0 ? (
        <p className="rounded-control bg-surface-2 px-3 py-2 text-xs text-ink-3">직장을 넣으면 통근시간과 경로가 계산됩니다.</p>
      ) : null}
      <ol className="space-y-2">
        {workplaces.map((w, i) => (
          <li key={w.id} className="rounded-control border border-line bg-surface p-2">
            <div className="flex items-center gap-2">
              <span className="grid size-5 shrink-0 place-items-center rounded-[5px] bg-brand-900 text-[11px] font-bold text-white tnum">
                {i + 1}
              </span>
              <input
                ref={w.id === focusId ? focusRef : undefined}
                aria-label={`직장 ${i + 1} 이름`}
                className="h-7 min-w-0 flex-1 rounded-[0.35rem] border border-transparent bg-transparent px-1.5 text-[13px] font-medium text-ink hover:border-line focus-visible:border-line-strong focus-visible:outline-2 focus-visible:outline-brand-500"
                value={w.label}
                onChange={(e) => update(w.id, { label: e.target.value })}
              />
              <button
                type="button"
                aria-label={`${w.label} 삭제`}
                onClick={() => onChange(workplaces.filter((x) => x.id !== w.id))}
                className="grid size-7 place-items-center rounded-control text-ink-4 hover:bg-surface-3 hover:text-ink focus-visible:outline-2 focus-visible:outline-brand-500"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
            <div className="mt-1.5 flex items-center gap-2 pl-7">
              <span className="text-[11.5px] text-ink-3" id={`${w.id}-wlabel`}>
                출근 비중
              </span>
              <div role="radiogroup" aria-labelledby={`${w.id}-wlabel`} className="flex gap-0.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={w.weight === n}
                    aria-label={`비중 ${n}`}
                    onClick={() => update(w.id, { weight: n })}
                    className={cx(
                      "size-6 rounded-[0.35rem] text-[11.5px] font-semibold tnum focus-visible:outline-2 focus-visible:outline-brand-500",
                      w.weight === n ? "bg-brand-600 text-white" : "bg-surface-3 text-ink-3 hover:bg-line",
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <span className="ml-auto text-[11px] text-ink-4 tnum">
                {w.location.lat.toFixed(3)}, {w.location.lng.toFixed(3)}
              </span>
            </div>
          </li>
        ))}
      </ol>
      <PlaceSearch
        disabled={full}
        onPick={(p) =>
          onChange([...workplaces, { id: newWorkplaceId(), label: p.label, location: p.location, weight: 1 }])
        }
      />
      <button
        type="button"
        aria-pressed={pickMode}
        disabled={full && !pickMode}
        onClick={() => onPickModeChange(!pickMode)}
        className={cx(
          "flex h-8 w-full items-center justify-center gap-1.5 rounded-control text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-50",
          pickMode ? "bg-brand-600 text-white" : "bg-brand-50 text-brand-700 hover:bg-brand-100",
        )}
      >
        <Crosshair className="size-3.5" aria-hidden />
        {pickMode ? "지도를 클릭해 직장 위치를 찍으세요(취소)" : "지도에서 찍기"}
      </button>
    </div>
  );
}
