import { BalanceLine, CashSection, FinancialEvent, FinancialEventType } from "@bakery-os/shared";
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
      select: { id: true, totalCost: true, receivedTotal: true, receivedAt: true },
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
    const total = round2((o.receivedTotal ?? o.totalCost).toNumber());
    const recognized = cutover !== null && o.receivedAt! >= cutover;
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

// RESERVED semantics of a supplier return — there is no workflow or screen for
// it yet, and nothing calls this. It fixes what such a return MEANS so the
// ledger does not have to be redesigned later:
//   Inventory ↓ at the cost the goods were received at,
//   Supplier payable ↓ by the credited amount (the debt shrinks),
//   Cash ↑ only for the part of that credit already paid and refunded.
// Faking it with a stock adjustment plus a payment reversal is NOT this model:
// that loses the link between the goods, the credit and the refund.
export function supplierReturnEvent(input: {
  returnId: string;
  occurredAt: Date;
  creditedAmount: number;
  refundedCash: number;
  cashAccountId?: string;
}): FinancialEvent {
  const credited = round2(input.creditedAmount);
  const refunded = round2(input.refundedCash);
  return {
    key: `supplierReturn:${input.returnId}`,
    type: FinancialEventType.SUPPLIER_RETURN,
    occurredAt: input.occurredAt.toISOString(),
    sourceType: "SupplierReturn",
    sourceId: input.returnId,
    description: "Возврат поставщику",
    cash:
      refunded > 0 && input.cashAccountId
        ? [{ accountId: input.cashAccountId, section: CashSection.OPERATING, amount: refunded }]
        : [],
    balance: [
      { line: BalanceLine.INVENTORY, delta: -credited },
      // The debt shrinks by the credit; what had already been paid comes back as cash.
      { line: BalanceLine.SUPPLIER_PAYABLES, delta: -(credited - refunded) },
      ...(refunded > 0 ? [{ line: BalanceLine.CASH_AND_BANK, delta: refunded }] : []),
    ],
    pnl: [],
    unclassified: false,
  };
}
