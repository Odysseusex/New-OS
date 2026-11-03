import { BalanceLine, FinancialEvent, FinancialEventType } from "@bakery-os/shared";
import { round2 } from "../../common/money";
import { scoped, type DbClient } from "./scope";
import type { ProjectionOptions } from "./projector";

// Purchasing, on the accrual side:
//   received order (after the cutover)  Inventory ↑, Supplier payable ↑
//   confirmed legacy invoice            Inventory ↑, Supplier payable ↑
// The payments that settle them are cash events (cash-events.ts). An order
// received BEFORE the cutover never created a payable: its goods are in stock
// but what paid for them is unknown to the system, so its event is reported as
// incomplete instead of inventing a counter-side.

export async function purchaseEvents(
  prisma: DbClient,
  organizationId: string,
  opts: ProjectionOptions,
): Promise<FinancialEvent[]> {
  const orderIds = scoped(opts.scope, "purchaseOrderIds");
  const invoiceIds = scoped(opts.scope, "invoiceIds");
  if (orderIds && invoiceIds && orderIds.length === 0 && invoiceIds.length === 0) return [];
  const [org, orders, invoices] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { purchaseCutoverAt: true } }),
    orderIds && orderIds.length === 0 ? Promise.resolve([]) : prisma.purchaseOrder.findMany({
      where: { organizationId, ...(orderIds ? { id: { in: orderIds } } : {}), status: "RECEIVED", receivedAt: { not: null, ...(opts.upTo ? { lte: opts.upTo } : {}) } },
      select: {
        id: true,
        totalCost: true,
        receivedTotal: true,
        receivedAt: true,
        revisions: { select: { number: true, totalBefore: true, totalAfter: true }, orderBy: { number: "asc" } },
        supplierReturns: {
          ...(opts.upTo ? { where: { createdAt: { lte: opts.upTo } } } : {}),
          select: { id: true, creditedAmount: true, createdAt: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        },
      },
    }),
    invoiceIds && invoiceIds.length === 0 ? Promise.resolve([]) : prisma.invoice.findMany({
      where: { organizationId, ...(invoiceIds ? { id: { in: invoiceIds } } : {}), status: "CONFIRMED", confirmedAt: { not: null, ...(opts.upTo ? { lte: opts.upTo } : {}) } },
      select: {
        id: true,
        number: true,
        totalCost: true,
        amountPaid: true,
        confirmedAt: true,
        cashMovements: { where: { type: "SUPPLIER_PAYMENT" }, select: { amount: true } },
      },
    }),
  ]);
  const cutover = org?.purchaseCutoverAt ?? null;
  const events: FinancialEvent[] = [];

  for (const o of orders) {
    // A corrected order keeps its receipt event at what was received, and each
    // correction is its own event for the difference, dated at the receipt
    // (the document is corrected, not a new delivery). An entry already posted
    // for the receipt therefore never changes; the correction posts beside it.
    const deltas = o.revisions.map((r) => ({ number: r.number, delta: round2(r.totalAfter.toNumber() - r.totalBefore.toNumber()) }));
    const total = round2((o.receivedTotal ?? o.totalCost).toNumber() - deltas.reduce((s, d) => s + d.delta, 0));
    const recognized = cutover !== null && o.receivedAt! >= cutover;
    for (const d of deltas) {
      if (d.delta === 0) continue;
      events.push({
        key: `purchaseOrder:${o.id}:revision:${d.number}`,
        type: FinancialEventType.PURCHASE_RECEIPT,
        occurredAt: o.receivedAt!.toISOString(),
        sourceType: "PurchaseOrder",
        sourceId: o.id,
        description: `Исправление приёмки заказа поставщику (№${d.number})`,
        cash: [],
        balance: recognized
          ? [
              { line: BalanceLine.INVENTORY, delta: d.delta },
              { line: BalanceLine.SUPPLIER_PAYABLES, delta: d.delta },
            ]
          : [{ line: BalanceLine.INVENTORY, delta: d.delta }],
        pnl: [],
        unclassified: !recognized,
      });
    }
    events.push({
      key: `purchaseOrder:${o.id}:receipt`,
      type: FinancialEventType.PURCHASE_RECEIPT,
      occurredAt: o.receivedAt!.toISOString(),
      sourceType: "PurchaseOrder",
      sourceId: o.id,
      description: recognized ? "Приёмка заказа поставщику" : "Приёмка заказа поставщику (до перехода на новый порядок)",
      cash: [],
      balance: recognized
        ? [
            { line: BalanceLine.INVENTORY, delta: total },
            { line: BalanceLine.SUPPLIER_PAYABLES, delta: total },
          ]
        : [{ line: BalanceLine.INVENTORY, delta: total }],
      pnl: [],
      unclassified: !recognized,
    });
    o.supplierReturns.forEach((r, i) => {
      events.push(
        supplierReturnEvent({ orderId: o.id, returnId: r.id, number: i + 1, occurredAt: r.createdAt, creditedAmount: r.creditedAmount.toNumber(), recognized }),
      );
    });
  }

  for (const i of invoices) {
    const total = round2(i.totalCost.toNumber());
    events.push({
      key: `invoice:${i.id}:receipt`,
      type: FinancialEventType.INVOICE_RECEIPT,
      occurredAt: i.confirmedAt!.toISOString(),
      sourceType: "Invoice",
      sourceId: i.id,
      description: `Приёмка по накладной №${i.number}`,
      cash: [],
      balance: [
        { line: BalanceLine.INVENTORY, delta: total },
        { line: BalanceLine.SUPPLIER_PAYABLES, delta: total },
      ],
      pnl: [],
      unclassified: false,
    });
    // Part of an invoice marked as paid with no cash movement behind it (the
    // opening reconciliation): the debt went down, but by what, the ledger
    // does not say. Reported as incomplete, never given a counter-side.
    const viaCash = i.cashMovements.reduce((s, m) => s + m.amount.toNumber(), 0);
    const outside = round2(i.amountPaid.toNumber() - viaCash);
    if (outside > 0) {
      events.push({
        key: `invoice:${i.id}:settled-outside-cash`,
        type: FinancialEventType.SUPPLIER_PAYMENT,
        occurredAt: i.confirmedAt!.toISOString(),
        sourceType: "Invoice",
        sourceId: i.id,
        description: `Накладная №${i.number}: погашено вне кассы`,
        cash: [],
        balance: [{ line: BalanceLine.SUPPLIER_PAYABLES, delta: -outside }],
        pnl: [],
        unclassified: true,
      });
    }
  }
  return events;
}

// Goods of a received order handed back to its supplier (SupplierReturn):
//   Inventory ↓ at the price they were received at,
//   Supplier payable ↓ by the same amount (the debt shrinks).
// Money the supplier hands back when the order was already paid is NOT in this
// event: it is a cash movement of its own (cash-events.ts, «Возврат денег от
// поставщика»: cash ↑, payable ↑), exactly like a payment is. Together they make
// inventory ↓, cash ↑ and the debt settled. For an order received before the
// purchasing cutover there was no debt to reduce, so — like its receipt — the
// event keeps only what it knows and is reported as incomplete.
// Keyed under the order (sourceType PurchaseOrder), so posting the order's scope
// posts its returns too.
export function supplierReturnEvent(input: {
  orderId: string;
  returnId: string;
  // The return's place among the order's returns (append-only, so stable).
  number: number;
  occurredAt: Date;
  creditedAmount: number;
  recognized: boolean;
}): FinancialEvent {
  const credited = round2(input.creditedAmount);
  return {
    key: `purchaseOrder:${input.orderId}:return:${input.returnId}`,
    type: FinancialEventType.SUPPLIER_RETURN,
    occurredAt: input.occurredAt.toISOString(),
    sourceType: "PurchaseOrder",
    sourceId: input.orderId,
    description: `Возврат товара поставщику (№${input.number})`,
    cash: [],
    balance: input.recognized
      ? [
          { line: BalanceLine.INVENTORY, delta: -credited },
          { line: BalanceLine.SUPPLIER_PAYABLES, delta: -credited },
        ]
      : [{ line: BalanceLine.INVENTORY, delta: -credited }],
    pnl: [],
    unclassified: !input.recognized,
  };
}
