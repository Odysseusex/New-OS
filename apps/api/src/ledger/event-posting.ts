import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import {
  AccountingEventStatus,
  FinancialEvent,
  JournalDimensions,
  NotPostedReason,
  SYSTEM_ACCOUNT_KEYS,
  SystemAccountKey,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { CostingService } from "../costing/costing.service";
import { FinancialEventProjector } from "../finance/events/projector";
import type { ProjectionScope } from "../finance/events/scope";
import { ensurePeriod, lockPostingKey, postJournalEntry, reverseJournalEntry } from "./journal-core";
import { LedgerRejectedError, validateLines } from "./journal-math";
import { DraftLine, decideEvent, draftFingerprint } from "./posting-rules";

// Turns what the business did into journal entries, on the caller's transaction.
// This is the one bridge from operations to the ledger: a business module names
// the documents it just wrote (a ProjectionScope) and this does the rest.
//
// Contract:
//   • Ledger OFF (Organization.ledgerStartsAt is null) → returns immediately.
//     Nothing is read, nothing written: every flow behaves exactly as before.
//   • Expected conditions (no classification, a system account missing, a closed
//     period) never fail the business operation: the event is recorded as
//     NOT_POSTED with the reason, visible in coverage and diagnostics.
//   • A genuine fault (an entry that will not balance because of a bug, a
//     database error) propagates, and the whole operation rolls back with it.

export interface PostSummary {
  posted: number;
  notPosted: number;
  unapproved: number;
  noEffect: number;
  exceptions: number;
  alreadyDone: number;
  beforeStart: number;
  reversed: number;
}

const emptySummary = (): PostSummary => ({
  posted: 0,
  notPosted: 0,
  unapproved: 0,
  noEffect: 0,
  exceptions: 0,
  alreadyDone: 0,
  beforeStart: 0,
  reversed: 0,
});

// A status that, once reached, is not re-evaluated.
const FINAL: ReadonlySet<string> = new Set([
  AccountingEventStatus.POSTED,
  AccountingEventStatus.REVERSED,
  AccountingEventStatus.NO_GL_EFFECT,
]);

export interface PostingContext {
  organizationId: string;
  actorId: string;
  startsAt: Date;
  accounts: Map<SystemAccountKey, { id: string; isActive: boolean }>;
  cashKinds: Map<string, string>;
}

export async function loadPostingContext(
  tx: Prisma.TransactionClient,
  organizationId: string,
  actorId: string,
): Promise<PostingContext | null> {
  const org = await tx.organization.findUnique({ where: { id: organizationId }, select: { ledgerStartsAt: true } });
  if (!org?.ledgerStartsAt) return null;
  const [accounts, cashAccounts] = await Promise.all([
    tx.ledgerAccount.findMany({
      where: { organizationId, systemAccountKey: { not: null } },
      select: { id: true, isActive: true, systemAccountKey: true },
    }),
    tx.cashAccount.findMany({ where: { organizationId }, select: { id: true, type: true } }),
  ]);
  return {
    organizationId,
    actorId,
    startsAt: org.ledgerStartsAt,
    accounts: new Map(accounts.map((a) => [a.systemAccountKey as SystemAccountKey, { id: a.id, isActive: a.isActive }])),
    cashKinds: new Map(cashAccounts.map((c) => [c.id, c.type])),
  };
}

// ── the entry point business modules call ─────────────────────────────────

export async function postLedgerSources(
  tx: Prisma.TransactionClient,
  args: { organizationId: string; actorId: string; scope: ProjectionScope },
): Promise<PostSummary> {
  const ctx = await loadPostingContext(tx, args.organizationId, args.actorId);
  if (!ctx) return emptySummary();

  const projector = new FinancialEventProjector(tx, new CostingService(tx as unknown as PrismaService));
  const events = await projector.project(args.organizationId, { scope: args.scope });
  const summary = await postEvents(tx, ctx, events);
  summary.reversed += await reverseVanishedSources(tx, ctx, args.scope, events);
  return summary;
}

// For a caller that may hold either a transaction or the plain connection (the
// cash ledger's single write path accepts both). With the plain connection the
// posting gets a transaction of its own — the movement has then already
// committed, so this is the weaker guarantee, used only by callers that never
// had a transaction to begin with.
export async function postLedgerSourcesOn(
  client: Prisma.TransactionClient | PrismaService,
  args: { organizationId: string; actorId: string; scope: ProjectionScope },
): Promise<PostSummary> {
  if ("$transaction" in client) {
    return (client as PrismaService).$transaction((tx) => postLedgerSources(tx, args));
  }
  return postLedgerSources(client, args);
}

// ── posting a batch of events ─────────────────────────────────────────────

export async function postEvents(
  tx: Prisma.TransactionClient,
  ctx: PostingContext,
  events: FinancialEvent[],
): Promise<PostSummary> {
  const summary = emptySummary();
  const ordered = [...events].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const dims = await loadDimensions(tx, ctx.organizationId, ordered);

  for (const event of ordered) {
    const occurredAt = new Date(event.occurredAt);
    if (occurredAt < ctx.startsAt) {
      summary.beforeStart += 1;
      continue;
    }
    await lockPostingKey(tx, ctx.organizationId, event.key);
    const existing = await tx.accountingEvent.findUnique({
      where: { organizationId_eventKey: { organizationId: ctx.organizationId, eventKey: event.key } },
      select: { id: true, status: true },
    });
    if (existing && FINAL.has(existing.status)) {
      summary.alreadyDone += 1;
      continue;
    }

    const decision = decideEvent(event, ctx.cashKinds);
    const record = async (
      status: AccountingEventStatus,
      reason: string | null,
      extra: { contentHash?: string | null; periodId?: string | null } = {},
    ) => {
      const data = {
        sourceType: event.sourceType,
        sourceId: event.sourceId,
        eventType: event.type,
        eventDate: occurredAt,
        accountingPeriodId: extra.periodId ?? null,
        status,
        statusReason: reason,
        contentHash: extra.contentHash ?? null,
        metadata: { description: event.description, categoryName: event.categoryName ?? null } as Prisma.InputJsonValue,
      };
      return existing
        ? tx.accountingEvent.update({ where: { id: existing.id }, data })
        : tx.accountingEvent.create({
            data: { ...data, organizationId: ctx.organizationId, eventKey: event.key, createdById: ctx.actorId },
          });
    };

    if (decision.status === AccountingEventStatus.UNAPPROVED) {
      await record(AccountingEventStatus.UNAPPROVED, decision.reason);
      summary.unapproved += 1;
      continue;
    }
    if (decision.status === AccountingEventStatus.NOT_POSTED) {
      await record(AccountingEventStatus.NOT_POSTED, decision.detail ? `${decision.reason}:${decision.detail}` : decision.reason);
      summary.notPosted += 1;
      continue;
    }
    if (decision.status === AccountingEventStatus.NO_GL_EFFECT) {
      await record(AccountingEventStatus.NO_GL_EFFECT, decision.reason);
      summary.noEffect += 1;
      continue;
    }

    // Resolve the system accounts the rules named.
    const missing: SystemAccountKey[] = [];
    const accountOf = (key: SystemAccountKey): string | null => {
      const a = ctx.accounts.get(key);
      if (!a || !a.isActive) {
        if (!missing.includes(key)) missing.push(key);
        return null;
      }
      return a.id;
    };
    const resolved = decision.lines.map((l) => ({ draft: l, accountId: accountOf(l.accountKey) }));
    if (missing.length > 0) {
      await record(AccountingEventStatus.NOT_POSTED, `${NotPostedReason.ACCOUNT_NOT_MAPPED}:${missing.join(",")}`);
      summary.notPosted += 1;
      continue;
    }

    // Balance is proven here, on exact decimals, before any entry row exists. A
    // lopsided event is an EXCEPTION to look at — never plugged.
    try {
      validateLines(decision.lines);
    } catch (e) {
      if (e instanceof LedgerRejectedError) {
        await record(AccountingEventStatus.EXCEPTION, `${NotPostedReason.DOES_NOT_BALANCE}:${e.message}`);
        summary.exceptions += 1;
        continue;
      }
      throw e;
    }

    const period = await ensurePeriod(tx, ctx.organizationId, occurredAt);
    if (period.status !== "OPEN") {
      await record(AccountingEventStatus.NOT_POSTED, NotPostedReason.PERIOD_CLOSED, { periodId: period.id });
      summary.notPosted += 1;
      continue;
    }

    const eventDims = dims.get(event.key) ?? {};
    const hash = createHash("sha256").update(draftFingerprint(event.occurredAt, decision.lines)).digest("hex");
    const accountingEvent = await record(AccountingEventStatus.POSTED, null, { contentHash: hash, periodId: period.id });
    await postJournalEntry(tx, {
      organizationId: ctx.organizationId,
      entryDate: occurredAt,
      description: event.description,
      kind: "STANDARD",
      reference: `${event.sourceType}:${event.sourceId}`,
      accountingEventId: accountingEvent.id,
      actorId: ctx.actorId,
      lines: resolved.map(({ draft, accountId }) => lineOf(draft, accountId as string, eventDims)),
    });
    summary.posted += 1;
  }
  return summary;
}

function lineOf(draft: DraftLine, accountId: string, dims: JournalDimensions) {
  return {
    accountId,
    debit: draft.debit,
    credit: draft.credit,
    cashSection: draft.cashSection ?? null,
    ...dims,
    // The cash account is a property of the cash line itself, not of the event.
    cashAccountId: draft.cashAccountId ?? null,
  };
}

// ── when a source stops being a valid fact ─────────────────────────────────
// A cancelled expense no longer projects an event. Its journal entry stays (a
// posted entry is never deleted) and is cancelled by a reversal, linked to it.

const SCOPE_SOURCES: [keyof ProjectionScope, string][] = [
  ["saleIds", "Sale"],
  ["saleReturnIds", "SaleReturn"],
  ["expenseIds", "Expense"],
  ["stockMovementIds", "StockMovement"],
  ["purchaseOrderIds", "PurchaseOrder"],
  ["invoiceIds", "Invoice"],
  ["depreciationEntryIds", "DepreciationEntry"],
  ["fixedAssetIds", "FixedAsset"],
];

async function reverseVanishedSources(
  tx: Prisma.TransactionClient,
  ctx: PostingContext,
  scope: ProjectionScope,
  projected: FinancialEvent[],
): Promise<number> {
  const alive = new Set(projected.map((e) => e.key));
  let reversed = 0;
  for (const [field, sourceType] of SCOPE_SOURCES) {
    const ids = scope[field];
    if (!ids || ids.length === 0) continue;
    const posted = await tx.accountingEvent.findMany({
      where: { organizationId: ctx.organizationId, sourceType, sourceId: { in: ids }, status: AccountingEventStatus.POSTED },
      include: { journalEntry: { select: { id: true } } },
    });
    // An event that never reached the book (not posted yet) and whose source has
    // gone away is closed out too, so it does not linger as "waiting".
    await tx.accountingEvent.updateMany({
      where: {
        organizationId: ctx.organizationId,
        sourceType,
        sourceId: { in: ids },
        status: { in: [AccountingEventStatus.NOT_POSTED, AccountingEventStatus.EXCEPTION] },
        eventKey: { notIn: [...alive] },
      },
      data: { status: AccountingEventStatus.NO_GL_EFFECT, statusReason: NotPostedReason.SOURCE_CANCELLED },
    });
    for (const ev of posted) {
      if (alive.has(ev.eventKey) || !ev.journalEntry) continue;
      await reverseJournalEntry(tx, {
        organizationId: ctx.organizationId,
        entryId: ev.journalEntry.id,
        reason: "Источник операции отменён",
        actorId: ctx.actorId,
      });
      await tx.accountingEvent.update({
        where: { id: ev.id },
        data: { status: AccountingEventStatus.REVERSED, statusReason: NotPostedReason.SOURCE_CANCELLED },
      });
      reversed += 1;
    }
  }
  return reversed;
}

// ── production: a real event with no ledger effect under current policy ────
// Raw materials become finished goods inside the single inventory account, at
// cost, so a completed batch moves no ledger balance. It is still recorded, so
// the trail from the batch exists and a value mismatch cannot hide.

export async function recordProductionEvent(
  tx: Prisma.TransactionClient,
  args: {
    organizationId: string;
    actorId: string;
    batchId: string;
    completedAt: Date;
    consumedValue: number;
    outputValue: number;
    outputQuantity: number;
  },
): Promise<void> {
  const ctx = await loadPostingContext(tx, args.organizationId, args.actorId);
  if (!ctx || args.completedAt < ctx.startsAt) return;
  const eventKey = `batch:${args.batchId}:production`;
  await lockPostingKey(tx, args.organizationId, eventKey);
  const existing = await tx.accountingEvent.findUnique({
    where: { organizationId_eventKey: { organizationId: args.organizationId, eventKey } },
    select: { id: true },
  });
  if (existing) return;
  const difference = Math.round((args.outputValue - args.consumedValue) * 100) / 100;
  const period = await ensurePeriod(tx, args.organizationId, args.completedAt);
  await tx.accountingEvent.create({
    data: {
      organizationId: args.organizationId,
      eventKey,
      sourceType: "ProductionBatch",
      sourceId: args.batchId,
      eventType: "PRODUCTION",
      eventDate: args.completedAt,
      accountingPeriodId: period.id,
      // Value moved from raw materials to finished goods at cost; if the two
      // sides ever differ the batch is an exception, not a silent variance.
      status: Math.abs(difference) <= 0.01 ? AccountingEventStatus.NO_GL_EFFECT : AccountingEventStatus.EXCEPTION,
      statusReason: Math.abs(difference) <= 0.01 ? "Сырьё → готовая продукция по себестоимости (единый счёт запасов)" : `Расхождение стоимости выпуска и расхода: ${difference}`,
      metadata: {
        consumedValue: args.consumedValue,
        outputValue: args.outputValue,
        outputQuantity: args.outputQuantity,
        // D6 is not approved: only ingredients are costed; no other component is capitalised.
        costComponents: "INGREDIENT only (D6 not approved)",
      } as Prisma.InputJsonValue,
      createdById: args.actorId,
    },
  });
}

// ── dimensions of an event, from its source document ────────────────────────

export async function loadDimensions(
  tx: Prisma.TransactionClient,
  organizationId: string,
  events: FinancialEvent[],
): Promise<Map<string, JournalDimensions>> {
  const out = new Map<string, JournalDimensions>();
  const idsOf = (type: string) => [...new Set(events.filter((e) => e.sourceType === type).map((e) => e.sourceId))];
  const keysOf = (type: string, id: string) => events.filter((e) => e.sourceType === type && e.sourceId === id).map((e) => e.key);
  const assign = (type: string, id: string, dims: JournalDimensions) => {
    for (const key of keysOf(type, id)) out.set(key, dims);
  };
  const where = (ids: string[]) => ({ organizationId, id: { in: ids } });

  const sales = idsOf("Sale");
  if (sales.length) {
    for (const r of await tx.sale.findMany({ where: where(sales), select: { id: true, locationId: true, customerId: true } })) {
      assign("Sale", r.id, { locationId: r.locationId, customerId: r.customerId });
    }
  }
  const returns = idsOf("SaleReturn");
  if (returns.length) {
    for (const r of await tx.saleReturn.findMany({
      where: where(returns),
      select: { id: true, locationId: true, sale: { select: { customerId: true } } },
    })) {
      assign("SaleReturn", r.id, { locationId: r.locationId, customerId: r.sale.customerId });
    }
  }
  const expenses = idsOf("Expense");
  if (expenses.length) {
    for (const r of await tx.expense.findMany({ where: where(expenses), select: { id: true, locationId: true, categoryId: true } })) {
      assign("Expense", r.id, { locationId: r.locationId, financeCategoryId: r.categoryId });
    }
  }
  const cash = idsOf("CashMovement");
  if (cash.length) {
    for (const r of await tx.cashMovement.findMany({
      where: where(cash),
      select: {
        id: true,
        customerId: true,
        supplierId: true,
        categoryId: true,
        account: { select: { locationId: true } },
        expense: { select: { categoryId: true, locationId: true } },
      },
    })) {
      assign("CashMovement", r.id, {
        locationId: r.expense?.locationId ?? r.account.locationId,
        customerId: r.customerId,
        supplierId: r.supplierId,
        financeCategoryId: r.categoryId ?? r.expense?.categoryId ?? null,
      });
    }
  }
  for (const [type, model] of [["PurchaseOrder", "purchaseOrder"], ["Invoice", "invoice"]] as const) {
    const ids = idsOf(type);
    if (!ids.length) continue;
    const rows = await (tx[model] as unknown as {
      findMany: (a: unknown) => Promise<{ id: string; locationId: string; supplierId: string }[]>;
    }).findMany({ where: where(ids), select: { id: true, locationId: true, supplierId: true } });
    for (const r of rows) assign(type, r.id, { locationId: r.locationId, supplierId: r.supplierId });
  }
  const movements = idsOf("StockMovement");
  if (movements.length) {
    for (const r of await tx.stockMovement.findMany({
      where: where(movements),
      select: { id: true, locationId: true, productId: true, product: { select: { categoryId: true } } },
    })) {
      assign("StockMovement", r.id, { locationId: r.locationId, productId: r.productId, categoryId: r.product.categoryId });
    }
  }
  const dep = idsOf("DepreciationEntry");
  if (dep.length) {
    for (const r of await tx.depreciationEntry.findMany({ where: where(dep), select: { id: true, asset: { select: { locationId: true } } } })) {
      assign("DepreciationEntry", r.id, { locationId: r.asset.locationId });
    }
  }
  const assets = idsOf("FixedAsset");
  if (assets.length) {
    for (const r of await tx.fixedAsset.findMany({ where: where(assets), select: { id: true, locationId: true } })) {
      assign("FixedAsset", r.id, { locationId: r.locationId });
    }
  }
  return out;
}

export const REQUIRED_SYSTEM_KEYS: readonly SystemAccountKey[] = SYSTEM_ACCOUNT_KEYS;
