import {
  BalanceLine,
  FinancialEvent,
  FinancialEventType,
  PnlLine,
} from "@bakery-os/shared";
import { CostingService } from "../../costing/costing.service";
import { round2 } from "../../common/money";
import { expenseAccrualEffect } from "./rules";
import { scoped, type DbClient } from "./scope";
import type { ProjectionOptions } from "./projector";

// The accrual side of the catalogue: what the documents say happened,
// independent of when money moved.
//
//   opening        the declared opening position (inventory, receivables, payables, opening assets)
//   sale           Receivables ↑, Revenue ↑, Discounts ↓
//   sale cost      Inventory ↓ (or a consignment payable ↑), Cost of goods ↓
//   sale return    Receivables ↓, Returns ↓ ; if restocked, the cost comes back
//   expense        Expense payable ↑, and the P&L line or balance line its category says
//   stock loss     write-offs and count shortages: Inventory ↓, Inventory loss ↓ (a surplus is the reverse)
//   manual receipt stock received with no purchase document: Inventory ↑ and NOTHING to balance it
//                  — the counter-side is unknown, so the event is incomplete.
//
// Every figure uses the same source order as the P&L, so the two can be checked
// against each other: the cost stamped when it happened, consignment terms, and
// only then today's cost.

export async function accrualEvents(
  prisma: DbClient,
  costing: CostingService,
  organizationId: string,
  opts: ProjectionOptions,
): Promise<FinancialEvent[]> {
  const upTo = opts.upTo;
  const before = (field: string) => (upTo ? { [field]: { lte: upTo } } : {});
  // A scoped projection (the ledger posting one document) reads only the named
  // documents; an unscoped one (every report) reads everything, as it always did.
  const isScoped = opts.scope !== undefined;
  const saleIds = scoped(opts.scope, "saleIds");
  const returnIds = scoped(opts.scope, "saleReturnIds");
  const expenseIds = scoped(opts.scope, "expenseIds");
  const movementIds = scoped(opts.scope, "stockMovementIds");
  const only = (ids: string[] | undefined) => (ids ? { id: { in: ids } } : {});
  const none = (ids: string[] | undefined) => ids !== undefined && ids.length === 0;

  const [org, sales, returns, expenses, movements, openingAssets] = await Promise.all([
    isScoped ? Promise.resolve(null) : prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        financeInitializedAt: true,
        openingInventoryValue: true,
        openingReceivablesValue: true,
        openingPayablesValue: true,
      },
    }),
    none(saleIds) ? Promise.resolve([]) : prisma.sale.findMany({
      where: { organizationId, ...only(saleIds), ...before("soldAt") },
      include: { items: { include: { product: { select: { trackInventory: true } } } } },
    }),
    none(returnIds) ? Promise.resolve([]) : prisma.saleReturn.findMany({
      where: { organizationId, ...only(returnIds), ...before("returnedAt") },
      include: { items: { include: { product: { select: { trackInventory: true } } } } },
    }),
    none(expenseIds) ? Promise.resolve([]) : prisma.expense.findMany({
      where: { organizationId, ...only(expenseIds), status: "CONFIRMED", ...before("incurredOn") },
      include: { categoryRef: true },
    }),
    none(movementIds) ? Promise.resolve([]) : prisma.stockMovement.findMany({
      where: {
        organizationId,
        ...only(movementIds),
        ...before("createdAt"),
        // Annulled erroneous receipts and write-offs are not events at all.
        voidLine: null,
        OR: [
          { type: "WRITE_OFF", saleReturnId: null },
          { type: "ADJUSTMENT" },
          { type: "RECEIPT", purchaseOrderId: null, invoiceId: null, batchId: null },
        ],
      },
      select: { id: true, type: true, productId: true, quantity: true, unitCost: true, createdAt: true, stocktakeId: true },
    }),
    isScoped ? Promise.resolve([]) : prisma.fixedAsset.findMany({ where: { organizationId, isOpening: true }, select: { acquisitionCost: true } }),
  ]);
  // Today's cost is only the last resort for a line with no snapshot, so a
  // scoped projection asks for just the products it touches.
  const neededProducts = isScoped
    ? [...new Set([
        ...sales.flatMap((x) => x.items.map((i) => i.productId)),
        ...returns.flatMap((x) => x.items.map((i) => i.productId)),
        ...movements.map((m) => m.productId),
      ])]
    : undefined;
  const currentCosts =
    neededProducts && neededProducts.length === 0
      ? new Map()
      : await costing.currentUnitCosts(organizationId, prisma, neededProducts);

  const events: FinancialEvent[] = [];
  const costOf = (snapshot: { toNumber: () => number } | null, consignment: { toNumber: () => number } | null, productId: string): number | null => {
    if (snapshot) return snapshot.toNumber();
    if (consignment) return consignment.toNumber();
    return currentCosts.get(productId)?.unitCost ?? null;
  };

  // ── the declared opening position ──────────────────────────────────────
  if (org?.financeInitializedAt && (!upTo || org.financeInitializedAt <= upTo)) {
    const inventory = round2(org.openingInventoryValue?.toNumber() ?? 0);
    const receivables = round2(org.openingReceivablesValue?.toNumber() ?? 0);
    const payables = round2(org.openingPayablesValue?.toNumber() ?? 0);
    const assets = round2(openingAssets.reduce((s, a) => s + a.acquisitionCost.toNumber(), 0));
    // Opening cash is declared account by account (OPENING_BALANCE movements,
    // which carry their own equity leg); this event adds the rest.
    events.push({
      key: `opening:${organizationId}`,
      type: FinancialEventType.OPENING_POSITION,
      occurredAt: org.financeInitializedAt.toISOString(),
      sourceType: "Organization",
      sourceId: organizationId,
      description: "Заявленный начальный остаток",
      cash: [],
      balance: [
        { line: BalanceLine.INVENTORY, delta: inventory },
        { line: BalanceLine.RECEIVABLES, delta: receivables },
        { line: BalanceLine.FIXED_ASSETS, delta: assets },
        { line: BalanceLine.SUPPLIER_PAYABLES, delta: payables },
        { line: BalanceLine.OPENING_EQUITY, delta: round2(inventory + receivables + assets - payables) },
      ],
      pnl: [],
      unclassified: false,
    });
  }

  // ── sales ──────────────────────────────────────────────────────────────
  for (const sale of sales) {
    let discounts = 0;
    for (const item of sale.items) {
      if (item.fullUnitPrice) {
        discounts += round2((item.fullUnitPrice.toNumber() - item.unitPrice.toNumber()) * item.quantity.toNumber());
      }
    }
    discounts = round2(discounts);
    const total = round2(sale.totalAmount.toNumber());
    events.push({
      key: `sale:${sale.id}`,
      type: FinancialEventType.SALE,
      occurredAt: sale.soldAt.toISOString(),
      sourceType: "Sale",
      sourceId: sale.id,
      description: "Продажа",
      cash: [],
      balance: [{ line: BalanceLine.RECEIVABLES, delta: total }],
      pnl: [
        { line: PnlLine.REVENUE, amount: round2(total + discounts) },
        ...(discounts !== 0 ? [{ line: PnlLine.DISCOUNTS, amount: -discounts }] : []),
      ],
      unclassified: false,
    });
    events.push(...costEvents("sale", sale.id, sale.soldAt, sale.items, costOf, "OUT"));
  }

  // ── returns ────────────────────────────────────────────────────────────
  for (const ret of returns) {
    const total = round2(ret.totalAmount.toNumber());
    events.push({
      key: `saleReturn:${ret.id}`,
      type: FinancialEventType.SALE_RETURN,
      occurredAt: ret.returnedAt.toISOString(),
      sourceType: "SaleReturn",
      sourceId: ret.id,
      description: "Возврат от покупателя",
      cash: [],
      // Receivable falls first: a return against an unpaid balance simply
      // shrinks it; against a paid one it goes negative until the refund settles it.
      balance: [{ line: BalanceLine.RECEIVABLES, delta: -total }],
      pnl: [{ line: PnlLine.RETURNS, amount: -total }],
      unclassified: false,
    });
    // Cost comes back only when the goods went back on the shelf; a scrapped
    // return keeps its cost of goods.
    if (ret.restocked) events.push(...costEvents("saleReturn", ret.id, ret.returnedAt, ret.items, costOf, "IN"));
  }

  // ── expenses ───────────────────────────────────────────────────────────
  for (const expense of expenses) {
    const amount = round2(expense.amount.toNumber());
    const effect = expenseAccrualEffect(expense.categoryRef);
    const balance = [{ line: BalanceLine.EXPENSE_PAYABLES, delta: amount }];
    const pnl: FinancialEvent["pnl"] = [];
    if (effect.pnlLine) pnl.push({ line: effect.pnlLine, amount: -amount });
    if (effect.balanceLine === BalanceLine.FIXED_ASSETS) balance.push({ line: BalanceLine.FIXED_ASSETS, delta: amount });
    else if (effect.balanceLine === BalanceLine.OWNER_WITHDRAWALS) balance.push({ line: BalanceLine.OWNER_WITHDRAWALS, delta: -amount });
    else if (effect.balanceLine === BalanceLine.LOANS) balance.push({ line: BalanceLine.LOANS, delta: -amount });
    events.push({
      key: `expense:${expense.id}:accrual`,
      type: FinancialEventType.EXPENSE_ACCRUAL,
      occurredAt: expense.incurredOn.toISOString(),
      sourceType: "Expense",
      sourceId: expense.id,
      description: expense.description ?? "Расход",
      categoryName: expense.categoryRef?.name ?? null,
      cash: [],
      balance,
      pnl,
      unclassified: false,
    });
  }

  // ── stock losses, gains and unexplained receipts ───────────────────────
  for (const m of movements) {
    const unitCost = costOf(m.unitCost, null, m.productId);
    if (unitCost === null) continue; // no cost, no value — counted as unknown by the P&L
    const quantity = m.quantity.toNumber();
    if (m.type === "RECEIPT") {
      const value = round2(quantity * unitCost);
      events.push({
        key: `stock:${m.id}`,
        type: FinancialEventType.INVENTORY_GAIN,
        occurredAt: m.createdAt.toISOString(),
        sourceType: "StockMovement",
        sourceId: m.id,
        description: "Приход на склад без закупочного документа",
        cash: [],
        balance: [{ line: BalanceLine.INVENTORY, delta: value }],
        pnl: [],
        // Stock appeared; what paid for it is not recorded. Nothing is invented.
        unclassified: true,
      });
      continue;
    }
    // WRITE_OFF stores a positive quantity that left stock; ADJUSTMENT stores the signed delta.
    const lossQuantity = m.type === "WRITE_OFF" ? quantity : -quantity;
    const value = round2(lossQuantity * unitCost);
    if (value === 0) continue;
    events.push({
      key: `stock:${m.id}`,
      type: value > 0 ? FinancialEventType.INVENTORY_LOSS : FinancialEventType.INVENTORY_GAIN,
      occurredAt: m.createdAt.toISOString(),
      sourceType: "StockMovement",
      sourceId: m.id,
      description: m.type === "WRITE_OFF" ? "Списание" : m.stocktakeId ? "Инвентаризация" : "Корректировка остатка",
      cash: [],
      balance: [{ line: BalanceLine.INVENTORY, delta: -value }],
      pnl: [{ line: PnlLine.INVENTORY_LOSS, amount: -value }],
      unclassified: false,
    });
  }
  return events;
}

// The cost side of a sale (OUT) or of a restocked return (IN).
function costEvents(
  kind: "sale" | "saleReturn",
  id: string,
  at: Date,
  items: {
    productId: string;
    quantity: { toNumber: () => number };
    unitCost: { toNumber: () => number } | null;
    consignmentUnitCost: { toNumber: () => number } | null;
    product: { trackInventory: boolean };
  }[],
  costOf: (s: { toNumber: () => number } | null, c: { toNumber: () => number } | null, productId: string) => number | null,
  direction: "OUT" | "IN",
): FinancialEvent[] {
  const sign = direction === "OUT" ? 1 : -1; // OUT: cost expense (−), IN: cost returned (+)
  let inventory = 0;
  let consignment = 0;
  let untracked = 0;
  for (const item of items) {
    const unitCost = costOf(item.unitCost, item.consignmentUnitCost, item.productId);
    if (unitCost === null) continue;
    const value = round2(unitCost * item.quantity.toNumber());
    // Goods held on consignment are not ours: selling one creates a payable to
    // its owner instead of drawing down our inventory.
    if (item.consignmentUnitCost) consignment += value;
    else if (!item.product.trackInventory) untracked += value;
    else inventory += value;
  }
  inventory = round2(inventory);
  consignment = round2(consignment);
  untracked = round2(untracked);
  const type = kind === "sale" ? FinancialEventType.SALE_COST : FinancialEventType.SALE_RETURN_COST;
  const base = { occurredAt: at.toISOString(), sourceType: kind === "sale" ? "Sale" : "SaleReturn", sourceId: id, type };
  const out: FinancialEvent[] = [];
  if (inventory !== 0 || consignment !== 0) {
    out.push({
      ...base,
      key: `${kind}:${id}:cost`,
      description: kind === "sale" ? "Себестоимость проданного" : "Себестоимость возвращённого на склад",
      cash: [],
      balance: [
        ...(inventory !== 0 ? [{ line: BalanceLine.INVENTORY, delta: -sign * inventory }] : []),
        ...(consignment !== 0 ? [{ line: BalanceLine.CONSIGNMENT_PAYABLES, delta: sign * consignment }] : []),
      ],
      pnl: [{ line: PnlLine.COGS, amount: -sign * round2(inventory + consignment) }],
      unclassified: false,
    });
  }
  if (untracked !== 0) {
    // A resource that is never held as stock (tap water…) has no inventory to
    // draw down: its cost is in the P&L with nothing on the balance side.
    out.push({
      ...base,
      key: `${kind}:${id}:cost-untracked`,
      description: "Себестоимость ресурса без складского учёта",
      cash: [],
      balance: [],
      pnl: [{ line: PnlLine.COGS, amount: -sign * untracked }],
      unclassified: true,
    });
  }
  return out;
}
