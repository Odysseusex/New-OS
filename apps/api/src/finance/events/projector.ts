import { Inject, Injectable } from "@nestjs/common";
import { CashMovementType, FinancialEvent } from "@bakery-os/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { CashMovementSource, cashMovementEvent, transferEvent } from "./cash-events";
import { CategoryLike } from "./rules";
import { purchaseEvents } from "./purchase-events";
import { fixedAssetEvents } from "./fixed-asset-events";
import { accrualEvents } from "./accrual-events";
import { CostingService } from "../../costing/costing.service";
import { DbClient, ProjectionScope, scoped } from "./scope";
export type { DbClient, ProjectionScope } from "./scope";
export { scoped } from "./scope";

export interface ProjectionOptions {
  // Only events that happened at or before this moment. Defaults to everything.
  upTo?: Date;
  scope?: ProjectionScope;
}

// Rebuilds the organization's financial events from its source ledgers and
// documents. Nothing here writes: the result is a pure function of what is
// stored, sorted deterministically, so running it twice over unchanged data
// gives byte-identical output (invariant I5).
@Injectable()
export class FinancialEventProjector {
  constructor(
    // A union type erases the DI token, so it is named explicitly.
    @Inject(PrismaService) private prisma: DbClient,
    private costing: CostingService = new CostingService(prisma as PrismaService),
  ) {}

  // Every event family, side by side. Each source returns its own events; the
  // projector only merges and orders them.
  async project(organizationId: string, opts: ProjectionOptions = {}): Promise<FinancialEvent[]> {
    const parts = await Promise.all([
      this.cashEvents(organizationId, opts),
      purchaseEvents(this.prisma, organizationId, opts),
      fixedAssetEvents(this.prisma, organizationId, opts),
      accrualEvents(this.prisma, this.costing, organizationId, opts),
    ]);
    const events = parts.flat();
    // Deterministic order: time, then key. Never insertion order.
    events.sort((a, b) => (a.occurredAt === b.occurredAt ? (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) : a.occurredAt < b.occurredAt ? -1 : 1));
    return events;
  }

  private async cashEvents(organizationId: string, opts: ProjectionOptions): Promise<FinancialEvent[]> {
    const ids = scoped(opts.scope, "cashMovementIds");
    if (ids && ids.length === 0) return [];
    let rows = await this.prisma.cashMovement.findMany({
      where: { organizationId, ...(ids ? { id: { in: ids } } : {}), ...(opts.upTo ? { occurredAt: { lte: opts.upTo } } : {}) },
      include: { categoryRef: true, expense: { include: { categoryRef: true } } },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    });
    if (ids) {
      // A transfer is one event over two movements: bring the other leg in.
      const groups = [...new Set(rows.map((r) => r.transferGroupId).filter((g): g is string => !!g))];
      if (groups.length > 0) {
        const known = new Set(rows.map((r) => r.id));
        const legs = await this.prisma.cashMovement.findMany({
          where: { organizationId, transferGroupId: { in: groups }, id: { notIn: [...known] } },
          include: { categoryRef: true, expense: { include: { categoryRef: true } } },
        });
        rows = [...rows, ...legs];
      }
    }

    const events: FinancialEvent[] = [];
    const transferGroups = new Map<string, CashMovementSource[]>();
    for (const row of rows) {
      const source: CashMovementSource = {
        id: row.id,
        accountId: row.accountId,
        type: row.type,
        amount: row.amount.toNumber(),
        occurredAt: row.occurredAt,
        categoryId: row.categoryId,
        expenseId: row.expenseId,
        invoiceId: row.invoiceId,
        consignmentPaymentId: row.consignmentPaymentId,
        purchaseOrderPaymentId: row.purchaseOrderPaymentId,
        fixedAssetId: row.fixedAssetId,
        saleId: row.saleId,
        transferGroupId: row.transferGroupId,
      };
      if (row.type === CashMovementType.TRANSFER_IN || row.type === CashMovementType.TRANSFER_OUT) {
        if (row.transferGroupId) {
          const group = transferGroups.get(row.transferGroupId) ?? [];
          group.push(source);
          transferGroups.set(row.transferGroupId, group);
        } else {
          events.push(transferEvent([source], `transfer:single-${row.id}`));
        }
        continue;
      }
      // An expense payment carries the expense's category when the movement has none of its own.
      const category: CategoryLike | null = row.categoryRef ?? row.expense?.categoryRef ?? null;
      events.push(cashMovementEvent(source, category));
    }
    for (const [group, legs] of transferGroups) events.push(transferEvent(legs, `transfer:${group}`));
    return events;
  }
}
