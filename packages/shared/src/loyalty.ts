// Loyalty programme, stage 1: a retail customer identified by phone, plus the
// record of their consent. No points yet (stage 2 waits for the owner's
// decisions on redemption share, expiry, exclusions and accounting).

export enum LoyaltyMemberStatus {
  ACTIVE = "ACTIVE",
  WITHDRAWN = "WITHDRAWN",
  MERGED = "MERGED",
}

export const LOYALTY_MEMBER_STATUS_LABELS_RU: Record<LoyaltyMemberStatus, string> = {
  [LoyaltyMemberStatus.ACTIVE]: "Участник",
  [LoyaltyMemberStatus.WITHDRAWN]: "Согласие отозвано",
  [LoyaltyMemberStatus.MERGED]: "Объединён",
};

export enum LoyaltyConsentPurpose {
  PERSONAL_DATA = "PERSONAL_DATA",
  MARKETING = "MARKETING",
}

export const LOYALTY_CONSENT_PURPOSE_LABELS_RU: Record<LoyaltyConsentPurpose, string> = {
  [LoyaltyConsentPurpose.PERSONAL_DATA]: "Обработка персональных данных",
  [LoyaltyConsentPurpose.MARKETING]: "Рекламные рассылки",
};

export enum LoyaltyConsentChannel {
  WHATSAPP = "WHATSAPP",
  TELEGRAM = "TELEGRAM",
  SMS = "SMS",
}

export const LOYALTY_CONSENT_CHANNELS: LoyaltyConsentChannel[] = [
  LoyaltyConsentChannel.WHATSAPP,
  LoyaltyConsentChannel.TELEGRAM,
  LoyaltyConsentChannel.SMS,
];

export const LOYALTY_CONSENT_CHANNEL_LABELS_RU: Record<LoyaltyConsentChannel, string> = {
  [LoyaltyConsentChannel.WHATSAPP]: "WhatsApp",
  [LoyaltyConsentChannel.TELEGRAM]: "Telegram",
  [LoyaltyConsentChannel.SMS]: "SMS",
};

export enum LoyaltyConsentSource {
  AT_TILL = "AT_TILL",
  PAPER_FORM = "PAPER_FORM",
  IMPORT = "IMPORT",
  OTHER = "OTHER",
  TELEGRAM_BOT = "TELEGRAM_BOT",
}

export const LOYALTY_CONSENT_SOURCE_LABELS_RU: Record<LoyaltyConsentSource, string> = {
  [LoyaltyConsentSource.AT_TILL]: "На кассе",
  [LoyaltyConsentSource.PAPER_FORM]: "Письменная анкета",
  [LoyaltyConsentSource.IMPORT]: "Импорт",
  [LoyaltyConsentSource.OTHER]: "Другое",
  [LoyaltyConsentSource.TELEGRAM_BOT]: "Telegram-бот",
};

// ── Kazakhstan phone numbers ────────────────────────────────────────────────
// One canonical form, "+77XXXXXXXXX", so «8 701 123-45-67», «+7 (701) 1234567»
// and «7011234567» are the same customer and the unique index catches the
// duplicate. Kazakhstan shares country code +7 with Russia; its numbers are the
// ones whose 10-digit national part starts with 7 (Russian ones start with 3, 4,
// 8 or 9), so anything else is refused rather than stored as a near-miss.
export function normalizeKzPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (/[^\d\s()+\-.]/.test(raw.trim())) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"))) digits = digits.slice(1);
  if (digits.length !== 10 || !digits.startsWith("7")) return null;
  return `+7${digits}`;
}

// "+77011234567" → "+7 701 123 45 67". Anything not in canonical form is shown as is.
export function formatKzPhone(phone: string): string {
  const m = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return m ? `+7 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : phone;
}

export const KZ_PHONE_INVALID_MESSAGE = "Укажите казахстанский номер, например +7 701 123 45 67";

// ── DTOs ────────────────────────────────────────────────────────────────────

export interface LoyaltyConsentStateDto {
  personalData: boolean;
  marketing: Record<LoyaltyConsentChannel, boolean>;
}

export interface LoyaltyMemberDto {
  id: string;
  phone: string;
  name: string | null;
  note: string | null;
  status: LoyaltyMemberStatus;
  mergedIntoId: string | null;
  consents: LoyaltyConsentStateDto;
  // Points held now (expired ones excluded).
  pointsBalance: number;
  // Linked to the customer Telegram bot (messages also need the TELEGRAM consent).
  telegramLinked: boolean;
  createdAt: string;
}

export interface LoyaltyConsentRecordDto {
  id: string;
  purpose: LoyaltyConsentPurpose;
  channel: LoyaltyConsentChannel | null;
  granted: boolean;
  source: LoyaltyConsentSource;
  recordedByName: string | null;
  recordedAt: string;
  note: string | null;
}

export interface LoyaltyMemberDetailDto extends LoyaltyMemberDto {
  history: LoyaltyConsentRecordDto[];
  pointsHistory: LoyaltyPointsEntryDto[];
  // Records merged into this one, so their phones are still findable here.
  mergedFrom: { id: string; phone: string; name: string | null; mergedAt: string | null }[];
}

export interface LoyaltyLookupDto {
  phone: string;
  // The member the phone leads to — for a merged duplicate, the record it was merged into.
  member: LoyaltyMemberDto | null;
}

export interface RegisterLoyaltyMemberRequestDto {
  phone: string;
  name?: string;
  note?: string;
  personalDataConsent: boolean;
  marketingChannels?: LoyaltyConsentChannel[];
  source: LoyaltyConsentSource;
}

export interface UpdateLoyaltyMemberRequestDto {
  name?: string | null;
  note?: string | null;
}

export interface RecordLoyaltyConsentRequestDto {
  purpose: LoyaltyConsentPurpose;
  channel?: LoyaltyConsentChannel;
  granted: boolean;
  source: LoyaltyConsentSource;
  note?: string;
}

export interface MergeLoyaltyMembersRequestDto {
  // The record that stays.
  primaryId: string;
  // The duplicate folded into it.
  duplicateId: string;
  reason: string;
}

export interface LoyaltyImportRowInput {
  phone: string;
  name?: string;
  consent?: string;
  whatsapp?: string;
  telegram?: string;
  sms?: string;
  note?: string;
}

export enum LoyaltyImportRowStatus {
  NEW = "NEW",
  EXISTS = "EXISTS",
  DUPLICATE_IN_FILE = "DUPLICATE_IN_FILE",
  INVALID_PHONE = "INVALID_PHONE",
  NO_CONSENT = "NO_CONSENT",
}

export const LOYALTY_IMPORT_ROW_STATUS_LABELS_RU: Record<LoyaltyImportRowStatus, string> = {
  [LoyaltyImportRowStatus.NEW]: "Будет добавлен",
  [LoyaltyImportRowStatus.EXISTS]: "Уже есть в базе",
  [LoyaltyImportRowStatus.DUPLICATE_IN_FILE]: "Повтор в файле",
  [LoyaltyImportRowStatus.INVALID_PHONE]: "Неверный номер",
  [LoyaltyImportRowStatus.NO_CONSENT]: "Нет согласия",
};

export interface LoyaltyImportPreviewRowDto {
  line: number;
  rawPhone: string;
  phone: string | null;
  name: string | null;
  marketingChannels: LoyaltyConsentChannel[];
  status: LoyaltyImportRowStatus;
}

export interface LoyaltyImportPreviewDto {
  rows: LoyaltyImportPreviewRowDto[];
  newCount: number;
  skippedCount: number;
}

export interface LoyaltyImportResultDto {
  created: number;
  skipped: number;
}

export interface LoyaltyMemberListDto {
  items: LoyaltyMemberDto[];
  // How many match in total; `items` is capped (LOYALTY_LIST_LIMIT).
  total: number;
}

export const LOYALTY_LIST_LIMIT = 200;

// ── Points (stage 2) ────────────────────────────────────────────────────────
// 1 point = 1 ₸. Spending points is a discount on the check («способ Б»): it
// lowers the price of the lines it pays for, exactly like a coupon, so revenue,
// the P&L discounts line, returns and fiscal receipts need no special case.
// These functions are shared so the till shows exactly the total the server
// will record (the Kaspi terminal is charged that amount).

export interface LoyaltySettingsDto {
  enabled: boolean;
  firstPurchaseEarnPercent: number;
  earnPercent: number;
  maxRedeemPercent: number;
  pointsLifetimeMonths: number;
}

export type UpdateLoyaltySettingsRequestDto = Partial<LoyaltySettingsDto>;

export const DEFAULT_LOYALTY_SETTINGS: LoyaltySettingsDto = {
  enabled: false,
  firstPurchaseEarnPercent: 5,
  earnPercent: 1,
  maxRedeemPercent: 30,
  pointsLifetimeMonths: 12,
};

export enum LoyaltyPointsEntryType {
  EARN = "EARN",
  REDEEM = "REDEEM",
  EARN_REVERSAL = "EARN_REVERSAL",
  REDEEM_REFUND = "REDEEM_REFUND",
  EXPIRE = "EXPIRE",
  ADJUSTMENT = "ADJUSTMENT",
  MERGE_IN = "MERGE_IN",
  MERGE_OUT = "MERGE_OUT",
}

export const LOYALTY_POINTS_ENTRY_TYPE_LABELS_RU: Record<LoyaltyPointsEntryType, string> = {
  [LoyaltyPointsEntryType.EARN]: "Начислено за покупку",
  [LoyaltyPointsEntryType.REDEEM]: "Оплата баллами",
  [LoyaltyPointsEntryType.EARN_REVERSAL]: "Возврат товара: начисление отменено",
  [LoyaltyPointsEntryType.REDEEM_REFUND]: "Возврат товара: баллы возвращены",
  [LoyaltyPointsEntryType.EXPIRE]: "Сгорели",
  [LoyaltyPointsEntryType.ADJUSTMENT]: "Ручная корректировка",
  [LoyaltyPointsEntryType.MERGE_IN]: "Перенесены при объединении",
  [LoyaltyPointsEntryType.MERGE_OUT]: "Перенесены в основную запись",
};

export interface LoyaltyPointsEntryDto {
  id: string;
  type: LoyaltyPointsEntryType;
  points: number;
  expiresAt: string | null;
  saleId: string | null;
  ratePercent: number | null;
  reason: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface AdjustLoyaltyPointsRequestDto {
  points: number;
  reason: string;
}

export interface LoyaltySummaryDto {
  // Points customers hold right now (not expired), in ₸.
  pointsOutstanding: number;
  membersWithPoints: number;
  pointsEarned: number;
  // Скидки баллами: points spent on purchases in the period, net of refunds.
  pointsRedeemed: number;
  pointsExpired: number;
}

export interface LoyaltyCartLine {
  quantity: number;
  unitPrice: number;
  // Set on a marked-down or coupon line: such a line neither takes points nor earns them.
  fullUnitPrice?: number | null;
  // Goods «под реализацию» are the supplier's money: never discounted by points, never earning.
  consignment: boolean;
}

export interface PointsDiscountLine {
  index: number;
  fullUnitPrice: number;
  unitPrice: number;
  subtotal: number;
  discount: number;
}

const tiyn = (value: number) => Math.round(value * 100);
const milli = (quantity: number) => Math.round(quantity * 1000);
const lineTiyn = (quantity: number, unitPriceTiyn: number) => Math.round((milli(quantity) * unitPriceTiyn) / 1000);

export function isPointsRedeemableLine(line: LoyaltyCartLine): boolean {
  return !line.consignment && (line.fullUnitPrice === undefined || line.fullUnitPrice === null);
}

// Lines that earn: our own goods at their normal price, including a line part-paid
// by points (it earns on the money part only — its subtotal is already net).
export function isPointsEarningLine(line: LoyaltyCartLine & { loyaltyDiscount?: number | null }): boolean {
  if (line.consignment) return false;
  return line.fullUnitPrice === undefined || line.fullUnitPrice === null || (line.loyaltyDiscount ?? 0) > 0;
}

export function floorToTiyn(value: number): number {
  return Math.floor(value * 100 + 1e-6) / 100;
}

// The most points this cart can take: the share limit of its redeemable goods,
// and never more than the customer holds.
export function loyaltyRedeemCap(lines: LoyaltyCartLine[], maxRedeemPercent: number, balance: number): number {
  const base = lines.filter(isPointsRedeemableLine).reduce((sum, l) => sum + lineTiyn(l.quantity, tiyn(l.unitPrice)), 0);
  const cap = Math.floor((base * maxRedeemPercent) / 100 + 1e-6);
  return Math.max(0, Math.min(cap, Math.floor(balance * 100 + 1e-6))) / 100;
}

export function loyaltyEarnPoints(base: number, ratePercent: number): number {
  return Math.max(0, Math.floor((tiyn(base) * ratePercent) / 100 + 1e-6) / 100);
}

// Spreads `points` over the redeemable lines in proportion to their value, as a
// lower unit price on each (whole тиын). Weighed goods cannot always absorb an
// exact amount, so the result may fall a few тиын short of what was asked —
// `total` is what is actually discounted and what is charged in points.
export function distributePointsDiscount(lines: LoyaltyCartLine[], points: number): { lines: PointsDiscountLine[]; total: number } {
  const eligible = lines
    .map((line, index) => ({ line, index, unit: tiyn(line.unitPrice), q: milli(line.quantity) }))
    .filter((e) => isPointsRedeemableLine(e.line) && e.q > 0 && e.unit > 0)
    .map((e) => ({ ...e, sub: lineTiyn(e.line.quantity, e.unit), delta: 0 }));
  const base = eligible.reduce((sum, e) => sum + e.sub, 0);
  const target = Math.min(Math.max(0, tiyn(points)), base);
  if (target === 0 || eligible.length === 0) return { lines: [], total: 0 };

  // Largest-remainder shares in тиын.
  const shares = eligible.map((e) => {
    const exact = (target * e.sub) / base;
    return { floor: Math.floor(exact), rest: exact - Math.floor(exact) };
  });
  let left = target - shares.reduce((sum, s) => sum + s.floor, 0);
  [...shares.keys()].sort((a, b) => shares[b].rest - shares[a].rest).forEach((k) => {
    if (left > 0) {
      shares[k].floor += 1;
      left -= 1;
    }
  });

  const discountOf = (e: (typeof eligible)[number]) => e.sub - lineTiyn(e.line.quantity, e.unit - e.delta);
  eligible.forEach((e, k) => {
    e.delta = Math.min(e.unit, Math.floor((shares[k].floor * 1000) / e.q));
    while (e.delta > 0 && discountOf(e) > shares[k].floor) e.delta -= 1;
  });
  // What weighed lines could not absorb goes, if possible, onto the others.
  let shortfall = target - eligible.reduce((sum, e) => sum + discountOf(e), 0);
  for (const e of [...eligible].sort((a, b) => a.q - b.q)) {
    if (shortfall <= 0) break;
    const before = discountOf(e);
    e.delta = Math.min(e.unit, e.delta + Math.floor((shortfall * 1000) / e.q));
    while (e.delta > 0 && discountOf(e) - before > shortfall) e.delta -= 1;
    shortfall -= discountOf(e) - before;
  }

  const out = eligible
    .filter((e) => e.delta > 0)
    .map((e) => {
      const unitPrice = e.unit - e.delta;
      const subtotal = lineTiyn(e.line.quantity, unitPrice);
      return { index: e.index, fullUnitPrice: e.unit / 100, unitPrice: unitPrice / 100, subtotal: subtotal / 100, discount: (e.sub - subtotal) / 100 };
    });
  return { lines: out, total: out.reduce((sum, l) => sum + tiyn(l.discount), 0) / 100 };
}

// ── Customer analytics (stage 4) ─────────────────────────────────────────────
// Built from sales with an attached member only. Methods follow what leading
// platforms use (docs/CRM-LOYALTY-RESEARCH.md §13): Klaviyo's six RFM groups,
// Square's «lapsed regular» rule for the churn radar, Shopify's monthly cohorts.

export enum LoyaltySegment {
  CHAMPIONS = "CHAMPIONS",
  LOYAL = "LOYAL",
  RECENT = "RECENT",
  NEEDS_ATTENTION = "NEEDS_ATTENTION",
  AT_RISK = "AT_RISK",
  INACTIVE = "INACTIVE",
}

export const LOYALTY_SEGMENTS: LoyaltySegment[] = [
  LoyaltySegment.CHAMPIONS,
  LoyaltySegment.LOYAL,
  LoyaltySegment.RECENT,
  LoyaltySegment.NEEDS_ATTENTION,
  LoyaltySegment.AT_RISK,
  LoyaltySegment.INACTIVE,
];

export const LOYALTY_SEGMENT_LABELS_RU: Record<LoyaltySegment, string> = {
  [LoyaltySegment.CHAMPIONS]: "Чемпионы",
  [LoyaltySegment.LOYAL]: "Лояльные",
  [LoyaltySegment.RECENT]: "Новички",
  [LoyaltySegment.NEEDS_ATTENTION]: "Требуют внимания",
  [LoyaltySegment.AT_RISK]: "В зоне риска",
  [LoyaltySegment.INACTIVE]: "Уснувшие",
};

// RFM codes (recency, frequency, monetary — each 1..3) per group, as Klaviyo defines them.
export const RFM_SEGMENT_CODES: Record<LoyaltySegment, string[]> = {
  [LoyaltySegment.CHAMPIONS]: ["333", "332", "323"],
  [LoyaltySegment.LOYAL]: ["321", "322", "331", "232", "233"],
  [LoyaltySegment.RECENT]: ["312", "313", "311", "222", "223"],
  [LoyaltySegment.NEEDS_ATTENTION]: ["213", "221", "123", "132", "133"],
  [LoyaltySegment.AT_RISK]: ["231", "212", "122", "131", "211"],
  [LoyaltySegment.INACTIVE]: ["111", "112", "113", "121"],
};

export interface LoyaltyChurnSettings {
  // A «regular»: at least `minVisits` purchases in the last `windowDays`…
  minVisits: number;
  windowDays: number;
  // …who has not been back for `inactiveDays`.
  inactiveDays: number;
}

export const DEFAULT_LOYALTY_CHURN_SETTINGS: LoyaltyChurnSettings = { minVisits: 3, windowDays: 60, inactiveDays: 14 };

export interface LoyaltyAnalyticsMemberRowDto {
  memberId: string;
  phone: string;
  name: string | null;
  lastVisitAt: string;
  daysSinceLastVisit: number;
  visits: number;
  spend: number;
  averageCheck: number;
  // Average gap between visits, when there are at least two.
  usualIntervalDays: number | null;
  segment: LoyaltySegment | null;
  // Linked to the customer bot with the TELEGRAM consent granted: can be messaged.
  telegramReachable: boolean;
}

export interface LoyaltyAnalyticsDto {
  from: string;
  to: string;
  summary: {
    activeMembers: number;
    newMembers: number;
    // Shares are fractions 0..1; null when there is nothing to divide by.
    returningShare: number | null;
    averageCheckMembers: number | null;
    averageCheckAnonymous: number | null;
    visitsPerMember: number | null;
    memberRevenueShare: number | null;
    memberRevenue: number;
    memberVisits: number;
  };
  segments: {
    // Groups are percentile-based and mean nothing on a handful of people.
    minimumMembers: number;
    membersScored: number;
    available: boolean;
    groups: { segment: LoyaltySegment; members: number; revenue: number }[];
    rows: LoyaltyAnalyticsMemberRowDto[];
  };
  churnRadar: LoyaltyChurnSettings & { rows: LoyaltyAnalyticsMemberRowDto[] };
  frequency: { label: string; members: number }[];
  weekly: { weekStart: string; newMembers: number; returningMembers: number }[];
  // retention[k] = share of the cohort that bought again in month +k+1; null for a month not reached yet.
  cohorts: { month: string; size: number; retention: (number | null)[] }[];
  topMembers: LoyaltyAnalyticsMemberRowDto[];
}

// ── Customer Telegram bot ───────────────────────────────────────────────────

export interface LoyaltyTelegramStatusDto {
  enabled: boolean;
  username: string | null;
  linkedMembers: number;
  // Linked AND consented to the Telegram channel: who a message actually reaches.
  reachableMembers: number;
}

export interface SendLoyaltyTelegramRequestDto {
  memberIds: string[];
  text: string;
}

export interface SendLoyaltyTelegramResultDto {
  sent: number;
  skipped: number;
}
