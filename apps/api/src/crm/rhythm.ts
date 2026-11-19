import { medianInterval } from "@bakery-os/shared";

// Pure arithmetic behind «Кому написать»: a customer's own rhythm and where
// they stand against it today. No database here, so each rule is tested alone.

export const DAY = 86_400_000;

export interface RhythmPosition {
  visitDays: number;
  rhythmDays: number | null;
  lastDay: number | null;
  daysSince: number | null;
  // Days past the expected next purchase; negative = not yet due.
  overdueDays: number | null;
}

export type RhythmVerdict = "DUE" | "LAPSED" | null;

// A rhythm longer than this is not a habit to remind anyone of.
export const MAX_REMINDABLE_RHYTHM_DAYS = 30;
// Past this many days a regular counts as gone and is no longer chased.
export const LAPSED_GIVE_UP_DAYS = 120;
export const WHOLESALE_GIVE_UP_DAYS = 60;
// A first-time buyer is welcomed from the day after their purchase until this
// many days later; past it, the moment for «спасибо, что зашли» has gone.
export const NEWCOMER_WINDOW_DAYS = 10;

export const isNewcomer = (p: RhythmPosition) =>
  p.visitDays === 1 && p.daysSince !== null && p.daysSince >= 1 && p.daysSince <= NEWCOMER_WINDOW_DAYS;

// `dayStarts`: the local midnight (ms) of every purchase day; `today` likewise.
export function rhythmPosition(dayStarts: number[], today: number): RhythmPosition {
  const days = [...new Set(dayStarts)].sort((a, b) => a - b);
  const rhythmDays = medianInterval(days);
  const lastDay = days.length ? days[days.length - 1] : null;
  const daysSince = lastDay === null ? null : Math.round((today - lastDay) / DAY);
  return {
    visitDays: days.length,
    rhythmDays,
    lastDay,
    daysSince,
    overdueDays: rhythmDays !== null && daysSince !== null ? daysSince - rhythmDays : null,
  };
}

// Late by a day or more, but not so late that the habit is gone: up to three
// rhythms, and never less than a week of grace past the expected day.
export const dueLimit = (rhythmDays: number) => Math.max(rhythmDays * 3, rhythmDays + 7);

export function retailVerdict(p: RhythmPosition): RhythmVerdict {
  if (p.rhythmDays === null || p.daysSince === null || p.overdueDays === null) return null;
  if (p.rhythmDays > MAX_REMINDABLE_RHYTHM_DAYS) return null;
  if (p.overdueDays < 1) return null;
  if (p.daysSince <= dueLimit(p.rhythmDays)) return "DUE";
  return p.daysSince <= LAPSED_GIVE_UP_DAYS ? "LAPSED" : null;
}

export function wholesaleVerdict(p: RhythmPosition): boolean {
  return p.rhythmDays !== null && p.overdueDays !== null && p.daysSince !== null && p.overdueDays >= 1 && p.daysSince <= WHOLESALE_GIVE_UP_DAYS;
}

// After someone was written to, give them one rhythm (at least 3 days) to come
// before the card appears again.
export const contactCooldownDays = (rhythmDays: number | null) => Math.max(3, rhythmDays ?? 0);

// The products bought on the most purchase occasions, most frequent first.
export function usualProducts(occasions: { saleId: string; name: string; quantity: number }[], limit = 3, withQuantity = false): string[] {
  const byName = new Map<string, { sales: Set<string>; quantity: number }>();
  for (const o of occasions) {
    const e = byName.get(o.name) ?? { sales: new Set<string>(), quantity: 0 };
    e.sales.add(o.saleId);
    e.quantity += o.quantity;
    byName.set(o.name, e);
  }
  return [...byName]
    .sort(([an, a], [bn, b]) => b.sales.size - a.sales.size || an.localeCompare(bn, "ru"))
    .slice(0, limit)
    .map(([name, e]) => {
      if (!withQuantity) return name;
      const avg = e.quantity / e.sales.size;
      const shown = avg >= 10 ? Math.round(avg) : Math.round(avg * 10) / 10;
      return `${name} ×${String(shown).replace(".", ",")}`;
    });
}

const firstName = (name: string | null) => (name ?? "").trim().split(/\s+/)[0] || null;
const greeting = (name: string | null) => (firstName(name) ? `${firstName(name)}, добрый день!` : "Добрый день!");
// Kazakh: the name stands alone in the address, so nothing has to be declined.
const greetingKz = (name: string | null) => (firstName(name) ? `Сәлеметсіз бе, ${firstName(name)}!` : "Сәлеметсіз бе!");
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

const ALMATY = "Asia/Almaty";
const ruDay = new Intl.DateTimeFormat("ru-RU", { timeZone: ALMATY, day: "numeric", month: "long" });
const dayMonth = new Intl.DateTimeFormat("en-CA", { timeZone: ALMATY, day: "numeric", month: "numeric" });
// «…ға дейін» — the month in the dative.
const KZ_MONTH_UNTIL = ["қаңтарға", "ақпанға", "наурызға", "сәуірге", "мамырға", "маусымға", "шілдеге", "тамызға", "қыркүйекке", "қазанға", "қарашаға", "желтоқсанға"];
function kzUntil(at: Date): string {
  const parts = dayMonth.formatToParts(at);
  const day = Number(parts.find((p) => p.type === "day")!.value);
  const month = Number(parts.find((p) => p.type === "month")!.value);
  return `${day} ${KZ_MONTH_UNTIL[month - 1]} дейін`;
}
const num = (n: number) => String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

export interface SuggestContext {
  brand: string;
  name: string | null;
  usual: string[];
  // Points the customer holds (usable now or from tomorrow).
  points: number;
  // The share of a check points may pay.
  redeemPercent?: number;
  // The points that burn first, and their last day.
  expiring?: { points: number; lastDay: Date } | null;
  birthdayOf?: { name: string; relation: string | null; isHolder: boolean };
}

// «1 бонус, 32 бонуса, 5000 бонусов».
function bonusWord(n: number): string {
  const v = Math.floor(Math.abs(n));
  const d = v % 10;
  const h = v % 100;
  if (d === 1 && h !== 11) return "бонус";
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return "бонуса";
  return "бонусов";
}

// What the customer holds, in one sentence per language.
function pointsLines(ctx: SuggestContext): { ru: string; kz: string } {
  if (ctx.points <= 0) return { ru: "", kz: "" };
  const p = num(ctx.points);
  const pct = ctx.redeemPercent ? Math.floor(ctx.redeemPercent) : null;
  let ru = pct ? ` У вас ${p} ${bonusWord(ctx.points)} — ими можно оплатить до ${pct}% чека.` : ` У вас ${p} ${bonusWord(ctx.points)} — ими можно оплатить часть покупки.`;
  let kz = pct ? ` Картаңызда ${p} бонус бар — олармен чектің ${pct}%-ына дейін төлей аласыз.` : ` Картаңызда ${p} бонус бар — олармен сатып алудың бір бөлігін төлей аласыз.`;
  const e = ctx.expiring;
  if (e && e.points > 0) {
    const all = e.points >= ctx.points - 0.005;
    ru += all ? ` Они действуют до ${ruDay.format(e.lastDay)}.` : ` Из них ${num(e.points)} действуют до ${ruDay.format(e.lastDay)}.`;
    kz += all ? ` Бонустар ${kzUntil(e.lastDay)} жарамды.` : ` Оның ${num(e.points)} бонусы ${kzUntil(e.lastDay)} жарамды.`;
  }
  return { ru, kz };
}

// A ready first message, in Kazakh and in Russian (owner, 19.11.2026): the same
// facts in both — name, what they buy, points and the day they burn. Wholesale
// stays Russian (it is a business note to a buyer we already talk to).
export function suggestedText(reason: "DUE" | "LAPSED" | "BIRTHDAY" | "WHOLESALE" | "NEW", ctx: SuggestContext): string {
  // A name that already carries its quotes («Пекарня «Колосок»») is used as is.
  const brand = /[«"]/.test(ctx.brand) ? ctx.brand : `«${ctx.brand}»`;
  const pts = pointsLines(ctx);
  const both = (kz: string, ru: string) => `${greetingKz(ctx.name)} ${kz}\n\n${greeting(ctx.name)} ${ru}`;
  switch (reason) {
    case "DUE":
      return ctx.usual.length
        ? both(`Бұл ${brand}. Бүгін ${lower(ctx.usual[0])} пештен жаңа шықты — сізге алып қояйық па?`, `Это ${brand}. ${ctx.usual[0]} сегодня из печи — отложить для вас?`)
        : both(`Бұл ${brand}. Бүгін бәрі жаңа піскен — күтеміз!`, `Это ${brand}. Сегодня всё свежее — ждём вас!`);
    case "LAPSED":
      return both(`Бұл ${brand}, сізді көптен көрмедік — сағындық.${pts.kz} Келіңіз, күтеміз!`, `Это ${brand}, давно вас не видели — соскучились.${pts.ru} Заходите!`);
    case "BIRTHDAY": {
      const b = ctx.birthdayOf;
      // Names are not declined (no grammar engine here), so the name stands alone.
      const whose = !b || b.isHolder ? "ваш день рождения" : `день рождения — ${b.name}${b.relation ? ` (${lower(b.relation)})` : ""}`;
      const whoseKz = !b || b.isHolder ? "туған күніңіз" : `туған күн — ${b.name}`;
      return both(
        `Бұл ${brand}. Жақында ${whoseKz}. Мерекеге торт пісіріп берейік пе? Таңдауға көмектесеміз.${pts.kz}`,
        `Это ${brand}. Скоро ${whose}. Испечём торт к празднику? Подскажем с выбором.${pts.ru}`,
      );
    }
    case "NEW":
      return both(
        `Бұл ${brand}, бізге келгеніңізге рақмет!${ctx.usual.length ? ` ${ctx.usual[0]} ұнады ма?` : ""}${pts.kz} Тағы да күтеміз!`,
        `Это ${brand}, спасибо, что заглянули к нам!${ctx.usual.length ? ` Как вам ${lower(ctx.usual[0])}?` : ""}${pts.ru} Будем рады видеть снова.`,
      );
    case "WHOLESALE":
      return `Добрый день! Это ${brand}. Обычно в это время вы дозаказываете${ctx.usual.length ? `: ${ctx.usual.join(", ")}` : ""}. Оформить заказ?`;
  }
}
