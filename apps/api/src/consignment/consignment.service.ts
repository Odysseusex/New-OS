import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  CashAccountType,
  CashMovementType,
  ConsignmentBalanceDto,
  ConsignmentDetailDto,
  ConsignmentProductRowDto,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { CashMovementsService } from "../finance/cash-movements.service";
import { CreateConsignmentPaymentDto } from "./dto/create-consignment-payment.dto";

// Расчёты по товарам под реализацию.
//
// Goods that belong to somebody else (the village store) sit on our shelf and
// we owe them for each unit that SELLS. The amount owed is never typed in by
// a human: it is Σ(sold × the price snapshotted on that sale line), minus the
// same for returns, minus what has already been paid. That is the whole
// model — a running balance, no periods, no settlement acts to reconcile.
//
// Why a running balance and not periodic acts: periods have to be defined,
// must not overlap, and a return that arrives after its period closes has
// nowhere honest to go. With a balance, a late return simply reduces what is
// owed today, which is also what actually happens in the shop.
@Injectable()
export class ConsignmentService {
  constructor(
    private prisma: PrismaService,
    private cashMovements: CashMovementsService,
  ) {}

  // Every supplier whose goods we have ever sold on consignment, or paid for.
  // A supplier with a zero balance is still listed: "we owe them nothing" is
  // an answer the owner wants to see, not an entry that should vanish.
  async balances(organizationId: string): Promise<ConsignmentBalanceDto[]> {
    const [saleItems, returnItems, payments, suppliers] = await Promise.all([
      this.prisma.saleItem.findMany({
        where: { consignmentSupplierId: { not: null }, sale: { organizationId } },
        select: { consignmentSupplierId: true, consignmentUnitCost: true, quantity: true },
      }),
      this.prisma.saleReturnItem.findMany({
        where: { consignmentSupplierId: { not: null }, saleReturn: { organizationId } },
        select: { consignmentSupplierId: true, consignmentUnitCost: true, quantity: true },
      }),
      this.prisma.consignmentPayment.findMany({
        where: { organizationId },
        select: { supplierId: true, amount: true, paidAt: true },
      }),
      this.prisma.supplier.findMany({ where: { organizationId }, select: { id: true, name: true } }),
    ]);

    const nameById = new Map(suppliers.map((s) => [s.id, s.name]));
    const acc = new Map<string, ConsignmentBalanceDto>();
    const ensure = (supplierId: string): ConsignmentBalanceDto => {
      const existing = acc.get(supplierId);
      if (existing) return existing;
      const fresh: ConsignmentBalanceDto = {
        supplierId,
        supplierName: nameById.get(supplierId) ?? "Поставщик",
        soldAmount: 0,
        returnedAmount: 0,
        paidAmount: 0,
        balance: 0,
        quantitySold: 0,
        lastPaidAt: null,
      };
      acc.set(supplierId, fresh);
      return fresh;
    };

    for (const item of saleItems) {
      const row = ensure(item.consignmentSupplierId!);
      row.soldAmount += (item.consignmentUnitCost?.toNumber() ?? 0) * item.quantity.toNumber();
      row.quantitySold += item.quantity.toNumber();
    }
    for (const item of returnItems) {
      const row = ensure(item.consignmentSupplierId!);
      row.returnedAmount += (item.consignmentUnitCost?.toNumber() ?? 0) * item.quantity.toNumber();
      row.quantitySold -= item.quantity.toNumber();
    }
    for (const payment of payments) {
      const row = ensure(payment.supplierId);
      row.paidAmount += payment.amount.toNumber();
      const paidAt = payment.paidAt.toISOString();
      if (!row.lastPaidAt || paidAt > row.lastPaidAt) row.lastPaidAt = paidAt;
    }

    return [...acc.values()]
      .map((row) => ({
        ...row,
        soldAmount: round(row.soldAmount),
        returnedAmount: round(row.returnedAmount),
        paidAmount: round(row.paidAmount),
        balance: round(row.soldAmount - row.returnedAmount - row.paidAmount),
        quantitySold: round(row.quantitySold),
      }))
      .sort((a, b) => b.balance - a.balance);
  }

  // The same balance, plus what it is made of: one row per product AND per
  // price it sold at. The split by price matters — the same bread sold before
  // and after the village raised its price really is two different debts, and
  // collapsing them would produce a per-unit figure that matches neither.
  async detail(organizationId: string, supplierId: string): Promise<ConsignmentDetailDto> {
    const supplier = await this.prisma.supplier.findFirst({ where: { id: supplierId, organizationId } });
    if (!supplier) throw new NotFoundException("Поставщик не найден");

    const [saleItems, returnItems, payments, balances] = await Promise.all([
      this.prisma.saleItem.findMany({
        where: { consignmentSupplierId: supplierId, sale: { organizationId } },
        select: {
          productId: true,
          consignmentUnitCost: true,
          quantity: true,
          product: { select: { name: true } },
        },
      }),
      this.prisma.saleReturnItem.findMany({
        where: { consignmentSupplierId: supplierId, saleReturn: { organizationId } },
        select: {
          productId: true,
          consignmentUnitCost: true,
          quantity: true,
          product: { select: { name: true } },
        },
      }),
      this.prisma.consignmentPayment.findMany({
        where: { organizationId, supplierId },
        orderBy: { paidAt: "desc" },
        include: { createdBy: { select: { fullName: true } } },
      }),
      this.balances(organizationId),
    ]);

    const rows = new Map<string, ConsignmentProductRowDto>();
    const keyOf = (productId: string, unitCost: number) => `${productId}:${unitCost}`;
    const ensureRow = (productId: string, name: string, unitCost: number): ConsignmentProductRowDto => {
      const key = keyOf(productId, unitCost);
      const existing = rows.get(key);
      if (existing) return existing;
      const fresh: ConsignmentProductRowDto = {
        productId,
        productName: name,
        unitCost,
        quantitySold: 0,
        quantityReturned: 0,
        amount: 0,
      };
      rows.set(key, fresh);
      return fresh;
    };

    for (const item of saleItems) {
      const unitCost = item.consignmentUnitCost?.toNumber() ?? 0;
      const row = ensureRow(item.productId, item.product.name, unitCost);
      row.quantitySold += item.quantity.toNumber();
    }
    for (const item of returnItems) {
      const unitCost = item.consignmentUnitCost?.toNumber() ?? 0;
      const row = ensureRow(item.productId, item.product.name, unitCost);
      row.quantityReturned += item.quantity.toNumber();
    }

    const balance = balances.find((b) => b.supplierId === supplierId) ?? {
      supplierId,
      supplierName: supplier.name,
      soldAmount: 0,
      returnedAmount: 0,
      paidAmount: 0,
      balance: 0,
      quantitySold: 0,
      lastPaidAt: null,
    };

    return {
      ...balance,
      rows: [...rows.values()]
        .map((row) => ({
          ...row,
          quantitySold: round(row.quantitySold),
          quantityReturned: round(row.quantityReturned),
          amount: round((row.quantitySold - row.quantityReturned) * row.unitCost),
        }))
        .sort((a, b) => b.amount - a.amount),
      payments: payments.map((p) => ({
        id: p.id,
        amount: p.amount.toNumber(),
        paidAt: p.paidAt.toISOString(),
        note: p.note,
        createdByName: p.createdBy.fullName,
      })),
    };
  }

  // Records money actually sent to the supplier. Deliberately allows paying
  // less than the balance (partial payouts are normal) but not more than it:
  // an amount above what is owed is nearly always a typo, and a silent
  // overpayment is exactly the kind of quiet error this module exists to
  // prevent.
  async pay(user: AuthenticatedUser, dto: CreateConsignmentPaymentDto) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, organizationId: user.organizationId },
    });
    if (!supplier) throw new NotFoundException("Поставщик не найден");

    const balances = await this.balances(user.organizationId);
    const owed = balances.find((b) => b.supplierId === dto.supplierId)?.balance ?? 0;
    if (owed <= 0) {
      throw new BadRequestException(`Поставщику «${supplier.name}» сейчас ничего не должны`);
    }
    if (dto.amount > owed) {
      throw new BadRequestException(
        `Больше долга: должны ${owed} ₸, к выплате указано ${dto.amount} ₸`,
      );
    }

    const accountId = await this.resolveAccountId(user.organizationId, dto.accountId);
    if (!accountId) {
      throw new BadRequestException("Не найден счёт для выплаты — создайте счёт в разделе Финансы");
    }

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.consignmentPayment.create({
        data: {
          organizationId: user.organizationId,
          supplierId: dto.supplierId,
          amount: dto.amount,
          note: dto.note,
          createdById: user.id,
        },
      });

      // Money genuinely leaves an account, so it goes through the same single
      // ledger as every other payment rather than being tracked separately.
      await this.cashMovements.recordMovement(tx, {
        organizationId: user.organizationId,
        accountId,
        type: CashMovementType.SUPPLIER_PAYMENT,
        amount: dto.amount,
        supplierId: dto.supplierId,
        consignmentPaymentId: payment.id,
        reason: `Выплата за товар под реализацию — ${supplier.name}`,
        createdById: user.id,
      });

      return payment;
    });
  }

  private async resolveAccountId(organizationId: string, requested?: string): Promise<string | null> {
    if (requested) {
      const account = await this.prisma.cashAccount.findFirst({
        where: { id: requested, organizationId, isActive: true },
      });
      if (!account) throw new NotFoundException("Счёт не найден");
      return account.id;
    }
    const preferred = await this.prisma.cashAccount.findFirst({
      where: { organizationId, type: CashAccountType.BANK, isDefault: true, isActive: true },
    });
    if (preferred) return preferred.id;
    const any = await this.prisma.cashAccount.findFirst({ where: { organizationId, isActive: true } });
    return any?.id ?? null;
  }
}

// Money in tenge, kept to whole тиын so a long chain of additions cannot
// drift into 0.30000000000000004.
function round(value: number): number {
  return Number(value.toFixed(2));
}
