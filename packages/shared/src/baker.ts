import type { Unit } from "./catalog";
import type { ProductionReleasePreviewDto } from "./production";
import { Role } from "./roles";

// «Накладные пекарей»: the bakers type the day's delivery notes on their phones instead of on paper.
// A note is a DRAFT — it moves no stock and no money. The operator's «Провести день» turns the day's
// notes into the documents that already exist: «Выпуск за день», «Перемещение» to own points and a
// sale on account to each wholesale customer.

export enum BakerNoteKind {
  // Goods handed to a point or a wholesale customer.
  DELIVERY = "DELIVERY",
  // «Холодильник на завтра»: what stayed at the workshop in the evening.
  FRIDGE = "FRIDGE",
}

export enum BakerNoteStatus {
  SENT = "SENT",
  // Being turned into a document right now.
  POSTING = "POSTING",
  POSTED = "POSTED",
  CANCELLED = "CANCELLED",
}

export const BAKER_NOTE_STATUS_LABELS_RU: Record<BakerNoteStatus, string> = {
  [BakerNoteStatus.SENT]: "Отправлена",
  [BakerNoteStatus.POSTING]: "Проводится",
  [BakerNoteStatus.POSTED]: "Проведена",
  [BakerNoteStatus.CANCELLED]: "Отменена",
};

// Who writes a note (the bakers; the others so a note can be typed in for them).
export const BAKER_NOTE_ROLES: Role[] = [Role.OWNER, Role.ADMIN, Role.PRODUCTION_MANAGER, Role.PRODUCTION_STAFF, Role.OPERATOR, Role.ASSISTANT];
// Who sees every baker's notes, corrects them and presses «Провести день».
export const BAKER_DAY_ROLES: Role[] = [Role.OWNER, Role.ADMIN, Role.PRODUCTION_MANAGER, Role.OPERATOR, Role.ASSISTANT];
// Who signs in on a baker's phone with a PIN.
export const BAKER_PHONE_ROLES: Role[] = [Role.PRODUCTION_STAFF, Role.PRODUCTION_MANAGER];

export const BAKER_NOTE_MAX_LINES = 150;

export type BakerRecipientKind = "location" | "customer";

export interface BakerRecipientDto {
  kind: BakerRecipientKind;
  id: string;
  name: string;
}

export interface BakerNoteLineDto {
  productId: string;
  productName: string;
  unit: Unit;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface BakerNoteDto {
  id: string;
  number: number;
  kind: BakerNoteKind;
  status: BakerNoteStatus;
  // The Almaty day it belongs to, YYYY-MM-DD.
  day: string;
  sourceLocationId: string;
  sourceLocationName: string;
  // null for «Холодильник на завтра».
  recipient: BakerRecipientDto | null;
  lines: BakerNoteLineDto[];
  total: number;
  comment: string | null;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  postedAt: string | null;
  postedByName: string | null;
  // The document it became: «Перемещение № 12», «Чек № 345».
  document: string | null;
  // Why the last «Провести день» could not post it.
  postError: string | null;
  // May the asking user still change it.
  editable: boolean;
}

export interface SaveBakerNoteRequestDto {
  kind: BakerNoteKind;
  sourceLocationId?: string;
  // DELIVERY: exactly one of the two.
  customerId?: string;
  locationId?: string;
  // Prices are never sent: the server takes the point's price, the customer's agreed price or the base one.
  lines: { productId: string; quantity: number }[];
  comment?: string;
}

// Everything the phone screen needs, in one request.
export interface BakerCatalogDto {
  day: string;
  sourceLocationId: string;
  sourceLocationName: string;
  // Other workshops the user may write for (more than one only for org-wide roles).
  sources: { id: string; name: string }[];
  recipients: BakerRecipientDto[];
  products: { id: string; name: string; sku: string | null; unit: Unit; price: number }[];
  // recipient key «location:<id>» / «customer:<id>» → productId → price, where it differs from the base one.
  prices: Record<string, Record<string, number>>;
  // May the user see every baker's notes (operator) or only their own.
  seesAll: boolean;
  // Participants who pay suppliers with their own money («Как оплатили» on a supplier intake).
  personalAccounts: { id: string; name: string }[];
}

export interface BakerDayDto {
  day: string;
  sourceLocationId: string;
  sourceLocationName: string;
  sources: { id: string; name: string }[];
  notes: BakerNoteDto[];
  fridge: BakerNoteDto | null;
  // Other days that still have notes nobody posted (for whoever posts the day).
  pendingDays: { day: string; count: number }[];
}

export interface BakerDayOutputLineDto {
  productId: string;
  productName: string;
  unit: Unit;
  // In the notes still to be posted.
  shipped: number;
  // «Холодильник на завтра».
  fridge: number;
  // On the workshop's books right now (what stayed from yesterday).
  onHand: number;
  // shipped + fridge − onHand, never below zero.
  output: number;
  // By the books there is more than was shipped and left: nothing is baked, the rest stays on the books.
  surplus: number;
  hasRecipe: boolean;
}

export interface BakerDayPreviewDto {
  day: string;
  sourceLocationId: string;
  sourceLocationName: string;
  output: BakerDayOutputLineDto[];
  // Raw materials for the output; null when nothing is to be baked or the release cannot be planned.
  release: ProductionReleasePreviewDto | null;
  documents: { noteId: string; number: number; recipient: BakerRecipientDto; lines: number; total: number }[];
  fridgeMissing: boolean;
  // What stops the posting altogether.
  blockers: string[];
  warnings: string[];
  // Sent back with «Провести»: if anything changed since the preview the posting is refused.
  signature: string;
}

export interface BakerDayPostRequestDto {
  day: string;
  sourceLocationId: string;
  signature: string;
}

export interface BakerDayPostResultDto {
  released: { batches: number; totalCost: number } | null;
  notes: { noteId: string; number: number; recipientName: string; ok: boolean; message: string }[];
  day: BakerDayDto;
}

export const bakerRecipientKey = (kind: BakerRecipientKind, id: string) => `${kind}:${id}`;

// «сло» finds every «…слойка»: each typed word must occur somewhere in the name or the SKU, «ё» = «е».
export function bakerSearchMatches(query: string, name: string, sku?: string | null): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е");
  const hay = norm(`${name} ${sku ?? ""}`);
  return norm(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word));
}

// What the phone reads a typed quantity as: «12», «1,5»; anything else is 0.
export function parseBakerQuantity(value: string | undefined): number {
  const n = Number((value ?? "").trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : 0;
}

// The same formula the server uses for «Провести день».
export function bakerDayOutput(shipped: number, fridge: number, onHand: number): { output: number; surplus: number } {
  const need = Math.round((shipped + fridge - Math.max(onHand, 0)) * 1000) / 1000;
  return need >= 0 ? { output: need, surplus: 0 } : { output: 0, surplus: -need };
}

// ── «Приход от поставщика» ──
// A baker photographs the supplier's накладная instead of sending it to WhatsApp. An intake is a DRAFT:
// it moves no stock and no money. Whoever enters the goods (the operator, or «Помощник» through the
// API) does the ordinary приёмка / заказ поставщику and then marks the intake «Проведён» — or
// «Отклонён» with a reason.

export enum SupplierIntakeStatus {
  // Created, photos still being sent from the phone: nobody but its author sees it.
  UPLOADING = "UPLOADING",
  SENT = "SENT",
  POSTED = "POSTED",
  REJECTED = "REJECTED",
}

export const SUPPLIER_INTAKE_STATUS_LABELS_RU: Record<SupplierIntakeStatus, string> = {
  [SupplierIntakeStatus.UPLOADING]: "Отправляется",
  [SupplierIntakeStatus.SENT]: "Отправлен",
  [SupplierIntakeStatus.POSTED]: "Проведён",
  [SupplierIntakeStatus.REJECTED]: "Отклонён",
};

export enum SupplierIntakePayment {
  CASH = "CASH",
  KASPI = "KASPI",
  BCC = "BCC",
  CREDIT = "CREDIT",
  // Out of a participant's own pocket: which one is `paymentAccountId` (a personal account).
  PERSONAL = "PERSONAL",
}

export const SUPPLIER_INTAKE_PAYMENT_LABELS_RU: Record<SupplierIntakePayment, string> = {
  [SupplierIntakePayment.CASH]: "Наличные",
  [SupplierIntakePayment.KASPI]: "Kaspi",
  [SupplierIntakePayment.BCC]: "BCC",
  [SupplierIntakePayment.CREDIT]: "В долг",
  [SupplierIntakePayment.PERSONAL]: "Личные средства",
};

// «Как оплатили» in words: the participant's name when it was their own money.
export const supplierIntakePaymentLabel = (payment: SupplierIntakePayment, personalAccountName?: string | null): string =>
  payment === SupplierIntakePayment.PERSONAL && personalAccountName ? personalAccountName : SUPPLIER_INTAKE_PAYMENT_LABELS_RU[payment];

export const SUPPLIER_INTAKE_MAX_PHOTOS = 8;
// One photo as it travels (a JPEG data URL): the API's JSON body limit is 1 MB.
export const SUPPLIER_INTAKE_PHOTO_MAX_CHARS = 900_000;

export interface SupplierIntakePhotoDto {
  id: string;
  // Path under the API (needs the login, like every other request): GET returns the JPEG itself.
  path: string;
  bytes: number;
}

export interface SupplierIntakeDto {
  id: string;
  number: number;
  status: SupplierIntakeStatus;
  // The Almaty day it was sent, YYYY-MM-DD.
  day: string;
  locationId: string;
  locationName: string;
  payment: SupplierIntakePayment;
  // How it was paid, in words: «Наличные», «В долг», or the participant who paid — «Гауһар».
  paymentLabel: string;
  // PERSONAL: the participant's personal account the payment is to be recorded on.
  paymentAccountId: string | null;
  supplierName: string | null;
  // The total written on the supplier's paper, as the baker read it.
  total: number | null;
  comment: string | null;
  photos: SupplierIntakePhotoDto[];
  createdById: string;
  createdByName: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedByName: string | null;
  rejectReason: string | null;
  // «Заказ поставщику № 12» / what the person who entered it wrote.
  document: string | null;
  purchaseOrderId: string | null;
}

export interface CreateSupplierIntakeRequestDto {
  locationId: string;
  payment: SupplierIntakePayment;
  // Required with PERSONAL: one of the catalogue's `personalAccounts`.
  paymentAccountId?: string;
  supplierName?: string;
  total?: number;
  comment?: string;
}

// «Проведён»: name the document it became — a purchase order by id, and/or a line of text
// (e.g. «Приёмка 25.11, 6 позиций»). «Отклонён»: the reason the baker will read.
export interface ResolveSupplierIntakeRequestDto {
  status: SupplierIntakeStatus.POSTED | SupplierIntakeStatus.REJECTED;
  purchaseOrderId?: string;
  document?: string;
  reason?: string;
}
