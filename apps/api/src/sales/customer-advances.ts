import { Prisma } from "@prisma/client";
import { CashMovementType } from "@bakery-os/shared";
import { round2 } from "../common/money";

type Db = Prisma.TransactionClient;

// A customer's advance = money received from them with no sale behind it
// (CUSTOMER_PAYMENT, customerId set, saleId null) less what was already
// counted toward their sales (CustomerAdvanceApplication). On a past moment,
// only what happened up to it.
export async function customerAdvanceBalance(db: Db, organizationId: string, customerId: string, asOf?: Date): Promise<number> {
  const at = asOf ? { lte: asOf } : undefined;
  const [received, applied] = await Promise.all([
    db.cashMovement.aggregate({
      where: { organizationId, customerId, saleId: null, type: CashMovementType.CUSTOMER_PAYMENT, ...(at ? { occurredAt: at } : {}) },
      _sum: { amount: true },
    }),
    db.customerAdvanceApplication.aggregate({
      where: { organizationId, customerId, ...(at ? { appliedAt: at } : {}) },
      _sum: { amount: true },
    }),
  ]);
  return round2((received._sum.amount?.toNumber() ?? 0) - (applied._sum.amount?.toNumber() ?? 0));
}

// Every customer's advance at once (for the debts report and the balance sheet).
export async function customerAdvanceBalances(db: Db, organizationId: string, asOf?: Date): Promise<Map<string, number>> {
  const at = asOf ? { lte: asOf } : undefined;
  const [received, applied] = await Promise.all([
    db.cashMovement.groupBy({
      by: ["customerId"],
      where: { organizationId, customerId: { not: null }, saleId: null, type: CashMovementType.CUSTOMER_PAYMENT, ...(at ? { occurredAt: at } : {}) },
      _sum: { amount: true },
    }),
    db.customerAdvanceApplication.groupBy({
      by: ["customerId"],
      where: { organizationId, ...(at ? { appliedAt: at } : {}) },
      _sum: { amount: true },
    }),
  ]);
  const out = new Map<string, number>();
  for (const r of received) out.set(r.customerId as string, r._sum.amount?.toNumber() ?? 0);
  for (const a of applied) out.set(a.customerId, (out.get(a.customerId) ?? 0) - (a._sum.amount?.toNumber() ?? 0));
  for (const [id, v] of out) out.set(id, round2(v));
  return out;
}

// Locks the customer row: two sales or payments of one customer racing each
// other must not count the same advance twice.
export async function lockCustomer(db: Db, customerId: string): Promise<void> {
  await db.$queryRaw`SELECT id FROM "customers" WHERE id = ${customerId} FOR UPDATE`;
}

// Counts the customer's advance toward one sale's unpaid part. Moves no money
// (it moved when the advance came in): raises Sale.amountPaid and records the
// application. Returns the amount applied (0 when there is no advance).
export async function applyCustomerAdvance(
  db: Db,
  args: { organizationId: string; customerId: string; saleId: string; unpaid: number; actorId: string },
): Promise<number> {
  if (args.unpaid <= 0.004) return 0;
  await lockCustomer(db, args.customerId);
  const available = await customerAdvanceBalance(db, args.organizationId, args.customerId);
  const amount = round2(Math.min(available, args.unpaid));
  if (amount <= 0.004) return 0;
  await db.customerAdvanceApplication.create({
    data: { organizationId: args.organizationId, customerId: args.customerId, saleId: args.saleId, amount, createdById: args.actorId },
  });
  await db.sale.update({ where: { id: args.saleId }, data: { amountPaid: { increment: amount } } });
  return amount;
}
