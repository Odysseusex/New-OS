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
}

export const LOYALTY_CONSENT_SOURCE_LABELS_RU: Record<LoyaltyConsentSource, string> = {
  [LoyaltyConsentSource.AT_TILL]: "На кассе",
  [LoyaltyConsentSource.PAPER_FORM]: "Письменная анкета",
  [LoyaltyConsentSource.IMPORT]: "Импорт",
  [LoyaltyConsentSource.OTHER]: "Другое",
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
