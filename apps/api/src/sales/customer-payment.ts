import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { CashMovementType, CustomerPaymentResultDto } from "@bakery-os/shared";
import { AuthenticatedUser } from "../auth/auth.types";
import { recordAudit } from "../audit/audit";
import { CashMovementsService } from "../finance/cash-movements.service";
import { customerAdvanceBalance, lockCustomer } from "./customer-advances";

const round2 = (value: number): number => Number(value.toFixed(2));

// Money from a wholesale customer: pays their unpaid sales oldest first, and what
// is left is an advance (a CUSTOMER_PAYMENT with no sale), counted toward their
// next credit sale. One rule for «Принять оплату» on the customer card and a
// customer's payment posted from a bank statement (dated by the bank).
export async function applyCustomerPayment(
  tx: Prisma.TransactionClient,
  cash: CashMovementsService,
  user: AuthenticatedUser,
  input: { customerId: string; accountId: string; amount: number; note?: string | null; occurredAt?: Date },
): Promise<CustomerPaymentResultDto> {
  if (!(input.amount > 0)) throw new BadRequestException("Сумма оплаты должна быть больше нуля");
  const amount = round2(input.amount);
  const customer = await tx.customer.findFirst({ where: { id: input.customerId, organizationId: user.organizationId } });
  if (!customer) throw new NotFoundException("Клиент не найден");
  const account = await tx.cashAccount.findFirst({ where: { id: input.accountId, organizationId: user.organizationId } });
  if (!account || !account.isActive) throw new BadRequestException("Счёт не найден или заархивирован");
  await lockCustomer(tx, customer.id);

  const sales = await tx.sale.findMany({
    where: { organizationId: user.organizationId, customerId: customer.id },
    select: { id: true, soldAt: true, totalAmount: true, amountPaid: true, creditedAmount: true },
    orderBy: { soldAt: "asc" },
  });
  const note = input.note?.trim();
  let left = amount;
  const appliedToSales: CustomerPaymentResultDto["appliedToSales"] = [];
  for (const sale of sales) {
    if (left <= 0.004) break;
    const owed = round2(sale.totalAmount.toNumber() - sale.amountPaid.toNumber() - sale.creditedAmount.toNumber());
    if (owed <= 0.004) continue;
    const part = round2(Math.min(left, owed));
    await cash.recordMovement(tx, {
      organizationId: user.organizationId,
      accountId: account.id,
      type: CashMovementType.CUSTOMER_PAYMENT,
      amount: part,
      customerId: customer.id,
      saleId: sale.id,
      reason: note ? `Погашение долга по продаже: ${note}` : "Погашение долга по продаже",
      createdById: user.id,
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    });
    await tx.sale.update({ where: { id: sale.id }, data: { amountPaid: { increment: part } } });
    appliedToSales.push({ saleId: sale.id, soldAt: sale.soldAt.toISOString(), amount: part });
    left = round2(left - part);
  }
  const advance = left > 0.004 ? left : 0;
  if (advance > 0) {
    await cash.recordMovement(tx, {
      organizationId: user.organizationId,
      accountId: account.id,
      type: CashMovementType.CUSTOMER_PAYMENT,
      amount: advance,
      customerId: customer.id,
      reason: note ? `Аванс от покупателя: ${note}` : "Аванс от покупателя",
      createdById: user.id,
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    });
  }
  await recordAudit(tx, {
    organizationId: user.organizationId,
    actorId: user.id,
    action: "customer.payment",
    entityType: "Customer",
    entityId: customer.id,
    after: { amount, accountId: account.id, appliedToSales, advance },
  });
  return { appliedToSales, advance, advanceBalance: await customerAdvanceBalance(tx, user.organizationId, customer.id) };
}
