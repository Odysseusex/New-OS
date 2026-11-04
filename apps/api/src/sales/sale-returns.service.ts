import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { resolveTillApproval } from "../auth/till-pin";
import { nonCashAccountFor } from "../common/non-cash-account";
import { FiscalReceiptStatus, Prisma, StockMovementType } from "@prisma/client";
import {
  CashAccountType,
  CashMovementType,
  PaymentMethod,
  SaleReturnDto,
  WriteOffReason,
  splitSaleReturn,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { isDemoOrganization } from "../common/demo-guard";
import { AuthenticatedUser } from "../auth/auth.types";
import { resolveLocationScope } from "../common/location-scope";
import { CashMovementsService } from "../finance/cash-movements.service";
import { FiscalService, buildFiscalSaleRequest } from "../fiscal/fiscal.service";
import { FiscalSettings } from "../fiscal/fiscal.settings";
import { CreateSaleReturnDto } from "./dto/create-sale-return.dto";
import { allocateRefund, validateRefundOverride } from "./refund-allocation";
import { postLedgerSources } from "../ledger/event-posting";
import { LoyaltyPointsService } from "../loyalty/loyalty-points.service";
import { CustomerBotService } from "../loyalty/customer-bot.service";

const RETURN_INCLUDE = {
  location: true,
  createdBy: true,
  items: { include: { product: true } },
  fiscalReceipt: true,
};

@Injectable()
export class SaleReturnsService {
  constructor(
    private prisma: PrismaService,
    private cashMovementsService: CashMovementsService,
    private fiscalService: FiscalService,
    private fiscalSettings: FiscalSettings,
    private loyaltyPoints: LoyaltyPointsService = new LoyaltyPointsService(prisma),
    private customerBot?: CustomerBotService,
  ) {}

  async findBySale(user: AuthenticatedUser, saleId: string): Promise<SaleReturnDto[]> {
    const sale = await this.prisma.sale.findFirst({
      where: { id: saleId, organizationId: user.organizationId },
    });
    if (!sale) throw new NotFoundException("Продажа не найдена");
    resolveLocationScope(user, sale.locationId);

    const returns = await this.prisma.saleReturn.findMany({
      where: { saleId },
      include: RETURN_INCLUDE,
      orderBy: { returnedAt: "desc" },
    });
    return returns.map((r) => this.toDto(r));
  }

  // Takes goods back and settles them: what the buyer still owes on the sale is
  // cancelled first (a sale on credit), only the rest is handed back as money.
  // The whole thing is one document
  // plus entries in the same ledgers a sale writes to — never an edit of the
  // sale, which stays immutable exactly as every other confirmed document does.
  //
  // With fiscalisation on, the return receipt is punched BEFORE anything is
  // written, mirroring SalesService.create(): a SaleReturn row in this
  // database always means money actually went back.
  async create(user: AuthenticatedUser, saleId: string, dto: CreateSaleReturnDto): Promise<SaleReturnDto> {
    const sale = await this.prisma.sale.findFirst({
      where: { id: saleId, organizationId: user.organizationId },
      include: { items: { include: { product: true } }, location: true, fiscalReceipt: true, payments: true, returns: { include: { items: true } } },
    });
    if (!sale) throw new NotFoundException("Продажа не найдена");
    resolveLocationScope(user, sale.locationId);
    // A cashier returns only with a senior cashier's PIN; everyone else allowed here approves themselves.
    const approver = await resolveTillApproval(this.prisma, user, "RETURN", dto.approvalToken);

    if (dto.items.length === 0) {
      throw new BadRequestException("Не выбрано ни одной позиции для возврата");
    }

    // What is still returnable: sold minus everything earlier returns already
    // took back. Without this the same loaf could be refunded twice.
    const soldByProduct = new Map<
      string,
      {
        unitPrice: number;
        quantity: number;
        name: string;
        unit: string;
        ntin: string | null;
        // Carried over from the sale line, not re-read from the product: a
        // returned unit must cancel exactly the debt its own sale created.
        consignmentSupplierId: string | null;
        consignmentUnitCost: number | null;
        // Same idea for a markdown: returning stale bread gives back the
        // money we gave away on it, so the loss must net out.
        fullUnitPrice: number | null;
        // The cost the sale booked — a restocked return reverses exactly this.
        unitCost: number | null;
        costBasis: string | null;
      }
    >();
    for (const item of sale.items) {
      const existing = soldByProduct.get(item.productId);
      const quantity = item.quantity.toNumber() + (existing?.quantity ?? 0);
      soldByProduct.set(item.productId, {
        quantity,
        unitPrice: item.unitPrice.toNumber(),
        name: item.product.name,
        unit: item.product.unit,
        ntin: item.product.ntin,
        consignmentSupplierId: item.consignmentSupplierId,
        consignmentUnitCost: item.consignmentUnitCost?.toNumber() ?? null,
        fullUnitPrice: item.fullUnitPrice?.toNumber() ?? null,
        unitCost: item.unitCost?.toNumber() ?? null,
        costBasis: item.costBasis,
      });
    }
    const alreadyReturned = new Map<string, number>();
    for (const previous of sale.returns) {
      for (const item of previous.items) {
        alreadyReturned.set(item.productId, (alreadyReturned.get(item.productId) ?? 0) + item.quantity.toNumber());
      }
    }

    const lines = dto.items.map((requested) => {
      const sold = soldByProduct.get(requested.productId);
      if (!sold) {
        throw new BadRequestException("В этой продаже нет такого товара");
      }
      if (requested.quantity <= 0) {
        throw new BadRequestException(`Количество возврата «${sold.name}» должно быть больше нуля`);
      }
      const remaining = sold.quantity - (alreadyReturned.get(requested.productId) ?? 0);
      if (requested.quantity > remaining) {
        throw new BadRequestException(
          `«${sold.name}»: к возврату доступно ${remaining}, запрошено ${requested.quantity}`,
        );
      }
      return {
        productId: requested.productId,
        name: sold.name,
        unit: sold.unit,
        ntin: sold.ntin,
        quantity: requested.quantity,
        unitPrice: sold.unitPrice,
        // Refunded at the price actually paid, never today's price.
        subtotal: Number((requested.quantity * sold.unitPrice).toFixed(2)),
        consignmentSupplierId: sold.consignmentSupplierId,
        consignmentUnitCost: sold.consignmentUnitCost,
        fullUnitPrice: sold.fullUnitPrice,
        unitCost: sold.unitCost,
        costBasis: sold.costBasis,
      };
    });

    const totalAmount = Number(lines.reduce((sum, l) => sum + l.subtotal, 0).toFixed(2));
    // A sale on credit: the returned goods first cancel what is still owed on
    // it; money goes back only for the rest. Never more money back than the
    // buyer paid (earlier refunds included) — that would hand over money that
    // never arrived.
    const { creditedAmount, refundedAmount } = splitSaleReturn(totalAmount, {
      totalAmount: sale.totalAmount.toNumber(),
      amountPaid: sale.amountPaid.toNumber(),
      creditedAmount: sale.creditedAmount.toNumber(),
    });
    const refundedBefore = sale.returns.reduce((sum, r) => sum + r.totalAmount.toNumber() - r.creditedAmount.toNumber(), 0);
    if (refundedBefore + refundedAmount > sale.amountPaid.toNumber() + 0.005) {
      throw new BadRequestException("Сумма возврата больше, чем оплачено по продаже");
    }

    const restocked = dto.restocked ?? true;
    const returnedAt = new Date();

    // The sandbox («Песочница») never reaches the real cash register.
    const fiscal = this.fiscalSettings.isEnabled() && !(await isDemoOrganization(this.prisma, user.organizationId));
    if (fiscal && creditedAmount > 0) {
      // A return receipt says money went back; against an unpaid debt none does.
      throw new BadRequestException("Возврат в счёт долга покупателя нельзя провести через кассу");
    }
    const receipt = fiscal ? await this.fiscalizeBeforeReturn(user, sale, lines, totalAmount, returnedAt) : null;

    let loyaltyMoved: { memberId: string; pointsRefunded: number; pointsReversed: number } | null = null;
    const created = await this.prisma.$transaction(async (tx) => {
      const saleReturn = await tx.saleReturn.create({
        data: {
          organizationId: user.organizationId,
          saleId: sale.id,
          locationId: sale.locationId,
          returnedAt,
          totalAmount,
          creditedAmount,
          ...(approver.id !== user.id ? { approvedById: approver.id, approvedByName: approver.fullName } : {}),
          // The refunded part that belongs to consignment goods (SaleReturn.consignmentAmount).
          consignmentAmount: Number(lines.reduce((sum, l) => sum + (l.consignmentSupplierId ? l.subtotal : 0), 0).toFixed(2)),
          reason: dto.reason,
          restocked,
          createdById: user.id,
          items: {
            create: lines.map((l) => ({
              productId: l.productId,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              subtotal: l.subtotal,
              consignmentSupplierId: l.consignmentSupplierId,
              consignmentUnitCost: l.consignmentUnitCost,
              fullUnitPrice: l.fullUnitPrice,
              unitCost: l.unitCost,
              costBasis: l.costBasis,
            })),
          },
        },
        include: RETURN_INCLUDE,
      });

      if (receipt) {
        await this.fiscalService.linkSaleReturn(tx, receipt.id, saleReturn.id);
      }
      if (creditedAmount > 0) {
        await tx.sale.update({ where: { id: sale.id }, data: { creditedAmount: { increment: creditedAmount } } });
      }

      // Money goes back the way it came (D8): a single-method sale refunds that
      // method; a mixed sale refunds each tender in proportion to what it paid,
      // unless the caller explicitly overrides the split.
      const tenders = sale.payments.map((p) => ({ method: p.method as string, amount: p.amount.toNumber() }));
      const refundParts =
        refundedAmount <= 0
          ? []
          : sale.paymentMethod !== PaymentMethod.MIXED
            ? [{ method: sale.paymentMethod as string, amount: refundedAmount }]
            : dto.refundSplit && dto.refundSplit.length > 0
              ? validateRefundOverride(refundedAmount, dto.refundSplit, tenders)
              : allocateRefund(refundedAmount, tenders);
      for (const part of refundParts) {
        const accountId = await this.resolveRefundAccountId(tx, user.organizationId, sale.locationId, part.method, sale.id);
        if (!accountId) continue;
        await this.cashMovementsService.recordMovement(tx, {
          organizationId: user.organizationId,
          accountId,
          type: CashMovementType.SALE_REFUND,
          amount: part.amount,
          customerId: sale.customerId ?? undefined,
          saleId: sale.id,
          reason: dto.reason ?? "Возврат покупателю",
          createdById: user.id,
        });
      }
      await tx.cashMovement.updateMany({
        where: { saleId: sale.id, type: CashMovementType.SALE_REFUND, saleReturnId: null },
        data: { saleReturnId: saleReturn.id },
      });

      for (const line of lines) {
        const trackable = await tx.product.findUnique({ where: { id: line.productId } });
        // Untracked resources (tap water and the like) have no stock to move
        // back, exactly as they have none to take on a sale.
        if (!trackable?.trackInventory) continue;

        if (restocked) {
          await tx.stockLevel.upsert({
            where: { locationId_productId: { locationId: sale.locationId, productId: line.productId } },
            create: {
              organizationId: user.organizationId,
              locationId: sale.locationId,
              productId: line.productId,
              quantity: line.quantity,
              minQuantity: trackable.minQuantity,
            },
            update: { quantity: { increment: line.quantity } },
          });
        }

        await tx.stockMovement.create({
          data: {
            organizationId: user.organizationId,
            locationId: sale.locationId,
            productId: line.productId,
            // Goods the buyer kept possession of and that cannot go back on
            // the shelf are recorded as a write-off, so stock never claims to
            // hold bread that went in the bin.
            type: restocked ? StockMovementType.SALE_RETURN : StockMovementType.WRITE_OFF,
            writeOffReason: restocked ? undefined : WriteOffReason.OTHER,
            quantity: line.quantity,
            reason: restocked ? "Возврат от покупателя" : "Возврат от покупателя — товар списан",
            saleId: sale.id,
            saleReturnId: saleReturn.id,
            unitCost: line.unitCost,
            costBasis: line.costBasis,
            createdById: user.id,
          },
        });
      }

      // Points follow the goods: what the sale spent comes back for the returned
      // part, what it earned on that part is taken back (never below zero).
      if (sale.loyaltyMemberId) {
        const returnedQtyByProduct = new Map<string, number>();
        const add = (productId: string, quantity: number) =>
          returnedQtyByProduct.set(productId, (returnedQtyByProduct.get(productId) ?? 0) + quantity);
        for (const previous of sale.returns) for (const item of previous.items) add(item.productId, item.quantity.toNumber());
        for (const line of lines) add(line.productId, line.quantity);
        const moved = await this.loyaltyPoints.recordReturn(tx, {
          user,
          saleId: sale.id,
          saleReturnId: saleReturn.id,
          memberId: sale.loyaltyMemberId,
          saleLines: sale.items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity.toNumber(),
            subtotal: i.subtotal.toNumber(),
            fullUnitPrice: i.fullUnitPrice?.toNumber() ?? null,
            loyaltyDiscount: i.loyaltyDiscount?.toNumber() ?? null,
            consignment: i.consignmentSupplierId !== null,
          })),
          returnedQtyByProduct,
          now: returnedAt,
        });
        loyaltyMoved = { memberId: moved.memberId, pointsRefunded: moved.pointsRefunded, pointsReversed: moved.pointsReversed };
      }

      // Journalise the return (and its cost) with the return itself; the refund
      // movements above were journalised as they were recorded.
      await postLedgerSources(tx, { organizationId: user.organizationId, actorId: user.id, scope: { saleReturnIds: [saleReturn.id] } });

      return saleReturn;
    });

    const moved = loyaltyMoved as { memberId: string; pointsRefunded: number; pointsReversed: number } | null;
    if (moved) void this.customerBot?.notifyReturn(moved.memberId, created.id, moved.pointsRefunded, moved.pointsReversed);
    return this.toDto({ ...created, fiscalReceipt: receipt ?? created.fiscalReceipt });
  }

  // Punches the return receipt, and returns it only if the operator
  // registered it. Same contract as a sale: no receipt, no document.
  private async fiscalizeBeforeReturn(
    user: AuthenticatedUser,
    sale: { fiscalReceipt: { ticketNumber: string | null; isOffline: boolean; registeredAt: Date | null; status: string } | null; location: { name: string; lat: number | null; lng: number | null }; totalAmount: Prisma.Decimal; paymentMethod: string; soldAt: Date },
    lines: { name: string; unit: string; ntin: string | null; quantity: number; unitPrice: number; subtotal: number }[],
    totalAmount: number,
    returnedAt: Date,
  ) {
    const original = sale.fiscalReceipt;
    if (!original || original.status !== FiscalReceiptStatus.REGISTERED || !original.ticketNumber) {
      // A fiscal return has to quote the receipt it reverses. A sale rung up
      // before fiscalisation was switched on simply has none, and inventing
      // one is not an option.
      throw new BadRequestException(
        "У этой продажи нет фискального чека — возврат по ней нельзя провести через кассу",
      );
    }

    const draft = buildFiscalSaleRequest({
      occurredAt: returnedAt,
      paymentMethod: sale.paymentMethod,
      location: sale.location,
      total: totalAmount,
      lines: lines.map((l) => ({
        product: { name: l.name, unit: l.unit, ntin: l.ntin },
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        subtotal: l.subtotal,
      })),
    });

    const prepared = await this.fiscalService.prepare(user.organizationId, {
      ...draft,
      // Nothing is handed over by a buyer being refunded; their server
      // rejects a return that claims otherwise.
      taken: 0,
      change: 0,
      parent: {
        ticketNumber: original.ticketNumber,
        occurredAt: original.registeredAt ?? sale.soldAt,
        total: sale.totalAmount.toNumber(),
        isOffline: original.isOffline,
      },
    });

    const receipt = await this.fiscalService.attempt(prepared.id);
    if (receipt.status === FiscalReceiptStatus.REGISTERED) return receipt;

    if (receipt.status === FiscalReceiptStatus.UNKNOWN) {
      throw new BadRequestException(
        "Связь с кассой прервана — не удалось подтвердить возвратный чек. Возврат не проведён. " +
          "Не повторяйте: сначала проверьте раздел «Требует внимания».",
      );
    }

    throw new BadRequestException(
      `Возвратный чек не пробит: ${receipt.errorMessage ?? "касса отклонила чек"}. Возврат не проведён.`,
    );
  }

  // The refund leaves the account the payment arrived in: cash back out of the
  // till; card/transfer back out of the account the sale's money landed in
  // (a point's own bank account may have changed since), else the point's
  // current non-cash account.
  private async resolveRefundAccountId(
    tx: Prisma.TransactionClient,
    organizationId: string,
    locationId: string,
    paymentMethod: string,
    saleId?: string,
  ): Promise<string | null> {
    if (paymentMethod === PaymentMethod.CASH) {
      const till = await tx.cashAccount.findFirst({
        where: { organizationId, locationId, type: CashAccountType.CASH },
      });
      return till?.id ?? null;
    }
    if (saleId) {
      const received = await tx.cashMovement.findFirst({
        where: { saleId, type: "SALE_RECEIPT", account: { type: { not: CashAccountType.CASH }, isActive: true } },
        select: { accountId: true },
        orderBy: { occurredAt: "asc" },
      });
      if (received) return received.accountId;
    }
    return nonCashAccountFor(tx, organizationId, locationId);
  }

  private toDto(row: {
    id: string;
    saleId: string;
    locationId: string;
    location: { name: string };
    returnedAt: Date;
    totalAmount: Prisma.Decimal;
    creditedAmount: Prisma.Decimal;
    reason: string | null;
    restocked: boolean;
    createdBy: { fullName: string };
    items: {
      id: string;
      productId: string;
      product: { name: string };
      quantity: Prisma.Decimal;
      unitPrice: Prisma.Decimal;
      subtotal: Prisma.Decimal;
    }[];
    fiscalReceipt?: {
      status: string;
      ticketNumber: string | null;
      offlineTicketNumber: string | null;
      qrCode: string | null;
      isOffline: boolean;
    } | null;
  }): SaleReturnDto {
    return {
      id: row.id,
      saleId: row.saleId,
      locationId: row.locationId,
      locationName: row.location.name,
      returnedAt: row.returnedAt.toISOString(),
      totalAmount: row.totalAmount.toNumber(),
      creditedAmount: row.creditedAmount.toNumber(),
      refundedAmount: Math.round((row.totalAmount.toNumber() - row.creditedAmount.toNumber()) * 100) / 100,
      reason: row.reason,
      restocked: row.restocked,
      createdByName: row.createdBy.fullName,
      items: row.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.product.name,
        quantity: item.quantity.toNumber(),
        unitPrice: item.unitPrice.toNumber(),
        subtotal: item.subtotal.toNumber(),
      })),
      fiscalReceipt: row.fiscalReceipt
        ? {
            status: row.fiscalReceipt.status as SaleReturnDto["fiscalReceipt"] extends null
              ? never
              : NonNullable<SaleReturnDto["fiscalReceipt"]>["status"],
            ticketNumber: row.fiscalReceipt.ticketNumber ?? row.fiscalReceipt.offlineTicketNumber,
            qrCode: row.fiscalReceipt.qrCode,
            isOffline: row.fiscalReceipt.isOffline,
          }
        : null,
    };
  }
}
