import { BadRequestException } from "@nestjs/common";

// D8: a refund follows the ORIGINAL tender allocation, proportionally, unless a
// person explicitly overrides it. A sale paid 6 000 cash + 4 000 card, refunded
// 5 000, hands back 3 000 cash + 2 000 card.
//
// Whole tiyn only, in integer arithmetic (BigInt, so a large total times a large
// share cannot lose precision). When the proportions do not divide into whole
// tiyn the leftover goes to the tenders with the largest fractional parts —
// the largest-remainder method — so the parts always add up to the refund
// exactly, and the result never depends on the order the tenders arrived in.

export interface Tender {
  method: string;
  amount: number;
}

const toTiyn = (amount: number): bigint => BigInt(Math.round(amount * 100));
const fromTiyn = (tiyn: bigint): number => Number(tiyn) / 100;

export function allocateRefund(total: number, tenders: Tender[]): Tender[] {
  const paid = tenders.filter((t) => t.amount > 0);
  const paidTiyn = paid.map((t) => toTiyn(t.amount));
  const paidTotal = paidTiyn.reduce((a, b) => a + b, 0n);
  const refundTiyn = toTiyn(total);
  if (paidTotal === 0n) throw new BadRequestException("По продаже нет оплаты, из которой можно вернуть деньги");
  if (refundTiyn > paidTotal) throw new BadRequestException("Сумма возврата больше, чем оплачено по продаже");

  const base = paidTiyn.map((p) => (refundTiyn * p) / paidTotal);
  const remainders = paidTiyn.map((p, i) => ({ i, rem: (refundTiyn * p) % paidTotal }));
  let leftover = refundTiyn - base.reduce((a, b) => a + b, 0n);
  // Largest remainder first; ties keep the original tender order.
  remainders.sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));
  for (const { i } of remainders) {
    if (leftover === 0n) break;
    base[i] += 1n;
    leftover -= 1n;
  }
  return paid.map((t, i) => ({ method: t.method, amount: fromTiyn(base[i]) })).filter((t) => t.amount > 0);
}

// An explicit override must still hand back exactly the refund, and no tender
// may be asked to return more than the buyer paid with it.
export function validateRefundOverride(total: number, override: Tender[], tenders: Tender[]): Tender[] {
  const merged = new Map<string, bigint>();
  for (const o of override) {
    if (o.amount <= 0) throw new BadRequestException("Сумма возврата по способу оплаты должна быть больше нуля");
    merged.set(o.method, (merged.get(o.method) ?? 0n) + toTiyn(o.amount));
  }
  const sum = [...merged.values()].reduce((a, b) => a + b, 0n);
  if (sum !== toTiyn(total)) throw new BadRequestException("Сумма возврата по способам оплаты не равна сумме возврата");
  const paidBy = new Map<string, bigint>();
  for (const t of tenders) paidBy.set(t.method, (paidBy.get(t.method) ?? 0n) + toTiyn(t.amount));
  for (const [method, amount] of merged) {
    if (amount > (paidBy.get(method) ?? 0n)) {
      throw new BadRequestException("По одному из способов оплаты возврат больше, чем было оплачено");
    }
  }
  return [...merged].map(([method, amount]) => ({ method, amount: fromTiyn(amount) }));
}
