import { PaymentMethod } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { round2 } from "../common/money";
import { allocateRefund } from "../sales/refund-allocation";

export interface TillTakings {
  // Money taken / given back per tender (PaymentMethod), and what was sold on credit.
  taken: Map<string, number>;
  refunded: Map<string, number>;
  onCredit: number;
  // The part of CARD that the Kaspi terminal reported as paid by QR (and given back the same way).
  qrTaken: number;
  qrRefunded: number;
  checks: number;
  returns: number;
  revenue: number;
}

// What a point's till took in [start, end), by tender — «Сверка дня» and the
// till shift's X/Z-report read it the same way.
export async function tillTakings(prisma: PrismaService, organizationId: string, locationId: string, start: Date, end: Date): Promise<TillTakings> {
  const [sales, returns] = await Promise.all([
    prisma.sale.findMany({
      where: { organizationId, locationId, soldAt: { gte: start, lt: end } },
      select: { totalAmount: true, amountPaid: true, paymentMethod: true, terminalMethod: true, payments: { select: { method: true, amount: true } } },
    }),
    prisma.saleReturn.findMany({
      where: { organizationId, locationId, returnedAt: { gte: start, lt: end } },
      select: {
        id: true,
        totalAmount: true,
        creditedAmount: true,
        sale: { select: { paymentMethod: true, terminalMethod: true, payments: { select: { method: true, amount: true } } } },
        cashMovements: { select: { amount: true, account: { select: { type: true } } } },
      },
    }),
  ]);

  const taken = new Map<string, number>();
  let qrTaken = 0;
  let onCredit = 0;
  let revenue = 0;
  // Same rule as the Sales summary: a split sale is its payment rows, anything
  // else is its single method for what was actually paid.
  for (const sale of sales) {
    const paid = sale.amountPaid.toNumber();
    revenue += sale.totalAmount.toNumber();
    onCredit += sale.totalAmount.toNumber() - paid;
    const tenders = sale.payments.length > 0 ? sale.payments.map((p) => ({ method: p.method, amount: p.amount.toNumber() })) : [{ method: sale.paymentMethod, amount: paid }];
    for (const t of tenders) {
      if (t.amount <= 0 || t.method === PaymentMethod.MIXED) continue;
      taken.set(t.method, (taken.get(t.method) ?? 0) + t.amount);
      if (t.method === PaymentMethod.CARD && sale.terminalMethod === "qr") qrTaken += t.amount;
    }
  }

  // Refunds by tender. Cash is exact: what actually left the till for that
  // return. The rest goes back the way the sale was paid (D8), in proportion for a
  // split sale.
  const refunded = new Map<string, number>();
  let qrRefunded = 0;
  let viaQr = false;
  const addRefund = (method: string, amount: number) => {
    refunded.set(method, (refunded.get(method) ?? 0) + amount);
    if (method === PaymentMethod.CARD && viaQr) qrRefunded += amount;
  };
  for (const ret of returns) {
    viaQr = ret.sale.terminalMethod === "qr";
    // Only money that went back; a return against an unpaid debt moved none.
    const total = round2(ret.totalAmount.toNumber() - ret.creditedAmount.toNumber());
    if (total <= 0) continue;
    const sale = ret.sale;
    if (sale.paymentMethod !== PaymentMethod.MIXED) {
      addRefund(sale.paymentMethod, total);
      continue;
    }
    const cashOut = ret.cashMovements.filter((m) => m.account.type === "CASH").reduce((s, m) => s + m.amount.toNumber(), 0);
    if (cashOut > 0) addRefund(PaymentMethod.CASH, cashOut);
    const rest = round2(total - cashOut);
    const nonCash = sale.payments.filter((p) => p.method !== PaymentMethod.CASH).map((p) => ({ method: p.method, amount: p.amount.toNumber() }));
    if (rest > 0 && nonCash.some((t) => t.amount > 0)) {
      for (const part of allocateRefund(rest, nonCash)) addRefund(part.method, part.amount);
    }
  }

  return { taken, refunded, onCredit: round2(onCredit), qrTaken: round2(qrTaken), qrRefunded: round2(qrRefunded), checks: sales.length, returns: returns.length, revenue: round2(revenue) };
}
