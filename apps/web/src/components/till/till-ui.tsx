"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import { Banknote, CreditCard, LayoutGrid, LogOut, Minus, Plus, Split, Trash2 } from "lucide-react";

// The till's own look (coral, white cards, big photos): the building blocks of /pos. Colours come
// from the `.till-theme` tokens in globals.css, so every window opened over the till follows too.

// A picture for a category that has no photo of its own, picked from its name.
const CATEGORY_EMOJI: [RegExp, string][] = [
  [/торт/i, "🎂"],
  [/пирож|десерт|кондитер|сладк/i, "🍰"],
  [/пирог|пицц/i, "🥧"],
  [/самс|кулинар|салат|горяч|обед/i, "🥟"],
  [/круасс|выпеч|слоён|слоен/i, "🥐"],
  [/булоч|бриош|пончик|донат/i, "🥯"],
  [/хлеб|батон|багет|лепёш|лепеш/i, "🍞"],
  [/печень|пряник|кекс|маффин/i, "🍪"],
  [/напит|кофе|чай|сок|вода/i, "☕"],
];
export function categoryEmoji(name: string | null | undefined): string {
  if (!name) return "🧺";
  return CATEGORY_EMOJI.find(([re]) => re.test(name))?.[1] ?? "🧺";
}

export function TillRailButton({
  icon: Icon,
  label,
  active,
  onClick,
  dot,
  title,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick?: () => void;
  dot?: "ok" | "bad";
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      className={clsx(
        "relative flex w-[4.5rem] flex-col items-center gap-1 rounded-2xl px-1 py-2.5 text-[0.6875rem] font-semibold leading-tight transition",
        active ? "bg-[var(--accent-soft)] text-accent" : "text-muted hover:bg-surface-muted hover:text-foreground",
      )}
    >
      <Icon className="h-[1.375rem] w-[1.375rem]" strokeWidth={1.75} />
      <span className="text-center">{label}</span>
      {dot && (
        <span
          className={clsx("absolute right-3 top-2 h-2 w-2 rounded-full ring-2 ring-surface", dot === "ok" ? "bg-emerald-500" : "bg-red-500")}
          aria-hidden
        />
      )}
    </button>
  );
}

export function TillRail({
  children,
  footer,
  homeHref,
  onLogout,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
  homeHref?: string | null;
  onLogout: () => void;
}) {
  return (
    <aside className="flex shrink-0 flex-row items-center gap-1 overflow-x-auto border-b border-border bg-surface px-2 py-2 lg:h-full lg:w-[6rem] lg:flex-col lg:overflow-visible lg:border-b-0 lg:border-r lg:px-0 lg:py-5">
      <div className="hidden h-11 w-11 place-items-center rounded-2xl bg-accent text-lg font-bold text-accent-foreground lg:mb-5 lg:grid">A</div>
      <TillRailButton icon={LayoutGrid} label="Касса" active />
      {children}
      <div className="flex-1" />
      {footer}
      {homeHref && (
        <Link
          href={homeHref}
          title="Вернуться в ArAmir OS"
          className="flex w-[4.5rem] flex-col items-center gap-1 rounded-2xl px-1 py-2.5 text-[0.6875rem] font-semibold leading-tight text-muted transition hover:bg-surface-muted hover:text-foreground"
        >
          <LayoutGrid className="h-[1.375rem] w-[1.375rem] rotate-45" strokeWidth={1.75} />
          В систему
        </Link>
      )}
      <TillRailButton icon={LogOut} label="Выйти" onClick={onLogout} />
    </aside>
  );
}

// A small floating panel under a rail button (scale, customer screen…).
export function TillPopover({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const t = setTimeout(() => document.addEventListener("pointerdown", onDown), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      ref={ref}
      className="fixed bottom-6 left-[6.75rem] z-40 w-72 rounded-3xl border border-border bg-surface p-4 shadow-[0_20px_50px_rgba(16,24,40,0.16)]"
    >
      {children}
    </div>
  );
}

export function CategoryCard({
  emoji,
  name,
  count,
  active,
  onClick,
}: {
  emoji: string;
  name: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "flex h-[7.5rem] w-[8.75rem] shrink-0 flex-col items-center justify-center gap-0.5 rounded-[1.125rem] border bg-surface px-2 transition active:scale-[0.98]",
        active ? "border-accent bg-[var(--accent-soft)] ring-1 ring-accent" : "border-border hover:border-[var(--border-strong)]",
      )}
    >
      <span className="mb-2 text-[2.125rem] leading-none" aria-hidden>
        {emoji}
      </span>
      <span className={clsx("line-clamp-1 text-[0.9375rem] font-semibold", active ? "text-accent" : "text-foreground")}>{name}</span>
      <span className={clsx("text-xs", active ? "text-accent" : "text-muted")}>{countLabel(count)}</span>
    </button>
  );
}

function countLabel(n: number) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = mod10 === 1 && mod100 !== 11 ? "товар" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "товара" : "товаров";
  return `${n} ${word}`;
}

export function ProductCard({
  name,
  photo,
  photoSlot,
  emoji,
  price,
  oldPrice,
  unit,
  meta,
  inCart,
  badge,
  onClick,
}: {
  name: string;
  photo: string | null;
  // Keep the picture's place even without a photo (some cards on screen have one), so rows line up.
  photoSlot?: boolean;
  emoji?: string;
  price: string;
  oldPrice?: string | null;
  unit: string;
  meta?: React.ReactNode;
  inCart: string | null;
  badge?: string | null;
  pinned?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "group relative flex flex-col overflow-hidden rounded-[1.125rem] border text-left shadow-[0_1px_3px_rgba(16,24,40,0.05)] transition active:scale-[0.985]",
        "bg-surface",
        inCart ? "border-[var(--accent-line)] ring-1 ring-[var(--accent-line)]" : "border-border hover:border-[var(--border-strong)]",
      )}
    >
      {photo ? (
        <div className="aspect-[16/10] w-full overflow-hidden bg-surface-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo} alt="" loading="lazy" className="h-full w-full object-cover" />
        </div>
      ) : (
        photoSlot && (
          <div className="grid aspect-[16/10] w-full place-items-center bg-surface-muted text-[2.75rem]" aria-hidden>
            <span className="opacity-80">{emoji ?? "🧺"}</span>
          </div>
        )
      )}
      <div className={clsx("flex flex-1 flex-col px-4 pb-4", photo || photoSlot ? "pt-3.5" : "pt-4", !photo && !photoSlot && (inCart || badge) && "pr-24")}>
        <span className="line-clamp-2 text-[1.0625rem] font-semibold leading-snug text-foreground">{name}</span>
        {meta && <span className="mt-1 flex flex-wrap items-center gap-x-2 text-[0.8125rem] text-muted">{meta}</span>}
        <span className="mt-auto flex flex-wrap items-baseline gap-x-2 pt-3">
          <span className="whitespace-nowrap text-[1.375rem] font-semibold leading-none tracking-tight text-foreground">{price}</span>
          {oldPrice && <s className="text-sm text-muted">{oldPrice}</s>}
          <span className="whitespace-nowrap text-[0.8125rem] text-muted">/ {unit}</span>
        </span>
      </div>
      {badge && (
        <span className="absolute left-3 top-3 rounded-full bg-[#2f62f0] px-2.5 py-1 text-xs font-semibold text-white">{badge}</span>
      )}
      {inCart && (
        <span className="absolute right-3 top-3 rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-accent-foreground shadow-[0_4px_12px_rgba(236,90,54,0.35)]">
          {inCart}
        </span>
      )}
    </button>
  );
}

export function QtyStepper({
  value,
  onMinus,
  onPlus,
  label,
}: {
  value: string;
  onMinus: () => void;
  onPlus: () => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onMinus}
        aria-label={`Меньше: ${label}`}
        className="grid h-9 w-9 place-items-center rounded-[0.625rem] border border-border text-accent transition hover:bg-surface-muted active:scale-95"
      >
        <Minus className="h-4 w-4" strokeWidth={2.4} />
      </button>
      <span className="min-w-[2.5rem] text-center text-base font-semibold tabular-nums text-foreground">{value}</span>
      <button
        type="button"
        onClick={onPlus}
        aria-label={`Больше: ${label}`}
        className="grid h-9 w-9 place-items-center rounded-[0.625rem] bg-accent text-accent-foreground transition hover:opacity-90 active:scale-95"
      >
        <Plus className="h-4 w-4" strokeWidth={2.4} />
      </button>
    </div>
  );
}

export function CheckLine({
  name,
  photo,
  emoji,
  sub,
  chips,
  qty,
  price,
  oldPrice,
  onMinus,
  onPlus,
  onRemove,
}: {
  name: string;
  photo: string | null;
  emoji: string;
  sub: string | null;
  chips?: React.ReactNode;
  qty: string;
  price: string;
  oldPrice?: string | null;
  onMinus: () => void;
  onPlus: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-4 border-b border-border py-3.5 last:border-b-0 [@media(max-height:820px)]:gap-3 [@media(max-height:820px)]:py-2.5">
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt="" className="h-[4.75rem] w-[4.75rem] shrink-0 rounded-2xl object-cover [@media(max-height:820px)]:h-14 [@media(max-height:820px)]:w-14" />
      ) : (
        <div className="grid h-[4.75rem] w-[4.75rem] shrink-0 place-items-center rounded-2xl bg-surface-muted text-[1.75rem] [@media(max-height:820px)]:h-14 [@media(max-height:820px)]:w-14 [@media(max-height:820px)]:text-2xl" aria-hidden>
          {emoji}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">{name}</p>
          <button type="button" onClick={onRemove} aria-label={`Убрать: ${name}`} className="-mr-1 -mt-0.5 shrink-0 rounded-lg p-1 text-muted transition hover:text-red-600">
            <Trash2 className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
        <div className="mt-1 flex min-h-[1.5rem] flex-wrap items-center gap-2">
          {sub && <span className="text-[0.8125rem] text-muted">{sub}</span>}
          {chips}
        </div>
        <div className="mt-2.5 flex items-center justify-between gap-2 [@media(max-height:820px)]:mt-1.5">
          <QtyStepper value={qty} onMinus={onMinus} onPlus={onPlus} label={name} />
          <span className="whitespace-nowrap text-right text-base font-semibold text-accent">
            {oldPrice && <s className="mr-1.5 text-sm font-normal text-muted">{oldPrice}</s>}
            {price}
          </span>
        </div>
      </div>
    </div>
  );
}

// A small rounded label inside a check line (уценка, купон). `on` = in effect.
export function LineChip({ on, onClick, children, tone = "blue" }: { on: boolean; onClick?: () => void; children: React.ReactNode; tone?: "blue" | "accent" }) {
  const cls = clsx(
    "rounded-full px-2.5 py-0.5 text-xs font-semibold transition",
    on ? (tone === "blue" ? "bg-[#eaf0ff] text-[#2f62f0]" : "bg-[var(--accent-soft)] text-accent") : "border border-border text-muted hover:text-foreground",
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={cls}>
      {children}
    </button>
  ) : (
    <span className={cls}>{children}</span>
  );
}

export function ToolButton({
  icon: Icon,
  label,
  on,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  on?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={clsx(
        "grid h-10 w-10 place-items-center rounded-xl border transition disabled:opacity-35",
        on ? "border-accent bg-[var(--accent-soft)] text-accent" : "border-border text-muted hover:bg-surface-muted hover:text-foreground",
      )}
    >
      <Icon className="h-[1.125rem] w-[1.125rem]" strokeWidth={1.75} />
    </button>
  );
}

export type TillPayMode = "cash" | "card" | "mixed";
const PAY_METHODS: { mode: TillPayMode; label: string; icon: LucideIcon }[] = [
  { mode: "cash", label: "Наличные", icon: Banknote },
  { mode: "card", label: "Карта · Kaspi", icon: CreditCard },
  { mode: "mixed", label: "Нал + карта", icon: Split },
];

export function PayMethodCards({ value, onChange, disabled }: { value: TillPayMode; onChange: (m: TillPayMode) => void; disabled?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {PAY_METHODS.map(({ mode, label, icon: Icon }) => (
        <button
          key={mode}
          type="button"
          disabled={disabled}
          onClick={() => onChange(mode)}
          className={clsx(
            "flex h-[5.25rem] flex-col items-center justify-center gap-2 rounded-2xl border text-sm font-semibold transition disabled:opacity-40 [@media(max-height:820px)]:h-14 [@media(max-height:820px)]:flex-row [@media(max-height:820px)]:gap-1.5 [@media(max-height:820px)]:text-[0.8125rem]",
            value === mode ? "border-accent bg-[var(--accent-soft)] text-accent ring-1 ring-accent" : "border-border text-foreground hover:border-[var(--border-strong)]",
          )}
        >
          <Icon className="h-7 w-7 shrink-0 [@media(max-height:820px)]:h-5 [@media(max-height:820px)]:w-5" strokeWidth={1.5} />
          {label}
        </button>
      ))}
    </div>
  );
}

export function useLocalPreference<T extends string>(key: string, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(fallback);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored) setValue(stored as T);
    } catch {
      /* private mode: keep the default */
    }
  }, [key]);
  return [
    value,
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(key, v);
      } catch {
        /* ignore */
      }
    },
  ];
}
