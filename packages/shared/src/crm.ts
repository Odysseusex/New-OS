import { LoyaltyMemberDetailDto, LoyaltySegment } from "./loyalty";

// ── CRM (/crm) ───────────────────────────────────────────────────────────────
// Everything here is computed from the books (sales, members, birthdays); the
// CRM's own records are only contacts (who reached out to whom) and custom
// orders. Nothing is typed in to make a figure appear.

export enum CrmContactChannel {
  WHATSAPP = "WHATSAPP",
  TELEGRAM = "TELEGRAM",
  CALL = "CALL",
  SMS = "SMS",
  IN_PERSON = "IN_PERSON",
}

export const CRM_CONTACT_CHANNEL_LABELS_RU: Record<CrmContactChannel, string> = {
  [CrmContactChannel.WHATSAPP]: "WhatsApp",
  [CrmContactChannel.TELEGRAM]: "Telegram",
  [CrmContactChannel.CALL]: "Звонок",
  [CrmContactChannel.SMS]: "SMS",
  [CrmContactChannel.IN_PERSON]: "Лично",
};

export enum CrmContactOutcome {
  SENT = "SENT",
  TALKED = "TALKED",
  NO_ANSWER = "NO_ANSWER",
  DECLINED = "DECLINED",
  ORDERED = "ORDERED",
}

export const CRM_CONTACT_OUTCOME_LABELS_RU: Record<CrmContactOutcome, string> = {
  [CrmContactOutcome.SENT]: "Написали",
  [CrmContactOutcome.TALKED]: "Поговорили",
  [CrmContactOutcome.NO_ANSWER]: "Не ответил",
  [CrmContactOutcome.DECLINED]: "Отказался",
  [CrmContactOutcome.ORDERED]: "Сделал заказ",
};

export enum CrmContactReason {
  DUE = "DUE",
  LAPSED = "LAPSED",
  BIRTHDAY = "BIRTHDAY",
  WHOLESALE = "WHOLESALE",
  ORDER = "ORDER",
  OTHER = "OTHER",
}

export const CRM_CONTACT_REASON_LABELS_RU: Record<CrmContactReason, string> = {
  [CrmContactReason.DUE]: "Пора за покупкой",
  [CrmContactReason.LAPSED]: "Давно не были",
  [CrmContactReason.BIRTHDAY]: "День рождения",
  [CrmContactReason.WHOLESALE]: "Опт · дозаказ",
  [CrmContactReason.ORDER]: "Заказ",
  [CrmContactReason.OTHER]: "Другое",
};

export interface CrmChannelsDto {
  // WhatsApp marketing consent given (the link opens the cashier's own WhatsApp).
  whatsapp: boolean;
  // Linked to the customer Telegram bot with the Telegram consent.
  telegram: boolean;
  call: boolean;
}

export interface CrmBirthdayDto {
  familyId: string;
  name: string;
  relation: string | null;
  // "YYYY-MM-DD" in Almaty.
  date: string;
  inDays: number;
  // The age they turn, when the year is known.
  turns: number | null;
}

export interface CrmTodayCardDto {
  // "member:<id>" / "customer:<id>" / "birthday:<familyId>".
  key: string;
  reason: CrmContactReason;
  memberId: string | null;
  customerId: string | null;
  name: string | null;
  phone: string | null;
  // What they usually buy: product names (wholesale: «Батон ×40»).
  usual: string[];
  rhythmDays: number | null;
  daysSinceLastVisit: number | null;
  // Days past the expected next purchase (negative = not yet due).
  overdueDays: number | null;
  lastVisitAt: string | null;
  visits: number;
  segment: LoyaltySegment | null;
  pointsBalance: number;
  birthday: CrmBirthdayDto | null;
  channels: CrmChannelsDto;
  // Filled when the card was dealt with today.
  contactedAt: string | null;
  contactOutcome: CrmContactOutcome | null;
  contactedByName: string | null;
  // A ready first message, editable before sending.
  suggestedText: string;
}

export interface CrmAgendaItemDto {
  orderId: string;
  number: number;
  title: string;
  customerName: string;
  dueAt: string;
  stage: CrmOrderStage;
}

export interface CrmTodayDto {
  date: string;
  due: CrmTodayCardDto[];
  lapsed: CrmTodayCardDto[];
  wholesale: CrmTodayCardDto[];
  birthdays: CrmTodayCardDto[];
  // Dealt with today (moved here from their own column).
  done: CrmTodayCardDto[];
  agenda: CrmAgendaItemDto[];
  stats: {
    toContact: number;
    contactedToday: number;
    // Of the contacts in the last 30 days, how many bought within 7 days after.
    contacts30: number;
    returned30: number;
    returnedRevenue30: number;
  };
}

export interface CreateCrmContactRequestDto {
  memberId?: string;
  customerId?: string;
  orderId?: string;
  channel: CrmContactChannel;
  outcome: CrmContactOutcome;
  reason: CrmContactReason;
  note?: string;
}

export interface CrmContactDto {
  id: string;
  memberId: string | null;
  customerId: string | null;
  channel: CrmContactChannel;
  outcome: CrmContactOutcome;
  reason: CrmContactReason;
  note: string | null;
  byName: string | null;
  at: string;
}

// ── Customers list and card ──────────────────────────────────────────────────

export interface CrmMemberRowDto {
  id: string;
  name: string | null;
  phone: string;
  visits: number;
  spend: number;
  lastVisitAt: string | null;
  daysSinceLastVisit: number | null;
  rhythmDays: number | null;
  overdueDays: number | null;
  segment: LoyaltySegment | null;
  pointsBalance: number;
  whatsapp: boolean;
  createdAt: string;
}

export interface CrmMemberListDto {
  items: CrmMemberRowDto[];
  total: number;
  // Whether RFM groups are computed (needs enough customers with purchases).
  segmentsAvailable: boolean;
}

export type CrmTimelineKind = "SALE" | "RETURN" | "POINTS" | "MESSAGE" | "CONTACT" | "CONSENT" | "ORDER" | "REGISTERED";

export interface CrmTimelineItemDto {
  id: string;
  kind: CrmTimelineKind;
  at: string;
  title: string;
  detail: string | null;
  byName: string | null;
  amount: number | null;
}

export interface CrmMemberProfileDto {
  member: LoyaltyMemberDetailDto;
  stats: {
    visits: number;
    spend: number;
    averageCheck: number | null;
    firstVisitAt: string | null;
    lastVisitAt: string | null;
    daysSinceLastVisit: number | null;
  };
  rhythm: {
    days: number | null;
    expectedAt: string | null;
    overdueDays: number | null;
    // Days between visits, oldest first (at most the last 24).
    intervals: number[];
  };
  favorites: { name: string; visits: number; share: number }[];
  segment: LoyaltySegment | null;
  timeline: CrmTimelineItemDto[];
  orders: CrmOrderDto[];
  channels: CrmChannelsDto;
}

// ── Custom orders (cakes) ────────────────────────────────────────────────────

export enum CrmOrderStage {
  NEW = "NEW",
  AGREED = "AGREED",
  PREPAID = "PREPAID",
  IN_PRODUCTION = "IN_PRODUCTION",
  READY = "READY",
  DONE = "DONE",
  CANCELLED = "CANCELLED",
}

export const CRM_ORDER_STAGES: CrmOrderStage[] = [
  CrmOrderStage.NEW,
  CrmOrderStage.AGREED,
  CrmOrderStage.PREPAID,
  CrmOrderStage.IN_PRODUCTION,
  CrmOrderStage.READY,
  CrmOrderStage.DONE,
];

export const CRM_ORDER_STAGE_LABELS_RU: Record<CrmOrderStage, string> = {
  [CrmOrderStage.NEW]: "Заявка",
  [CrmOrderStage.AGREED]: "Согласовано",
  [CrmOrderStage.PREPAID]: "Предоплата",
  [CrmOrderStage.IN_PRODUCTION]: "В производстве",
  [CrmOrderStage.READY]: "Готов к выдаче",
  [CrmOrderStage.DONE]: "Выдан",
  [CrmOrderStage.CANCELLED]: "Отменён",
};

export interface CrmOrderDto {
  id: string;
  number: number;
  memberId: string | null;
  customerName: string;
  phone: string | null;
  title: string;
  details: string | null;
  weightKg: number | null;
  price: number | null;
  prepaid: boolean;
  dueAt: string;
  stage: CrmOrderStage;
  stageChangedAt: string;
  cancelReason: string | null;
  createdByName: string | null;
  createdAt: string;
  events: { fromStage: CrmOrderStage | null; toStage: CrmOrderStage; byName: string | null; at: string }[];
}

export interface SaveCrmOrderRequestDto {
  memberId?: string | null;
  customerName?: string;
  phone?: string | null;
  title?: string;
  details?: string | null;
  weightKg?: number | null;
  price?: number | null;
  prepaid?: boolean;
  dueAt?: string;
  stage?: CrmOrderStage;
  cancelReason?: string | null;
}

// A finished order stays on the board this long, then only in the list.
export const CRM_ORDER_DONE_VISIBLE_DAYS = 14;

// The personal rhythm: the median gap between purchase days. Needs at least
// three purchase days (two gaps) — one gap is a coincidence, not a habit.
export function medianInterval(dayStarts: number[]): number | null {
  const days = [...new Set(dayStarts)].sort((a, b) => a - b);
  if (days.length < 3) return null;
  const gaps = days.slice(1).map((d, i) => (d - days[i]) / 86_400_000);
  const sorted = [...gaps].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.max(1, Math.round(median));
}
