"use client";
// 입력 폼·배지 등 공용 UI 프리미티브(토큰 기반 스타일)
import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export const controlClass =
  "h-9 w-full rounded-control border border-line bg-surface px-2.5 text-sm text-ink tnum placeholder:text-ink-4 hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500 disabled:bg-surface-3 disabled:text-ink-4";

export function Section({
  title,
  icon,
  children,
  defaultOpen = true,
  aside,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  aside?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className="border-b border-line px-4 py-3.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-2 rounded-control text-left text-[13px] font-semibold text-ink focus-visible:outline-2 focus-visible:outline-brand-500"
        >
          <span className="text-ink-3">{icon}</span>
          {title}
          <ChevronDown aria-hidden className={cx("ml-auto size-4 text-ink-4 transition-transform", open && "rotate-180")} />
        </button>
        {aside}
      </div>
      <div id={id} hidden={!open} className="mt-3 space-y-3">
        {children}
      </div>
    </section>
  );
}

export function FieldLabel({ htmlFor, children, hint }: { htmlFor?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-1 flex items-baseline justify-between gap-2">
      <label htmlFor={htmlFor} className="text-xs font-medium text-ink-2">
        {children}
      </label>
      {hint ? <span className="text-[11px] text-ink-4 tnum">{hint}</span> : null}
    </div>
  );
}

function formatScaled(value: number | null, scale: number): string {
  if (value === null) return "";
  return String(Math.round((value / scale) * 1000) / 1000);
}

function parseScaled(draft: string, scale: number): number | null {
  const t = draft.trim().replace(/,/g, "");
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  const v = n * scale;
  return scale >= 100 ? Math.round(v) : Math.round(v * 1000) / 1000;
}

/** 단위 환산 숫자 입력. value는 기본 단위(원·㎡ 등), 화면에는 value/scale을 보여준다 */
export function NumberInput({
  id,
  value,
  onChange,
  scale = 1,
  step,
  min,
  max,
  unit,
  placeholder = "제한 없음",
  ariaLabel,
}: {
  id?: string;
  value: number | null;
  onChange: (v: number | null) => void;
  scale?: number;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(() => formatScaled(value, scale));
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    if (parseScaled(draft, scale) !== value) setDraft(formatScaled(value, scale));
  }
  return (
    <div className="relative">
      <input
        id={id}
        type="number"
        inputMode="decimal"
        aria-label={ariaLabel}
        className={cx(controlClass, unit && "pr-9")}
        value={draft}
        step={step}
        min={min}
        max={max}
        placeholder={placeholder}
        onChange={(e) => {
          setDraft(e.target.value);
          const parsed = parseScaled(e.target.value, scale);
          if (e.target.value.trim() === "" || parsed !== null) onChange(parsed);
        }}
      />
      {unit ? (
        <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-ink-4">{unit}</span>
      ) : null}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block cursor-pointer text-[13px] text-ink">
          {label}
        </label>
        {description ? <p className="mt-0.5 text-[11.5px] leading-snug text-ink-3">{description}</p> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
          checked ? "bg-brand-600" : "bg-line-strong",
        )}
      >
        <span
          aria-hidden
          className={cx(
            "inline-block size-4 rounded-full bg-surface shadow-card transition-transform",
            checked ? "translate-x-[18px]" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  size = "md",
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  ariaLabel: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex rounded-control bg-surface-3 p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cx(
              "flex-1 rounded-[0.4rem] px-2 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand-500",
              size === "sm" ? "h-7 text-xs" : "h-8 text-[13px]",
              active ? "bg-surface text-ink shadow-card" : "text-ink-3 hover:text-ink",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Chip({
  active,
  onClick,
  children,
  ariaLabel,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={ariaLabel}
      onClick={onClick}
      className={cx(
        "h-7 rounded-full px-2.5 text-xs font-medium tnum transition-colors focus-visible:outline-2 focus-visible:outline-brand-500",
        active ? "bg-brand-600 text-white" : "bg-surface-3 text-ink-2 hover:bg-line",
      )}
    >
      {children}
    </button>
  );
}

export function Slider({
  id,
  value,
  min,
  max,
  step = 1,
  onChange,
  ariaLabel,
  disabled,
}: {
  id?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  return (
    <input
      id={id}
      type="range"
      aria-label={ariaLabel}
      className="h-5 w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

export function Badge({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className={cx("inline-flex h-[22px] items-center gap-1 rounded-full px-2 text-[11.5px] font-semibold", className)}>
      {children}
    </span>
  );
}
