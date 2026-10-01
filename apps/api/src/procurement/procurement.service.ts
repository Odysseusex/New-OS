import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  CostBasis,
  BusinessContextPurchaseSupplierRowDto,
  BusinessContextPurchaseProductRowDto,
  BusinessContextPurchasesDto,
  CashMovementType,
  PaymentStatus,
  PurchaseOrderDto,
  PurchaseOrderStatus,
  PurchaseWorkflowDto,
  ReceivePurchaseOrderRequestDto,
  RecordPurchaseOrderPaymentRequestDto,
  Unit,
} from "@bakery-os/shared";
import { Prisma, PurchaseOrderStatus as PrismaPurchaseOrderStatus, StockMovementType } from "@prisma/client";
import { CashMovementsService } from "../finance/cash-movements.service";
import { round2 } from "../common/money";
import { AuthenticatedUser } from "../auth/auth.types";
import { requireLocationScope, resolveLocationScope } from "../common/location-scope";
import { CreatePurchaseOrderDto } from "./dto/create-purchase-order.dto";
import { recordAudit } from "../audit/audit";
import { postLedgerSources } from "../ledger/event-posting";

@Injectable()
export class ProcurementService {
  constructor(
    private prisma: PrismaService,
    private cash: CashMovementsService = new CashMovementsService(prisma),
  ) {}

  // "Что мы покупаем, у кого, сколько и по какой цене" over a period.
  //
  // Purchase orders and supplier invoices (накладные) are two INDEPENDENT
  // ways goods arrive — an invoice is the paper a supplier hands over, and it
  // is confirmable without any order having been placed first. They are
  // therefore reported side by side and never summed: adding them would
  // double-count every delivery that has both.
  //
  // averageUnitCost is weighted by quantity (total cost / total quantity),
  // not an average of the unit prices — two deliveries of very different
  // sizes must not count equally toward what a kilo of flour costs us.
  async purchasesSummary(
    user: AuthenticatedUser,
    from: Date,
    to: Date,
    requestedLocationId?: string,
  ): Promise<BusinessContextPurchasesDto> {
    const locationId = resolveLocationScope(user, requestedLocationId);
    const scope = {
      organizationId: user.organizationId,
      ...(locationId ? { locationId } : {}),
    };

    const [orders, invoiceTotals] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where: { ...scope, orderedAt: { gte: from, lte: to } },
        select: {
          totalCost: true,
          supplier: { select: { id: true, name: true } },
          items: {
            select: {
              quantity: true,
              subtotal: true,
              product: { select: { id: true, name: true, unit: true } },
            },
          },
        },
      }),
      this.prisma.invoice.aggregate({
        where: { ...scope, issuedAt: { gte: from, lte: to } },
        _sum: { totalCost: true, amountPaid: true },
        _count: { _all: true },
      }),
    ]);

    const supplierAcc = new Map<string, BusinessContextPurchaseSupplierRowDto>();
    const productAcc = new Map<string, { row: BusinessContextPurchaseProductRowDto }>();
    let ordersTotalCost = 0;

    for (const order of orders) {
      ordersTotalCost += order.totalCost.toNumber();

      const supplierRow = supplierAcc.get(order.supplier.id) ?? {
        supplierId: order.supplier.id,
        supplierName: order.supplier.name,
        totalCost: 0,
        orderCount: 0,
      };
      supplierRow.totalCost += order.totalCost.toNumber();
      supplierRow.orderCount += 1;
      supplierAcc.set(order.supplier.id, supplierRow);

      for (const item of order.items) {
        const entry = productAcc.get(item.product.id) ?? {
          row: {
            productId: item.product.id,
            productName: item.product.name,
            unit: item.product.unit as Unit,
            quantity: 0,
            totalCost: 0,
            averageUnitCost: null,
          },
        };
        entry.row.quantity += item.quantity.toNumber();
        entry.row.totalCost += item.subtotal.toNumber();
        productAcc.set(item.product.id, entry);
      }
    }

    const money = (value: number) => Number(value.toFixed(2));
    const invoicesTotal = invoiceTotals._sum.totalCost?.toNumber() ?? 0;
    const invoicesPaid = invoiceTotals._sum.amountPaid?.toNumber() ?? 0;

    return {
      ordersTotalCost: money(ordersTotalCost),
      ordersCount: orders.length,
      bySupplier: Array.from(supplierAcc.values())
        .map((s) => ({ ...s, totalCost: money(s.totalCost) }))
        .sort((a, b) => b.totalCost - a.totalCost),
      byProduct: Array.from(productAcc.values())
        .map(({ row }) => ({
          ...row,
          quantity: Number(row.quantity.toFixed(3)),
          totalCost: money(row.totalCost),
          averageUnitCost: row.quantity > 0 ? money(row.totalCost / row.quantity) : null,
        }))
        .sort((a, b) => b.totalCost - a.totalCost),
      invoicesTotalCost: money(invoicesTotal),
      invoicesCount: invoiceTotals._count._all,
      invoicesUnpaid: money(invoicesTotal - invoicesPaid),
    };
  }

  private static readonly ORDER_INCLUDE = {
    supplier: true,
    location: true,
    createdBy: true,
    items: { include: { product: true } },
    payments: { include: { account: true, createdBy: true }, orderBy: { createdAt: "asc" as const } },
  };

  private async cutoverAt(organizationId: string, client: Prisma.TransactionClient | PrismaService = this.prisma) {
    const org = await client.organization.findUnique({ where: { id: organizationId }, select: { purchaseCutoverAt: true } });
    return org?.purchaseCutoverAt ?? null;
  }

  async getWorkflow(organizationId: string): Promise<PurchaseWorkflowDto> {
    const cutoverAt = await this.cutoverAt(organizationId);
    return { cutoverAt: cutoverAt ? cutoverAt.toISOString() : null, activated: cutoverAt !== null };
  }

  // The one switch from the old purchasing behaviour to the new one. It is set
  // once and never moved: an order received before it stays legacy for good,
  // one received after it owes money. Idempotent — a second call changes nothing.
  async activateCutover(user: AuthenticatedUser): Promise<PurchaseWorkflowDto> {
    await this.prisma.$transaction(async (tx) => {
      const flipped = await tx.organization.updateMany({
        where: { id: user.organizationId, purchaseCutoverAt: null },
        data: { purchaseCutoverAt: new Date() },
      });
      if (flipped.count === 1) {
        await recordAudit(tx, {
          organizationId: user.organizationId,
          actorId: user.id,
          action: "procurement.cutover",
          entityType: "Organization",
          entityId: user.organizationId,
          after: { purchaseCutoverAt: true },
        });
      }
    });
    return this.getWorkflow(user.organizationId);
  }

  async findAll(user: AuthenticatedUser, requestedLocationId?: string): Promise<PurchaseOrderDto[]> {
    const locationId = resolveLocationScope(user, requestedLocationId);

    const [orders, cutoverAt] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where: {
          organizationId: user.organizationId,
          ...(locationId ? { locationId } : {}),
        },
        include: ProcurementService.ORDER_INCLUDE,
        orderBy: { orderedAt: "desc" },
        take: 100,
      }),
      this.cutoverAt(user.organizationId),
    ]);

    return orders.map((o) => this.toDto(o, cutoverAt));
  }

  async create(user: AuthenticatedUser, dto: CreatePurchaseOrderDto): Promise<PurchaseOrderDto> {
    const locationId = requireLocationScope(user, dto.locationId);

    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, organizationId: user.organizationId },
    });
    if (!supplier) {
      throw new NotFoundException("Поставщик не найден");
    }

    const productIds = dto.items.map((i) => i.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, organizationId: user.organizationId },
    });
    if (products.length !== new Set(productIds).size) {
      throw new BadRequestException("Один или несколько товаров не найдены");
    }

    const items = dto.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      unitCost: item.unitCost,
      subtotal: round2(item.quantity * item.unitCost),
    }));
    const totalCost = round2(items.reduce((sum, i) => sum + i.subtotal, 0));

    // Placing an order creates NO payable: nothing has been delivered yet.
    const order = await this.prisma.purchaseOrder.create({
      data: {
        organizationId: user.organizationId,
        supplierId: dto.supplierId,
        locationId,
        totalCost,
        createdById: user.id,
        items: { create: items },
      },
      include: ProcurementService.ORDER_INCLUDE,
    });

    return this.toDto(order, await this.cutoverAt(user.organizationId));
  }

  // Receiving is what turns an order into stock AND into a payable: the
  // goods and the debt for them appear together, at the delivered quantity and
  // cost (the ordered values unless actuals are given).
  async receive(user: AuthenticatedUser, orderId: string, dto: ReceivePurchaseOrderRequestDto = {}): Promise<PurchaseOrderDto> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.purchaseOrder.findFirst({ where: { id: orderId, organizationId: user.organizationId } });
      if (!existing) {
        throw new NotFoundException("Заказ не найден");
      }
      resolveLocationScope(user, existing.locationId);

      // Only ONE receipt can win: the status flip is conditional, so two
      // simultaneous receipts cannot both put the goods on the shelf.
      const receivedAt = new Date();
      const flipped = await tx.purchaseOrder.updateMany({
        where: { id: orderId, status: PrismaPurchaseOrderStatus.PLACED },
        data: { status: PrismaPurchaseOrderStatus.RECEIVED, receivedAt },
      });
      if (flipped.count !== 1) {
        throw new BadRequestException("Заказ уже обработан");
      }

      const order = await tx.purchaseOrder.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: { include: { product: true } } },
      });

      const overrides = new Map((dto.items ?? []).map((i) => [i.itemId, i]));
      for (const itemId of overrides.keys()) {
        if (!order.items.some((i) => i.id === itemId)) {
          throw new BadRequestException("В заказе нет такой позиции");
        }
      }

      const lines = order.items.map((item) => {
        const o = overrides.get(item.id);
        const quantity = o?.quantity ?? item.quantity.toNumber();
        const unitCost = o?.unitCost ?? item.unitCost.toNumber();
        if (quantity < 0 || unitCost < 0) {
          throw new BadRequestException(`«${item.product.name}»: количество и цена не могут быть отрицательными`);
        }
        return { item, quantity, unitCost, subtotal: round2(quantity * unitCost) };
      });

      for (const line of lines) {
        if (line.quantity === 0) continue;
        await tx.stockLevel.upsert({
          where: { locationId_productId: { locationId: order.locationId, productId: line.item.productId } },
          update: { quantity: { increment: line.quantity } },
          create: {
            organizationId: user.organizationId,
            locationId: order.locationId,
            productId: line.item.productId,
            quantity: line.quantity,
            minQuantity: line.item.product.minQuantity,
          },
        });
      }

      await tx.stockMovement.createMany({
        data: lines
          .filter((l) => l.quantity > 0)
          .map((line) => ({
            organizationId: user.organizationId,
            locationId: order.locationId,
            productId: line.item.productId,
            type: StockMovementType.RECEIPT,
            quantity: line.quantity,
            reason: "Приёмка по заказу поставщику",
            purchaseOrderId: order.id,
            createdById: user.id,
            // What this delivery actually cost per unit.
            unitCost: line.unitCost,
            costBasis: CostBasis.PURCHASE_ACTUAL,
          })),
      });

      for (const line of lines) {
        const o = overrides.get(line.item.id);
        if (o && (o.quantity !== undefined || o.unitCost !== undefined)) {
          await tx.purchaseOrderItem.update({
            where: { id: line.item.id },
            data: { receivedQuantity: line.quantity, receivedUnitCost: line.unitCost },
          });
        }
      }

      const receivedTotal = round2(lines.reduce((sum, l) => sum + l.subtotal, 0));
      const updated = await tx.purchaseOrder.update({
        where: { id: order.id },
        data: { receivedTotal },
        include: ProcurementService.ORDER_INCLUDE,
      });

      // Inventory up, supplier payable up — journalised with the receipt.
      await postLedgerSources(tx, { organizationId: user.organizationId, actorId: user.id, scope: { purchaseOrderIds: [order.id] } });

      const cutoverAt = await this.cutoverAt(user.organizationId, tx);
      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "purchaseOrder.receive",
        entityType: "PurchaseOrder",
        entityId: order.id,
        before: { status: PrismaPurchaseOrderStatus.PLACED },
        after: {
          status: updated.status,
          receivedAt: updated.receivedAt,
          totalCost: updated.totalCost,
          receivedTotal,
          payableRecognized: cutoverAt !== null && receivedAt >= cutoverAt,
        },
      });

      return this.toDto(updated, cutoverAt);
    });
  }

  async cancel(user: AuthenticatedUser, orderId: string): Promise<PurchaseOrderDto> {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id: orderId, organizationId: user.organizationId },
    });
    if (!order) {
      throw new NotFoundException("Заказ не найден");
    }
    resolveLocationScope(user, order.locationId);

    const updated = await this.prisma.$transaction(async (tx) => {
      // Conditional, so a cancel racing a receipt cannot undo a delivery.
      const flipped = await tx.purchaseOrder.updateMany({
        where: { id: orderId, status: PrismaPurchaseOrderStatus.PLACED },
        data: { status: PrismaPurchaseOrderStatus.CANCELLED },
      });
      if (flipped.count !== 1) {
        throw new BadRequestException("Заказ уже обработан");
      }
      const saved = await tx.purchaseOrder.findUniqueOrThrow({
        where: { id: orderId },
        include: ProcurementService.ORDER_INCLUDE,
      });
      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "purchaseOrder.cancel",
        entityType: "PurchaseOrder",
        entityId: orderId,
        before: { status: order.status },
        after: { status: saved.status },
      });
      return saved;
    });

    return this.toDto(updated, await this.cutoverAt(user.organizationId));
  }

  // Pays a supplier against a RECEIVED order. The amount still owed is derived
  // under a row lock on the order, so two payments racing each other cannot
  // together pay more than is owed.
  async recordPayment(user: AuthenticatedUser, orderId: string, dto: RecordPurchaseOrderPaymentRequestDto): Promise<PurchaseOrderDto> {
    if (!(dto.amount > 0)) {
      throw new BadRequestException("Сумма оплаты должна быть больше нуля");
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "purchase_orders" WHERE id = ${orderId} FOR UPDATE`;
      const order = await tx.purchaseOrder.findFirst({
        where: { id: orderId, organizationId: user.organizationId },
        include: { payments: true },
      });
      if (!order) {
        throw new NotFoundException("Заказ не найден");
      }
      resolveLocationScope(user, order.locationId);
      if (order.status !== PrismaPurchaseOrderStatus.RECEIVED) {
        throw new BadRequestException("Оплатить можно только полученный заказ — до получения задолженности нет");
      }
      const cutoverAt = await this.cutoverAt(user.organizationId, tx);
      if (!this.payableRecognized(order, cutoverAt)) {
        throw new BadRequestException(
          "По этому заказу нет задолженности: он получен до перехода на новый порядок закупок",
        );
      }

      const due = (order.receivedTotal ?? order.totalCost).toNumber();
      const paid = order.payments.filter((p) => !p.reversedAt).reduce((sum, p) => sum + p.amount.toNumber(), 0);
      const outstanding = round2(due - paid);
      if (dto.amount > outstanding + 0.005) {
        throw new BadRequestException(`Сумма оплаты превышает остаток задолженности (${outstanding})`);
      }

      const account = await tx.cashAccount.findFirst({ where: { id: dto.accountId, organizationId: user.organizationId } });
      if (!account || !account.isActive) {
        throw new BadRequestException("Счёт не найден или заархивирован");
      }

      const payment = await tx.purchaseOrderPayment.create({
        data: {
          organizationId: user.organizationId,
          purchaseOrderId: orderId,
          accountId: dto.accountId,
          amount: dto.amount,
          note: dto.note,
          createdById: user.id,
        },
      });
      await this.cash.recordMovement(tx, {
        organizationId: user.organizationId,
        accountId: dto.accountId,
        type: CashMovementType.SUPPLIER_PAYMENT,
        amount: dto.amount,
        supplierId: order.supplierId,
        purchaseOrderPaymentId: payment.id,
        reason: dto.note ? `Оплата по заказу поставщику: ${dto.note}` : "Оплата по заказу поставщику",
        createdById: user.id,
      });
      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "purchaseOrder.payment",
        entityType: "PurchaseOrder",
        entityId: orderId,
        after: { paymentId: payment.id, amount: dto.amount, accountId: dto.accountId, outstandingAfter: round2(outstanding - dto.amount) },
      });

      const fresh = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: orderId }, include: ProcurementService.ORDER_INCLUDE });
      return this.toDto(fresh, cutoverAt);
    });
  }

  // Undoes a payment WITHOUT editing it: the payment is marked reversed and
  // the money coming back is its own cash movement, so both directions stay in
  // the ledger and the order owes the amount again.
  async reversePayment(user: AuthenticatedUser, orderId: string, paymentId: string, reason: string): Promise<PurchaseOrderDto> {
    if (!reason || reason.trim().length < 3) {
      throw new BadRequestException("Укажите причину отмены платежа");
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "purchase_orders" WHERE id = ${orderId} FOR UPDATE`;
      const order = await tx.purchaseOrder.findFirst({ where: { id: orderId, organizationId: user.organizationId } });
      if (!order) {
        throw new NotFoundException("Заказ не найден");
      }
      resolveLocationScope(user, order.locationId);
      const payment = await tx.purchaseOrderPayment.findFirst({ where: { id: paymentId, purchaseOrderId: orderId } });
      if (!payment) {
        throw new NotFoundException("Платёж не найден");
      }
      const flipped = await tx.purchaseOrderPayment.updateMany({
        where: { id: paymentId, reversedAt: null },
        data: { reversedAt: new Date(), reversedById: user.id, reversalReason: reason.trim() },
      });
      if (flipped.count !== 1) {
        throw new BadRequestException("Платёж уже отменён");
      }
      const original = await tx.cashMovement.findFirst({
        where: { purchaseOrderPaymentId: paymentId, type: CashMovementType.SUPPLIER_PAYMENT },
      });
      await this.cash.recordMovement(tx, {
        organizationId: user.organizationId,
        accountId: payment.accountId,
        // A signed correction, exactly how every other reversal in this ledger works.
        type: CashMovementType.ADJUSTMENT,
        amount: payment.amount.toNumber(),
        supplierId: order.supplierId,
        purchaseOrderPaymentId: paymentId,
        correctsMovementId: original?.id,
        reason: `Отмена платежа поставщику: ${reason.trim()}`,
        createdById: user.id,
      });
      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "purchaseOrder.paymentReverse",
        entityType: "PurchaseOrder",
        entityId: orderId,
        after: { paymentId, amount: payment.amount.toNumber() },
        reason: reason.trim(),
      });
      const fresh = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: orderId }, include: ProcurementService.ORDER_INCLUDE });
      return this.toDto(fresh, await this.cutoverAt(user.organizationId, tx));
    });
  }

  private payableRecognized(order: { status: string; receivedAt: Date | null }, cutoverAt: Date | null): boolean {
    return (
      order.status === PrismaPurchaseOrderStatus.RECEIVED &&
      cutoverAt !== null &&
      order.receivedAt !== null &&
      order.receivedAt >= cutoverAt
    );
  }

  private toDto = (
    order: {
      id: string;
      supplierId: string;
      supplier: { name: string };
      locationId: string;
      location: { name: string };
      status: string;
      totalCost: { toNumber: () => number };
      receivedTotal: { toNumber: () => number } | null;
      orderedAt: Date;
      receivedAt: Date | null;
      createdBy: { fullName: string };
      items: {
        id: string;
        productId: string;
        product: { name: string; unit: string };
        quantity: { toNumber: () => number };
        unitCost: { toNumber: () => number };
        subtotal: { toNumber: () => number };
        receivedQuantity: { toNumber: () => number } | null;
        receivedUnitCost: { toNumber: () => number } | null;
      }[];
      payments: {
        id: string;
        accountId: string;
        account: { name: string };
        amount: { toNumber: () => number };
        paidAt: Date;
        note: string | null;
        createdBy: { fullName: string };
        reversedAt: Date | null;
        reversalReason: string | null;
      }[];
    },
    cutoverAt: Date | null,
  ): PurchaseOrderDto => {
    const recognized = this.payableRecognized(order, cutoverAt);
    const due = order.receivedTotal?.toNumber() ?? order.totalCost.toNumber();
    const paid = round2(order.payments.filter((p) => !p.reversedAt).reduce((sum, p) => sum + p.amount.toNumber(), 0));
    const balanceDue = recognized ? round2(due - paid) : 0;
    return {
      id: order.id,
      supplierId: order.supplierId,
      supplierName: order.supplier.name,
      locationId: order.locationId,
      locationName: order.location.name,
      status: order.status as PurchaseOrderStatus,
      totalCost: order.totalCost.toNumber(),
      orderedAt: order.orderedAt.toISOString(),
      receivedAt: order.receivedAt ? order.receivedAt.toISOString() : null,
      createdByName: order.createdBy.fullName,
      receivedTotal: order.receivedTotal ? order.receivedTotal.toNumber() : null,
      payableRecognized: recognized,
      amountPaid: paid,
      balanceDue,
      paymentStatus: !recognized
        ? null
        : balanceDue <= 0
          ? PaymentStatus.PAID
          : paid > 0
            ? PaymentStatus.PARTIALLY_PAID
            : PaymentStatus.UNPAID,
      payments: order.payments.map((p) => ({
        id: p.id,
        accountId: p.accountId,
        accountName: p.account.name,
        amount: p.amount.toNumber(),
        paidAt: p.paidAt.toISOString(),
        note: p.note,
        createdByName: p.createdBy.fullName,
        reversedAt: p.reversedAt ? p.reversedAt.toISOString() : null,
        reversalReason: p.reversalReason,
      })),
      items: order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.product.name,
        unit: item.product.unit as Unit,
        quantity: item.quantity.toNumber(),
        unitCost: item.unitCost.toNumber(),
        subtotal: item.subtotal.toNumber(),
        receivedQuantity: item.receivedQuantity ? item.receivedQuantity.toNumber() : null,
        receivedUnitCost: item.receivedUnitCost ? item.receivedUnitCost.toNumber() : null,
      })),
    };
  };
}
