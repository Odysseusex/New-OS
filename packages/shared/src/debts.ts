// Debts: who owes us (дебиторская задолженность) and whom we owe (кредиторская),
// by document, with due dates, age and overdue days, plus a counterparty's
// statement with a running balance — the card and the акт сверки взаиморасчётов.
//
// Everything here is pure: the API gathers documents and payments, these
// functions decide what is open, how old it is and what the balance was.
// Days are calendar days in Almaty, the business's own.

export const DEBT_TIME_ZONE = "Asia/Almaty";

const dateKeyFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: DEBT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// "YYYY-MM-DD" as the day reads on a wall clock in Almaty.
export function debtDateKey(at: Date | string): string {
  return dateKeyFormat.format(typeof at === "string" ? new Date(at) : at);
}

const keyToUtcDays = (key: string): number => {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

export function addDaysToKey(key: string, days: number): string {
  return new Date((keyToUtcDays(key) + days) * 86_400_000).toISOString().slice(0, 10);
}

// Whole days from `from` to `to` (negative when `to` is earlier).
export function daysBetweenKeys(from: string, to: string): number {
  return Math.round(keyToUtcDays(to) - keyToUtcDays(from));
}

// A БИН/ИИН is twelve digits. Spaces a person may type are dropped; anything
// else is refused rather than stored half-right on an акт сверки.
export function normalizeBin(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const digits = raw.replace(/\s+/g, "");
  if (digits === "") return null;
  return /^\d{12}$/.test(digits) ? digits : null;
}

export const PAYMENT_TERM_MAX_DAYS = 365;

// ── Open items and their age ───────────────────────────────────────────

export enum DebtCounterpartyKind {
  CUSTOMER = "CUSTOMER",
  SUPPLIER = "SUPPLIER",
  // Accrued expenses carry no counterparty: they are owed, but to nobody on file.
  NONE = "NONE",
}

export enum DebtDocumentKind {
  SALE = "SALE",
  PURCHASE_ORDER = "PURCHASE_ORDER",
  INVOICE = "INVOICE",
  EXPENSE = "EXPENSE",
  // Somebody else's goods sold on our shelf: what we collected is owed to them.
  CONSIGNMENT = "CONSIGNMENT",
}

export const DEBT_DOCUMENT_KIND_LABELS_RU: Record<DebtDocumentKind, string> = {
  [DebtDocumentKind.SALE]: "Реализация",
  [DebtDocumentKind.PURCHASE_ORDER]: "Приход по заказу",
  [DebtDocumentKind.INVOICE]: "Накладная поставщика",
  [DebtDocumentKind.EXPENSE]: "Начисленный расход",
  [DebtDocumentKind.CONSIGNMENT]: "Продано под реализацию",
};

// Age of a debt in days since its document (the ТЗ's «0–1, 2–7, 8–30, более 30»).
export type DebtAgeBucket = "D0_1" | "D2_7" | "D8_30" | "D31_PLUS";
export const DEBT_AGE_BUCKETS: DebtAgeBucket[] = ["D0_1", "D2_7", "D8_30", "D31_PLUS"];
export const DEBT_AGE_BUCKET_LABELS_RU: Record<DebtAgeBucket, string> = {
  D0_1: "0–1 дн.",
  D2_7: "2–7 дн.",
  D8_30: "8–30 дн.",
  D31_PLUS: "Более 30 дн.",
};

export function debtAgeBucket(ageDays: number): DebtAgeBucket {
  if (ageDays <= 1) return "D0_1";
  if (ageDays <= 7) return "D2_7";
  if (ageDays <= 30) return "D8_30";
  return "D31_PLUS";
}

// The day a document is due: its own stated date if it has one, else its date
// plus the counterparty's deferral (none stated = due the same day).
export function debtDueKey(documentKey: string, termDays: number | null, statedDueKey: string | null = null): string {
  if (statedDueKey) return statedDueKey;
  return addDaysToKey(documentKey, Math.max(0, termDays ?? 0));
}

export interface DebtItemDto {
  kind: DebtDocumentKind;
  // The document behind it (sale, order, invoice, expense); null for a
  // consignment day, which is a sum of many sale lines.
  documentId: string | null;
  label: string;
  dateKey: string;
  dueDateKey: string;
  amount: number;
  outstanding: number;
  ageDays: number;
  // Days past the due date on the report date; 0 when not yet due.
  overdueDays: number;
}

export interface DebtCounterpartyRowDto {
  kind: DebtCounterpartyKind;
  counterpartyId: string | null;
  name: string;
  bin: string | null;
  paymentTermDays: number | null;
  outstanding: number;
  overdue: number;
  maxOverdueDays: number;
  byAge: Record<DebtAgeBucket, number>;
  items: DebtItemDto[];
}

export interface DebtReportDto {
  asOfKey: string;
  total: number;
  overdue: number;
  byAge: Record<DebtAgeBucket, number>;
  counterparties: DebtCounterpartyRowDto[];
  // The other way round, paid ahead: in «Кто нам должен» — advances paid to
  // suppliers (goods owed to us); in «Кому мы должны» — advances received from
  // customers (goods we owe). Gross, by counterparty.
  advances: DebtAdvanceDto[];
  advancesTotal: number;
}

export interface DebtAdvanceDto {
  kind: DebtCounterpartyKind;
  counterpartyId: string;
  name: string;
  amount: number;
}

export type DebtItemInput = Omit<DebtItemDto, "ageDays" | "overdueDays">;

export interface DebtGroupInput {
  kind: DebtCounterpartyKind;
  counterpartyId: string | null;
  name: string;
  bin: string | null;
  paymentTermDays: number | null;
  items: DebtItemInput[];
}

const money = (n: number) => Math.round(n * 100) / 100;
const emptyAge = (): Record<DebtAgeBucket, number> => ({ D0_1: 0, D2_7: 0, D8_30: 0, D31_PLUS: 0 });

// Open items as they stood on `asOfKey`: anything with less than a тиын left is
// settled. Counterparties are listed by what they owe, largest first; each
// one's documents oldest first (the order they are paid off in).
export function buildDebtReport(asOfKey: string, groups: DebtGroupInput[], advances: DebtAdvanceDto[] = []): DebtReportDto {
  const total = emptyAge();
  let grand = 0;
  let grandOverdue = 0;
  const rows: DebtCounterpartyRowDto[] = [];
  for (const g of groups) {
    const items: DebtItemDto[] = g.items
      .filter((i) => i.outstanding > 0.004 && i.dateKey <= asOfKey)
      .map((i) => ({
        ...i,
        amount: money(i.amount),
        outstanding: money(i.outstanding),
        ageDays: Math.max(0, daysBetweenKeys(i.dateKey, asOfKey)),
        overdueDays: Math.max(0, daysBetweenKeys(i.dueDateKey, asOfKey)),
      }))
      .sort((a, b) => (a.dateKey === b.dateKey ? a.label.localeCompare(b.label, "ru") : a.dateKey < b.dateKey ? -1 : 1));
    if (items.length === 0) continue;
    const byAge = emptyAge();
    let outstanding = 0;
    let overdue = 0;
    let maxOverdueDays = 0;
    for (const i of items) {
      outstanding += i.outstanding;
      byAge[debtAgeBucket(i.ageDays)] += i.outstanding;
      if (i.overdueDays > 0) {
        overdue += i.outstanding;
        maxOverdueDays = Math.max(maxOverdueDays, i.overdueDays);
      }
    }
    for (const b of DEBT_AGE_BUCKETS) {
      byAge[b] = money(byAge[b]);
      total[b] += byAge[b];
    }
    grand += outstanding;
    grandOverdue += overdue;
    rows.push({
      kind: g.kind,
      counterpartyId: g.counterpartyId,
      name: g.name,
      bin: g.bin,
      paymentTermDays: g.paymentTermDays,
      outstanding: money(outstanding),
      overdue: money(overdue),
      maxOverdueDays,
      byAge,
      items,
    });
  }
  for (const b of DEBT_AGE_BUCKETS) total[b] = money(total[b]);
  rows.sort((a, b) => b.outstanding - a.outstanding || a.name.localeCompare(b.name, "ru"));
  const advanceRows = advances
    .filter((a) => a.amount > 0.004)
    .map((a) => ({ ...a, amount: money(a.amount) }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, "ru"));
  return {
    asOfKey,
    total: money(grand),
    overdue: money(grandOverdue),
    byAge: total,
    counterparties: rows,
    advances: advanceRows,
    advancesTotal: money(advanceRows.reduce((s, a) => s + a.amount, 0)),
  };
}

// Amounts owed in dated lots, paid off oldest first: what is still open of
// each lot once `settled` has been taken from the front. Used where payments
// are not tied to one document (consignment payouts).
export function settleOldestFirst<T extends { amount: number }>(lots: T[], settled: number): (T & { outstanding: number })[] {
  let left = Math.max(0, settled);
  return lots.map((lot) => {
    const take = Math.min(lot.amount, left);
    left -= take;
    return { ...lot, outstanding: money(lot.amount - take) };
  });
}

// ── Statement: the counterparty card and the акт сверки ─────────────────
//
// From OUR side, as on an акт сверки «по данным» of our organization: a debit
// raises what the counterparty owes us (we shipped, we paid them, we refunded
// them), a credit lowers it (they paid, they delivered, they returned goods).
// Balance = debits − credits: above zero the counterparty owes us, below zero
// we owe them.

export enum StatementLineKind {
  SALE = "SALE",
  PAYMENT_RECEIVED = "PAYMENT_RECEIVED",
  SALE_RETURN = "SALE_RETURN",
  REFUND_PAID = "REFUND_PAID",
  DELIVERY = "DELIVERY",
  PAYMENT_MADE = "PAYMENT_MADE",
  PAYMENT_REVERSED = "PAYMENT_REVERSED",
  CONSIGNMENT_SOLD = "CONSIGNMENT_SOLD",
  CONSIGNMENT_RETURNED = "CONSIGNMENT_RETURNED",
  SUPPLIER_RETURN = "SUPPLIER_RETURN",
  SUPPLIER_REFUND = "SUPPLIER_REFUND",
}

export const STATEMENT_LINE_KIND_LABELS_RU: Record<StatementLineKind, string> = {
  [StatementLineKind.SALE]: "Реализация",
  [StatementLineKind.PAYMENT_RECEIVED]: "Оплата от покупателя",
  [StatementLineKind.SALE_RETURN]: "Возврат товара",
  [StatementLineKind.REFUND_PAID]: "Возврат денег покупателю",
  [StatementLineKind.DELIVERY]: "Поступление товара",
  [StatementLineKind.PAYMENT_MADE]: "Оплата поставщику",
  [StatementLineKind.PAYMENT_REVERSED]: "Сторно оплаты",
  [StatementLineKind.CONSIGNMENT_SOLD]: "Продано под реализацию",
  [StatementLineKind.CONSIGNMENT_RETURNED]: "Возврат товара под реализацию",
  [StatementLineKind.SUPPLIER_RETURN]: "Возврат товара поставщику",
  [StatementLineKind.SUPPLIER_REFUND]: "Возврат денег от поставщика",
};

export interface StatementEventInput {
  at: string; // ISO instant
  kind: StatementLineKind;
  document: string;
  debit: number;
  credit: number;
}

export interface StatementLineDto extends StatementEventInput {
  dateKey: string;
  balance: number;
}

export interface CounterpartyStatementDto {
  kind: DebtCounterpartyKind;
  counterparty: { id: string; name: string; bin: string | null };
  organization: { name: string; legalName: string | null; bin: string | null };
  fromKey: string;
  toKey: string;
  opening: number;
  lines: StatementLineDto[];
  turnoverDebit: number;
  turnoverCredit: number;
  closing: number;
}

// Everything before `fromKey` folds into the opening balance; lines from
// `fromKey` to `toKey` (inclusive) carry the balance after each; later events
// are ignored. Same-instant events keep the order they were given in.
export function buildStatementLines(
  events: StatementEventInput[],
  fromKey: string,
  toKey: string,
): { opening: number; lines: StatementLineDto[]; turnoverDebit: number; turnoverCredit: number; closing: number } {
  const sorted = events
    .map((e, i) => ({ e, i, key: debtDateKey(e.at) }))
    .sort((a, b) => (a.e.at === b.e.at ? a.i - b.i : a.e.at < b.e.at ? -1 : 1));
  let balance = 0;
  let debit = 0;
  let credit = 0;
  const lines: StatementLineDto[] = [];
  let opening = 0;
  for (const { e, key } of sorted) {
    if (key > toKey) continue;
    balance += e.debit - e.credit;
    if (key < fromKey) {
      opening = balance;
      continue;
    }
    debit += e.debit;
    credit += e.credit;
    lines.push({ ...e, debit: money(e.debit), credit: money(e.credit), dateKey: key, balance: money(balance) });
  }
  return { opening: money(opening), lines, turnoverDebit: money(debit), turnoverCredit: money(credit), closing: money(balance) };
}

// The closing sentence of an акт сверки.
export function statementConclusion(closing: number, organizationName: string, counterpartyName: string): string {
  if (Math.abs(closing) < 0.005) return "Задолженность отсутствует.";
  const amount = Math.abs(closing).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return closing > 0
    ? `Задолженность в пользу ${organizationName} составляет ${amount} ₸.`
    : `Задолженность в пользу ${counterpartyName} составляет ${amount} ₸.`;
}

export interface OrganizationRequisitesDto {
  name: string;
  legalName: string | null;
  bin: string | null;
}

export interface UpdateOrganizationRequisitesRequestDto {
  legalName?: string | null;
  bin?: string | null;
}
