import { round2 } from "../common/money";
type Money = { toNumber: () => number };

// What a received order still owes its supplier: what was received, less the
// goods handed back, less what was paid (a reversed payment does not count),
// plus the money the supplier already gave back for returned goods. The one
// formula behind the order card, the payment guard, the payables and debts.
export function purchaseOrderOwed(order: {
  receivedTotal: Money | null;
  totalCost: Money;
  payments: { amount: Money; reversedAt: Date | null }[];
  supplierReturns: { creditedAmount: Money; refundedAmount: Money }[];
}): number {
  const received = (order.receivedTotal ?? order.totalCost).toNumber();
  const paid = order.payments.filter((p) => !p.reversedAt).reduce((s, p) => s + p.amount.toNumber(), 0);
  const credited = order.supplierReturns.reduce((s, r) => s + r.creditedAmount.toNumber(), 0);
  const refunded = order.supplierReturns.reduce((s, r) => s + r.refundedAmount.toNumber(), 0);
  return round2(received - credited - paid + refunded);
}
