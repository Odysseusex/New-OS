// ── Customer app (ar-amir.com/app) ──────────────────────────────────────────
// A web app the customer adds to their home screen: their bonus card with a
// rotating QR, balance and history. Sign-in is a message FROM the customer's
// own phone (WhatsApp, or the customer Telegram bot with their own contact):
// no password to forget, no paid SMS.

import type { LoyaltyTierDto } from "./loyalty";

export const CLUB_LOGIN_CODE_LENGTH = 6;
export const CLUB_LOGIN_TTL_MINUTES = 10;

// The text the app pre-fills in WhatsApp. The server finds the six digits in
// whatever the customer actually sends, so an edited message still works.
export function clubLoginMessage(code: string): string {
  return `Код входа в приложение Ar Amir: ${code}`;
}

// ── Rotating card code ──────────────────────────────────────────────────────
// Like a bank app's QR: a six-digit code that changes every 30 seconds, made
// from a per-member secret and the time (the TOTP method), so a screenshot of
// someone's card stops working within a minute or two. The phone computes it
// offline; the till sends what it scanned and the server checks it.
//
// The QR holds DIGITS ONLY — the 10-digit national phone number then the code —
// because a USB scanner "types" what it reads as key presses, and letters come
// out wrong under a Russian or Kazakh keyboard layout.

export const CARD_CODE_STEP_SECONDS = 30;
// Codes from this many steps before or after the server's own are accepted
// (the phone's clock may be a little off; the app also corrects it by the server time).
export const CARD_CODE_SKEW_STEPS = 2;

export function cardCodeStep(atMs: number): number {
  return Math.floor(atMs / 1000 / CARD_CODE_STEP_SECONDS);
}

// RFC 4226 dynamic truncation of an HMAC-SHA256 digest to six digits.
export function truncateCardCode(digest: Uint8Array): string {
  const offset = digest[digest.length - 1] & 0x0f;
  const value =
    ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(value % 1_000_000).padStart(6, "0");
}

// "+77014035832" + "482915" → "7014035832482915".
export function cardPayload(phone: string, code: string): string {
  return `${phone.replace(/\D/g, "").slice(-10)}${code}`;
}

// What a scanner (or a person) typed → the phone and the code, or null.
export function parseCardPayload(raw: string): { phone: string; code: string } | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!/^7\d{9}\d{6}$/.test(digits)) return null;
  return { phone: `+7${digits.slice(0, 10)}`, code: digits.slice(10) };
}

// ── DTOs ────────────────────────────────────────────────────────────────────

export interface ClubProgrammeDto {
  enabled: boolean;
  earnPercent: number;
  maxRedeemPercent: number;
  pointsLifetimeMonths: number;
  welcomeBonusPoints: number;
  welcomeBonusDays: number;
  birthdayBonusPoints: number;
  // Levels, when switched on: spend over `windowDays` → percent.
  tiers: {
    windowDays: number;
    silver: { threshold: number; percent: number };
    gold: { threshold: number; percent: number };
    platinum: { threshold: number; percent: number };
  } | null;
}

export interface ClubInfoDto {
  brand: string;
  // Sign-in is possible (WhatsApp or the Telegram bot is connected).
  ready: boolean;
  whatsapp: boolean;
  telegram: boolean;
  programme: ClubProgrammeDto | null;
}

export interface StartClubLoginRequestDto {
  phone: string;
  name?: string;
  // Consent to processing personal data — required.
  consent: boolean;
  // Notices about bonuses in WhatsApp.
  marketing: boolean;
}

export interface StartClubLoginDto {
  requestId: string;
  // Held only by this browser; collecting the session needs it.
  secret: string;
  code: string;
  expiresAt: string;
  whatsappUrl: string | null;
  telegramUrl: string | null;
}

export type ClubLoginState = "PENDING" | "CONFIRMED" | "EXPIRED" | "USED";

export interface ClubLoginStatusDto {
  status: ClubLoginState;
  // Given once, when the request has just been confirmed.
  token?: string;
}

export type ClubHistoryKind = "PURCHASE" | "RETURN" | "BONUS" | "EXPIRED" | "ADJUSTMENT";

export interface ClubHistoryItemDto {
  id: string;
  at: string;
  kind: ClubHistoryKind;
  title: string;
  place: string | null;
  // Money, ₸ (a return is negative).
  amount: number | null;
  // Points earned minus spent on this event.
  points: number | null;
}

export interface ClubProfileDto {
  name: string | null;
  phone: string;
  memberSince: string;
  balance: number;
  pending: { points: number; from: string } | null;
  // The earliest usable points to burn, and when.
  expiring: { points: number; at: string } | null;
  card: { secret: string };
  // For the card code: the app corrects its own clock by this.
  serverTime: string;
  visits: number;
  // The member's level; null when levels are off.
  tier: LoyaltyTierDto | null;
  // Messages from the bakery not opened yet (the dot on «Чат»).
  chatUnread: number;
  programme: ClubProgrammeDto;
  history: ClubHistoryItemDto[];
}

export interface UpdateClubProfileRequestDto {
  name: string;
}

// ── Chat between a customer (the app) and the bakery (CRM) ───────────────────

export const CLUB_CHAT_MAX_LENGTH = 1000;

export type ClubChatFrom = "CUSTOMER" | "BAKERY";
export type ClubChatMessageKind = "TEXT" | "NOTICE" | "BROADCAST";

export interface ClubChatMessageDto {
  id: string;
  at: string;
  from: ClubChatFrom;
  kind: ClubChatMessageKind;
  // Automatic notices carry a heading («Бонусы скоро сгорят»).
  title: string | null;
  text: string;
  // Who of the staff wrote it — shown in CRM only, never to the customer.
  byName: string | null;
  // Seen by the other side.
  read: boolean;
}

// What the app gets: the thread, oldest first.
export interface ClubChatDto {
  messages: ClubChatMessageDto[];
}

export interface CrmChatRowDto {
  memberId: string;
  name: string | null;
  phone: string;
  lastText: string;
  lastAt: string;
  lastFrom: ClubChatFrom;
  // Messages from the customer nobody has opened yet.
  unread: number;
}

export interface CrmChatListDto {
  items: CrmChatRowDto[];
  unread: number;
}

export interface CrmChatThreadDto {
  member: {
    id: string;
    name: string | null;
    phone: string;
    // Signed in to the app (otherwise a message has nowhere to be read).
    inApp: boolean;
    // Allowed notifications on some phone.
    notifications: boolean;
  };
  messages: ClubChatMessageDto[];
}

// A group a mass message can go to. Nothing is typed in to make one: «Все», the
// levels and the purchase groups are all worked out from sales.
export interface CrmChatAudienceDto {
  key: string;
  label: string;
  // Of them, signed in to the app (the ones who will see the message).
  members: number;
}

export interface CrmChatBroadcastDto {
  id: string;
  audience: string;
  text: string;
  recipients: number;
  byName: string | null;
  at: string;
}

export interface CrmChatOverviewDto {
  // Customers signed in to the app.
  appMembers: number;
  audiences: CrmChatAudienceDto[];
  broadcasts: CrmChatBroadcastDto[];
}
