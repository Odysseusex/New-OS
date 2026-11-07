// Formatting for the customer app: Almaty dates, whole points where possible.

const TZ = "Asia/Almaty";

const pointsFmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const moneyFmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const dayFmt = new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, day: "numeric", month: "long" });
const dayTimeFmt = new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
const monthFmt = new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, month: "long", year: "numeric" });
const hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" });

export const fmtPoints = (v: number) => pointsFmt.format(Math.abs(v) >= 100 ? Math.floor(v) : v);
export const fmtMoney = (v: number) => `${moneyFmt.format(v)} ₸`;
export const fmtDay = (iso: string) => dayFmt.format(new Date(iso));
export const fmtDayTime = (iso: string) => dayTimeFmt.format(new Date(iso)).replace(" в ", ", ");
export const fmtMonth = (iso: string) => {
  const s = monthFmt.format(new Date(iso)).replace(" г.", "");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export function bonusWord(n: number): string {
  const v = Math.floor(Math.abs(n));
  const m10 = v % 10;
  const m100 = v % 100;
  if (!Number.isInteger(n)) return "бонуса";
  if (m10 === 1 && m100 !== 11) return "бонус";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "бонуса";
  return "бонусов";
}

export function greeting(now = new Date()): string {
  const h = Number(hourFmt.format(now));
  if (h >= 5 && h < 12) return "Доброе утро";
  if (h >= 12 && h < 18) return "Добрый день";
  if (h >= 18 && h < 23) return "Добрый вечер";
  return "Доброй ночи";
}

// "+77014035832" → "+7 701 403 58 32"
export function prettyPhone(phone: string): string {
  const d = phone.replace(/\D/g, "").slice(-10);
  return `+7 ${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 8)} ${d.slice(8, 10)}`;
}

// What the customer typed → up to 10 national digits.
export function nationalDigits(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.length === 11 && (d.startsWith("7") || d.startsWith("8"))) d = d.slice(1);
  return d.slice(0, 10);
}

export function displayNational(d: string): string {
  return [d.slice(0, 3), d.slice(3, 6), d.slice(6, 8), d.slice(8, 10)].filter(Boolean).join(" ");
}

// The site's privacy page: at the domain root on ar-amir.com, under /ar-amir elsewhere.
export function privacyHref(): string {
  if (typeof window !== "undefined" && /(^|\.)ar-amir\.com$/i.test(window.location.hostname)) return "/privacy";
  return "/ar-amir/privacy";
}
