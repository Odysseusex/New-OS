"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { LOYALTY_SEGMENT_LABELS_RU, LoyaltySegment } from "@bakery-os/shared";

// Small building blocks of the CRM's look. Colours are always token names
// (green, orange…) resolved by crm.css, never hex values here.

export type Tone = "gray" | "green" | "orange" | "blue" | "purple" | "yellow" | "red" | "pink";

const WHEAT =
  "M12 21V7M12 7c-1.8-.8-2.6-2.4-2.6-4.2 1.8.3 2.6 1.9 2.6 4.2zM12 7c1.8-.8 2.6-2.4 2.6-4.2-1.8.3-2.6 1.9-2.6 4.2zM12 12c-2.3-.4-3.6-2.2-3.6-4.2 2.3.2 3.6 2 3.6 4.2zM12 12c2.3-.4 3.6-2.2 3.6-4.2-2.3.2-3.6 2-3.6 4.2zM12 17c-2.3-.4-3.6-2.2-3.6-4.2 2.3.2 3.6 2 3.6 4.2zM12 17c2.3-.4 3.6-2.2 3.6-4.2-2.3.2-3.6 2-3.6 4.2z";

export function WheatIcon({ size = 16, strokeWidth = 1.9 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" aria-hidden="true">
      <path d={WHEAT} />
    </svg>
  );
}

// Soft pastel avatars, picked by the name so a person always gets the same one.
const AVATAR_COLORS = ["#F6D2B4", "#BFDDEE", "#CDE6C8", "#F2C9D6", "#EEDDAF", "#D9C7F0", "#C9E4E0", "#F0CFC0"];

export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "•";
  return (parts[0][0] + (parts[1] && /[A-Za-zА-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі]/.test(parts[1][0]) ? parts[1][0] : "")).toUpperCase();
}

export function Avatar({ name, size = 22 }: { name: string | null | undefined; size?: number }) {
  const key = name ?? "";
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span className="crm-av" style={{ width: size, height: size, fontSize: Math.max(9, size * 0.42), background: AVATAR_COLORS[hash % AVATAR_COLORS.length] }}>
      {initials(name)}
    </span>
  );
}

export function Tag({ tone, children, dot = true, style }: { tone: Tone; children: React.ReactNode; dot?: boolean; style?: React.CSSProperties }) {
  return (
    <span className="crm-tag" style={{ background: `var(--${tone}-bg)`, ...style }}>
      {dot && <span className="crm-dot" style={{ background: `var(--${tone})` }} />}
      {children}
    </span>
  );
}

export const SEGMENT_TONES: Record<LoyaltySegment, Tone> = {
  [LoyaltySegment.CHAMPIONS]: "yellow",
  [LoyaltySegment.LOYAL]: "green",
  [LoyaltySegment.RECENT]: "blue",
  [LoyaltySegment.NEEDS_ATTENTION]: "orange",
  [LoyaltySegment.AT_RISK]: "red",
  [LoyaltySegment.INACTIVE]: "gray",
};

export function SegmentTag({ segment }: { segment: LoyaltySegment | null }) {
  if (!segment) return null;
  return <Tag tone={SEGMENT_TONES[segment]}>{LOYALTY_SEGMENT_LABELS_RU[segment]}</Tag>;
}

export function PageHeader({ icon, tone, title, subtitle, children }: { icon: React.ReactNode; tone: Tone; title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <header style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <span className="crm-icon-hero" style={{ background: `var(--${tone}-bg)`, color: `var(--${tone})` }}>
        {icon}
      </span>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
        <h1 className="crm-h1">{title}</h1>
        {subtitle && <span className="muted" style={{ fontSize: 16 }}>{subtitle}</span>}
        {children && <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>{children}</span>}
      </div>
    </header>
  );
}

// A custom modal inside the CRM: Escape is caught in the capture phase so a
// dropdown inside never lets the document listener close the whole form.
export function CrmModal({ title, onClose, children, footer, width = 560 }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="crm-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="crm-modal" role="dialog" aria-modal="true" style={{ maxWidth: width }}>
        <div className="crm-modal-head">
          <h2 className="crm-h2" style={{ flex: 1, minWidth: 0 }}>
            {title}
          </h2>
          <button type="button" className="crm-ib" onClick={onClose} aria-label="Закрыть">
            <X size={16} />
          </button>
        </div>
        <div className="crm-modal-body">{children}</div>
        {footer && <div className="crm-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="crm-error" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <span style={{ flex: 1 }}>{message}</span>
      {onRetry && (
        <button type="button" className="crm-btn sm" onClick={onRetry}>
          Повторить
        </button>
      )}
    </div>
  );
}

export function Skeleton({ height, style }: { height: number; style?: React.CSSProperties }) {
  return <div className="crm-skeleton" style={{ height, ...style }} />;
}

// ── formatting ────────────────────────────────────────────────────────────

export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

export const daysWord = (n: number) => plural(n, "день", "дня", "дней");

export function everyDays(n: number | null): string | null {
  if (n === null) return null;
  if (n === 1) return "каждый день";
  if (n === 7) return "раз в неделю";
  return `раз в ${n} ${daysWord(n)}`;
}

export function agoDays(n: number | null): string {
  if (n === null) return "—";
  if (n === 0) return "сегодня";
  if (n === 1) return "вчера";
  return `${n} ${plural(n, "день", "дня", "дней")} назад`;
}

const dayMonth = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "Asia/Almaty" });
const dayMonthShort = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "Asia/Almaty" });
const timeOnly = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Almaty" });
const weekdayLong = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Almaty" });

export const fmtDayMonth = (iso: string) => dayMonth.format(new Date(iso));
export const fmtDayMonthShort = (iso: string) => dayMonthShort.format(new Date(iso)).replace(".", "");
export const fmtTime = (iso: string) => timeOnly.format(new Date(iso));
export const fmtToday = () => weekdayLong.format(new Date());
// "YYYY-MM-DD" (already an Almaty calendar day) → «29 октября».
export const fmtDayKey = (key: string) => dayMonth.format(new Date(`${key}T12:00:00+05:00`));

export function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const key = (x: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty" }).format(x);
  const today = key(new Date());
  const yesterday = key(new Date(Date.now() - 86_400_000));
  if (key(d) === today) return `сегодня, ${fmtTime(iso)}`;
  if (key(d) === yesterday) return `вчера, ${fmtTime(iso)}`;
  return `${fmtDayMonthShort(iso)}, ${fmtTime(iso)}`;
}

const money = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
export const fmtMoney = (v: number) => `${money.format(Math.round(v))} ₸`;

export function fmtPhone(phone: string | null): string {
  if (!phone) return "";
  const m = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return m ? `+7 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : phone;
}

// Opens the person's chat in WhatsApp (the app on a phone, WhatsApp Web on a
// computer) with the text already typed — works without any API account.
export function whatsappLink(phone: string, text: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

export const telLink = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;
