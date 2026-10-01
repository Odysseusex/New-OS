import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { JournalDimensions } from "@bakery-os/shared";
import { monthOf, monthRange } from "../common/reporting-period";
import { Dec, LedgerRejectedError, validateLines } from "./journal-math";

// THE ONLY place a JournalEntry / JournalLine row is created. Business modules
// never call this: they hand the posting service a source document and it comes
// here. Everything runs on the caller's transaction, so an entry and the
// operation it records commit or roll back together.

export interface PostLine extends JournalDimensions {
  accountId: string;
  debit: Dec;
  credit: Dec;
  description?: string | null;
  cashSection?: string | null;
}

export interface PostEntryInput {
  organizationId: string;
  entryDate: Date;
  description: string;
  kind: "STANDARD" | "OPENING_BALANCE" | "MANUAL" | "REVERSAL";
  reference?: string | null;
  accountingEventId?: string | null;
  reversalOfEntryId?: string | null;
  reversalReason?: string | null;
  lines: PostLine[];
  actorId: string;
}

export interface PostedEntry {
  id: string;
  number: number;
  accountingPeriodId: string;
}

// The month's period row, created OPEN when the month has none yet. Raw
// `ON CONFLICT DO NOTHING` so two transactions posting into a fresh month at
// once cannot make one of them fail on the unique key.
export async function ensurePeriod(
  tx: Prisma.TransactionClient,
  organizationId: string,
  date: Date,
): Promise<{ id: string; status: string; year: number; month: number }> {
  const { year, month } = monthOf(date);
  const range = monthRange(year, month);
  await tx.$executeRaw`
    INSERT INTO "financial_periods" ("id", "organizationId", "year", "month", "periodStart", "periodEnd", "updatedAt")
    VALUES (${randomUUID()}, ${organizationId}, ${year}, ${month}, ${range.start}, ${range.end}, NOW())
    ON CONFLICT ("organizationId", "year", "month") DO NOTHING`;
  const period = await tx.financialPeriod.findUniqueOrThrow({
    where: { organizationId_year_month: { organizationId, year, month } },
    select: { id: true, status: true },
  });
  return { ...period, year, month };
}

// One transaction-scoped lock per (organization, key): the same source can be
// posted by two requests at once and only one of them gets to create the entry.
export async function lockPostingKey(tx: Prisma.TransactionClient, organizationId: string, key: string): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId + "|" + key}))::text`;
}

// All the keys of a batch in ONE statement, in sorted order (two postings that
// need the same keys then queue up rather than deadlock).
export async function lockPostingKeys(tx: Prisma.TransactionClient, organizationId: string, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const ids = [...keys].sort().map((k) => organizationId + "|" + k);
  await tx.$queryRaw`SELECT count(pg_advisory_xact_lock(hashtext(k)))::text AS n FROM unnest(${ids}::text[]) AS k`;
}

export async function postJournalEntry(tx: Prisma.TransactionClient, input: PostEntryInput): Promise<PostedEntry> {
  // 1. Shape and balance — in memory, before a single row is written.
  validateLines(input.lines);

  // 2. The ledger must be on, and the entry must not predate it.
  const org = await tx.organization.findUniqueOrThrow({
    where: { id: input.organizationId },
    select: { ledgerStartsAt: true },
  });
  if (!org.ledgerStartsAt) {
    throw new LedgerRejectedError("LEDGER_DISABLED", "Главная книга не запущена");
  }
  if (input.kind !== "REVERSAL" && input.entryDate < org.ledgerStartsAt) {
    throw new LedgerRejectedError("BEFORE_LEDGER_START", "Дата проводки раньше запуска главной книги");
  }

  // 3. Every account is this organization's and is open for posting.
  const accountIds = [...new Set(input.lines.map((l) => l.accountId))];
  const accounts = await tx.ledgerAccount.findMany({
    where: { id: { in: accountIds }, organizationId: input.organizationId },
    select: { id: true, isActive: true, code: true },
  });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  for (const id of accountIds) {
    const a = byId.get(id);
    if (!a) throw new LedgerRejectedError("ACCOUNT_NOT_FOUND", "Счёт не найден в этой организации");
    if (!a.isActive && input.kind !== "REVERSAL") {
      throw new LedgerRejectedError("ACCOUNT_INACTIVE", `Счёт ${a.code} отключён: проводить в него нельзя`);
    }
  }

  // 4. The period must be open. A reversal is dated in the OPEN present even
  // when it undoes an entry from a closed month — a closed month is never edited.
  const period = await ensurePeriod(tx, input.organizationId, input.entryDate);
  if (period.status !== "OPEN") {
    throw new LedgerRejectedError(
      "PERIOD_CLOSED",
      `Период ${String(period.month).padStart(2, "0")}.${period.year} закрыт — проводку с этой датой провести нельзя. ` +
        `Исправление вносится текущим периодом (сторно, корректировка).`,
    );
  }

  // 5. Number it (gapless: a rolled-back transaction gives its number back) and write it.
  const { journalEntrySequence } = await tx.organization.update({
    where: { id: input.organizationId },
    data: { journalEntrySequence: { increment: 1 } },
    select: { journalEntrySequence: true },
  });
  const entry = await tx.journalEntry.create({
    data: {
      organizationId: input.organizationId,
      number: journalEntrySequence,
      accountingPeriodId: period.id,
      accountingEventId: input.accountingEventId ?? null,
      entryDate: input.entryDate,
      description: input.description,
      kind: input.kind,
      reference: input.reference ?? null,
      reversalOfEntryId: input.reversalOfEntryId ?? null,
      reversalReason: input.reversalReason ?? null,
      createdById: input.actorId,
      postedById: input.actorId,
    },
    select: { id: true, number: true, accountingPeriodId: true },
  });
  // ALL lines in ONE statement: the database checks the set as it arrives
  // (balance, at least two lines, nothing added to an existing entry later).
  await tx.journalLine.createMany({
    data: input.lines.map((l, i) => ({
      journalEntryId: entry.id,
      organizationId: input.organizationId,
      lineNo: i + 1,
      accountId: l.accountId,
      debit: l.debit,
      credit: l.credit,
      amount: l.debit.plus(l.credit),
      description: l.description ?? null,
      cashSection: l.cashSection ?? null,
      cashAccountId: l.cashAccountId ?? null,
      locationId: l.locationId ?? null,
      productId: l.productId ?? null,
      categoryId: l.categoryId ?? null,
      customerId: l.customerId ?? null,
      supplierId: l.supplierId ?? null,
      employeeId: l.employeeId ?? null,
      financeCategoryId: l.financeCategoryId ?? null,
    })),
  });
  return entry;
}

// The exact accounting opposite of a posted entry, as a NEW entry. The original
// is never touched. The unique `reversalOfEntryId` is the real guard against a
// second reversal; the explicit check is only there to give a readable message.
export async function reverseJournalEntry(
  tx: Prisma.TransactionClient,
  args: { organizationId: string; entryId: string; reason: string; actorId: string; at?: Date },
): Promise<PostedEntry & { originalNumber: number }> {
  await lockPostingKey(tx, args.organizationId, `reverse:${args.entryId}`);
  const original = await tx.journalEntry.findFirst({
    where: { id: args.entryId, organizationId: args.organizationId },
    include: { lines: { orderBy: { lineNo: "asc" } }, reversedBy: { select: { id: true } } },
  });
  if (!original) throw new LedgerRejectedError("NOT_REVERSIBLE", "Проводка не найдена");
  if (original.kind === "REVERSAL") {
    throw new LedgerRejectedError("NOT_REVERSIBLE", "Сторно-проводку не сторнируют: внесите новую проводку");
  }
  if (original.reversedBy) {
    throw new LedgerRejectedError("ALREADY_REVERSED", "Эта проводка уже сторнирована");
  }
  const reversal = await postJournalEntry(tx, {
    organizationId: args.organizationId,
    entryDate: args.at ?? new Date(),
    description: `Сторно проводки №${original.number}: ${original.description}`,
    kind: "REVERSAL",
    reference: original.reference,
    reversalOfEntryId: original.id,
    reversalReason: args.reason,
    actorId: args.actorId,
    lines: original.lines.map((l) => ({
      accountId: l.accountId,
      // Swap the sides: what was debited is credited and the other way round.
      debit: l.credit,
      credit: l.debit,
      description: l.description,
      cashSection: l.cashSection,
      cashAccountId: l.cashAccountId,
      locationId: l.locationId,
      productId: l.productId,
      categoryId: l.categoryId,
      customerId: l.customerId,
      supplierId: l.supplierId,
      employeeId: l.employeeId,
      financeCategoryId: l.financeCategoryId,
    })),
  });
  return { ...reversal, originalNumber: original.number };
}
