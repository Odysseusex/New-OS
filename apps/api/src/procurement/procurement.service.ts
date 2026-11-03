import { recordRawMaterialPurchase, revisePurchaseAverage } from "../costing/raw-material-average";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  CostBasis,
  BusinessContextPurchaseSupplierRowDto,
  BusinessContextPurchaseProductRowDto,
  BusinessContextPurchasesDto,
  CashMovementType,
  DocumentHistoryEntryDto,
  DocumentHistoryKind,
  PaymentStatus,
  PURCHASE_REVISION_REASON_MIN,
  ProductType,
  RevisePurchaseOrderRequestDto,
  PurchaseOrderDto,
  PurchaseOrderStatus,
  PurchaseWorkflowDto,
  ReceivePurchaseOrderRequestDto,
  RecordPurchaseOrderPaymentRequestDto,
  SupplierReturnRequestDto,
  Unit,
} from "@bakery-os/shared";
import { Prisma, PurchaseOrderStatus as PrismaPurchaseOrderStatus, StockMovementType } from "@prisma/client";
import { CashMovementsService } from "../finance/cash-movements.service";
import { round2, round3 } from "../common/money";
import { decrementStockOrThrow } from "../common/stock-guard";
import { PeriodGuard } from "../finance/periods/period-guard";
import { AuthenticatedUser } from "../auth/auth.types";
import { requireLocationScope, resolveLocationScope } from "../common/location-scope";
import { CreatePurchaseOrderDto } from "./dto/create-purchase-order.dto";
import { recordAudit } from "../audit/audit";
import { postLedgerSources } from "../ledger/event-posting";
import { purchaseOrderOwed } from "./purchase-owed";

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
    _count: { select: { revisions: true } },
    supplierReturns: { select: { creditedAmount: true, refundedAmount: true, lines: { select: { itemId: true, quantity: true } } } },
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
    const semi = products.filter((p) => p.type === "SEMI_FINISHED");
    if (semi.length > 0) {
      throw new BadRequestException(`Полуфабрикат нельзя закупать: ${semi.map((p) => p.name).join(", ")}`);
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
        // A raw material moves its weighted average by what this delivery cost.
        await recordRawMaterialPurchase(tx, line.item.productId, line.quantity, line.unitCost);
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
      await tx.$queryRaw`SELECT id FROM "purchase_orders" WHERE id = ${orderId} FOR UPDATE`;
      // Money paid ahead must come back first (cancel the payment): an order
      // cancelled with its advance still standing would hide money owed to us.
      const activeAdvance = await tx.purchaseOrderPayment.count({ where: { purchaseOrderId: orderId, reversedAt: null } });
      if (activeAdvance > 0) {
        throw new BadRequestException("По заказу внесён аванс — сначала отмените платёж (деньги вернулись), затем заказ");
      }
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
        include: { payments: true, supplierReturns: true },
      });
      if (!order) {
        throw new NotFoundException("Заказ не найден");
      }
      resolveLocationScope(user, order.locationId);
      const cutoverAt = await this.cutoverAt(user.organizationId, tx);
      // A PLACED order may be paid ahead (аванс поставщику) up to what was
      // ordered; the receipt then settles against it by itself (received −
      // paid). Only with the purchasing cutover on — before it there is no
      // supplier debt for the advance to settle against.
      const advance = order.status === PrismaPurchaseOrderStatus.PLACED;
      if (advance) {
        if (!cutoverAt) {
          throw new BadRequestException("Аванс поставщику доступен после перехода на новый порядок закупок");
        }
      } else if (order.status !== PrismaPurchaseOrderStatus.RECEIVED) {
        throw new BadRequestException("Заказ отменён — оплачивать нечего");
      } else if (!this.payableRecognized(order, cutoverAt)) {
        throw new BadRequestException(
          "По этому заказу нет задолженности: он получен до перехода на новый порядок закупок",
        );
      }

      const outstanding = advance
        ? round2(order.totalCost.toNumber() - order.payments.filter((p) => !p.reversedAt).reduce((s, p) => s + p.amount.toNumber(), 0))
        : purchaseOrderOwed(order);
      if (dto.amount > outstanding + 0.005) {
        throw new BadRequestException(
          advance ? `Аванс больше суммы заказа (осталось ${outstanding})` : `Сумма оплаты превышает остаток задолженности (${outstanding})`,
        );
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
        reason: `${advance ? "Аванс поставщику" : "Оплата по заказу поставщику"}${dto.note ? `: ${dto.note}` : ""}`,
        createdById: user.id,
      });
      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "purchaseOrder.payment",
        entityType: "PurchaseOrder",
        entityId: orderId,
        after: { paymentId: payment.id, amount: dto.amount, accountId: dto.accountId, advance, outstandingAfter: round2(outstanding - dto.amount) },
      });

      const fresh = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: orderId }, include: ProcurementService.ORDER_INCLUDE });
      return this.toDto(fresh, cutoverAt);
    });
  }

  // A supplier payment the bank reports (загрузка выписки): spread over that
  // supplier's received orders that still owe something, oldest first, dated
  // when the bank says. Runs inside the caller's transaction. Refused when it is
  // more than the supplier is owed — an advance is not built, and money paid
  // for something else must be posted as what it was.
  async paySupplierOrders(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    input: { supplierId: string; accountId: string; amount: number; paidAt: Date; note: string },
  ): Promise<string> {
    const cutoverAt = await this.cutoverAt(user.organizationId, tx);
    if (!cutoverAt) {
      throw new BadRequestException("Учёт долгов поставщикам не включён — проведите как расход по статье");
    }
    const orders = await tx.purchaseOrder.findMany({
      where: { organizationId: user.organizationId, supplierId: input.supplierId, status: "RECEIVED", receivedAt: { gte: cutoverAt } },
      include: { payments: true, supplierReturns: true },
      orderBy: { receivedAt: "asc" },
    });
    for (const o of orders) await tx.$queryRaw`SELECT id FROM "purchase_orders" WHERE id = ${o.id} FOR UPDATE`;
    const open = orders.map((o) => ({ order: o, owed: purchaseOrderOwed(o) })).filter((x) => x.owed > 0.005);
    const totalOwed = round2(open.reduce((s, x) => s + x.owed, 0));
    if (input.amount > totalOwed + 0.005) {
      throw new BadRequestException(`Поставщику должны ${totalOwed} ₸ — оплата ${input.amount} ₸ больше долга`);
    }
    let left = round2(input.amount);
    const paid: string[] = [];
    for (const { order, owed } of open) {
      if (left <= 0.005) break;
      const amount = round2(Math.min(left, owed));
      const payment = await tx.purchaseOrderPayment.create({
        data: {
          organizationId: user.organizationId,
          purchaseOrderId: order.id,
          accountId: input.accountId,
          amount,
          paidAt: input.paidAt,
          note: input.note,
          createdById: user.id,
        },
      });
      await this.cash.recordMovement(tx, {
        organizationId: user.organizationId,
        accountId: input.accountId,
        type: CashMovementType.SUPPLIER_PAYMENT,
        amount,
        supplierId: input.supplierId,
        purchaseOrderPaymentId: payment.id,
        reason: `Оплата по заказу поставщику: ${input.note}`,
        createdById: user.id,
        occurredAt: input.paidAt,
      });
      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "purchaseOrder.payment",
        entityType: "PurchaseOrder",
        entityId: order.id,
        after: { paymentId: payment.id, amount, accountId: input.accountId, source: "bankStatement" },
      });
      paid.push(`${amount} ₸ — заказ от ${order.receivedAt!.toISOString().slice(0, 10)}`);
      left = round2(left - amount);
    }
    return paid.join("; ");
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

  // Corrects a RECEIVED order inside the document — the delivered quantity or
  // price of a line was entered wrong. Nothing already written is rewritten:
  //   · the order's lines and received total carry the corrected values, and a
  //     PurchaseOrderRevision keeps what they said before, who, when and why;
  //   · the stock difference is a new movement on the order (a negative one
  //     takes goods off the shelf only if they are still there);
  //   · the money difference is its own financial event dated at the receipt
  //     (purchase-events.ts), so a journal entry already posted stays as it is;
  //   · the debt to the supplier follows by itself (received total − payments).
  // Refused when the receipt's month is closed, when the corrected total would
  // be less than already paid, and for anything but a received order.
  async revise(user: AuthenticatedUser, orderId: string, dto: RevisePurchaseOrderRequestDto): Promise<PurchaseOrderDto> {
    const reason = (dto.reason ?? "").trim();
    if (reason.length < PURCHASE_REVISION_REASON_MIN) {
      throw new BadRequestException(`Укажите причину исправления (не короче ${PURCHASE_REVISION_REASON_MIN} символов)`);
    }
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException("Нет изменений");
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "purchase_orders" WHERE id = ${orderId} FOR UPDATE`;
      const order = await tx.purchaseOrder.findFirst({
        where: { id: orderId, organizationId: user.organizationId },
        include: {
          items: { include: { product: true } },
          payments: true,
          revisions: { select: { number: true }, orderBy: { number: "desc" }, take: 1 },
          _count: { select: { supplierReturns: true } },
        },
      });
      if (!order) {
        throw new NotFoundException("Заказ не найден");
      }
      resolveLocationScope(user, order.locationId);
      if (order.status !== PrismaPurchaseOrderStatus.RECEIVED || !order.receivedAt) {
        throw new BadRequestException("Исправить можно только принятый заказ");
      }
      // A correction rewrites what was received; a return already took part of
      // it back at the old figures. Mixing the two would make neither true.
      if (order._count.supplierReturns > 0) {
        throw new BadRequestException("По заказу уже был возврат поставщику — исправить приёмку нельзя. Оформите ещё один возврат или корректировку остатка.");
      }
      await new PeriodGuard(this.prisma).assertOpen(user.organizationId, order.receivedAt, tx);

      const current = (item: (typeof order.items)[number]) => ({
        quantity: (item.receivedQuantity ?? item.quantity).toNumber(),
        unitCost: (item.receivedUnitCost ?? item.unitCost).toNumber(),
      });
      const seen = new Set<string>();
      const changes: { item: (typeof order.items)[number]; before: { quantity: number; unitCost: number }; after: { quantity: number; unitCost: number } }[] = [];
      for (const line of dto.items) {
        const item = order.items.find((i) => i.id === line.itemId);
        if (!item) throw new BadRequestException("В заказе нет такой позиции");
        if (seen.has(item.id)) throw new BadRequestException(`«${item.product.name}» указан дважды`);
        seen.add(item.id);
        if (!Number.isFinite(line.quantity) || !Number.isFinite(line.unitCost) || line.quantity < 0 || line.unitCost < 0) {
          throw new BadRequestException(`«${item.product.name}»: количество и цена не могут быть отрицательными`);
        }
        const before = current(item);
        const after = { quantity: round3(line.quantity), unitCost: round2(line.unitCost) };
        if (after.quantity === before.quantity && after.unitCost === before.unitCost) continue;
        changes.push({ item, before, after });
      }
      if (changes.length === 0) {
        throw new BadRequestException("Ничего не изменилось");
      }

      const changed = new Map(changes.map((c) => [c.item.id, c.after]));
      const totalBefore = round2((order.receivedTotal ?? order.totalCost).toNumber());
      const totalAfter = round2(
        order.items.reduce((sum, item) => {
          const v = changed.get(item.id) ?? current(item);
          return sum + round2(v.quantity * v.unitCost);
        }, 0),
      );
      const cutoverAt = await this.cutoverAt(user.organizationId, tx);
      if (this.payableRecognized(order, cutoverAt)) {
        const paid = round2(order.payments.filter((p) => !p.reversedAt).reduce((sum, p) => sum + p.amount.toNumber(), 0));
        if (totalAfter < paid - 0.005) {
          throw new BadRequestException(
            `После исправления сумма заказа (${totalAfter}) меньше уже оплаченной (${paid}). Сначала отмените лишнюю оплату.`,
          );
        }
      }

      for (const { item, before, after } of changes) {
        const delta = round3(after.quantity - before.quantity);
        // The latest purchase price on the card follows the correction only if
        // this order is still the product's latest priced receipt.
        if (item.product.type === ProductType.RAW_MATERIAL && after.unitCost !== before.unitCost) {
          const latest = await tx.stockMovement.findFirst({
            where: { productId: item.productId, type: StockMovementType.RECEIPT, unitCost: { not: null } },
            orderBy: { createdAt: "desc" },
            select: { purchaseOrderId: true },
          });
          if (latest?.purchaseOrderId === order.id) {
            await tx.product.update({ where: { id: item.productId }, data: { price: after.unitCost } });
          }
        }
        // The average moves before the stock does (it reads the stock on hand).
        await revisePurchaseAverage(tx, item.productId, before, after);
        if (delta < 0) {
          await decrementStockOrThrow(
            tx,
            { locationId: order.locationId, productId: item.productId, quantity: -delta },
            `«${item.product.name}»: на складе нет ${-delta} — часть уже израсходована или продана. Уменьшить приход на столько нельзя.`,
          );
        } else if (delta > 0) {
          await tx.stockLevel.upsert({
            where: { locationId_productId: { locationId: order.locationId, productId: item.productId } },
            update: { quantity: { increment: delta } },
            create: {
              organizationId: user.organizationId,
              locationId: order.locationId,
              productId: item.productId,
              quantity: delta,
              minQuantity: item.product.minQuantity,
            },
          });
        }
        if (delta !== 0) {
          await tx.stockMovement.create({
            data: {
              organizationId: user.organizationId,
              locationId: order.locationId,
              productId: item.productId,
              type: StockMovementType.RECEIPT,
              // Signed: a correction down takes the difference back off the receipt.
              quantity: delta,
              reason: `Исправление приёмки по заказу: ${reason}`,
              purchaseOrderId: order.id,
              createdById: user.id,
              unitCost: after.unitCost,
              costBasis: CostBasis.PURCHASE_ACTUAL,
            },
          });
        }
        await tx.purchaseOrderItem.update({
          where: { id: item.id },
          data: { receivedQuantity: after.quantity, receivedUnitCost: after.unitCost },
        });
      }

      const number = (order.revisions[0]?.number ?? 0) + 1;
      await tx.purchaseOrderRevision.create({
        data: {
          organizationId: user.organizationId,
          purchaseOrderId: order.id,
          number,
          totalBefore,
          totalAfter,
          reason,
          createdById: user.id,
          lines: {
            create: changes.map((c) => ({
              itemId: c.item.id,
              quantityBefore: c.before.quantity,
              quantityAfter: c.after.quantity,
              unitCostBefore: c.before.unitCost,
              unitCostAfter: c.after.unitCost,
            })),
          },
        },
      });
      const updated = await tx.purchaseOrder.update({
        where: { id: order.id },
        data: { receivedTotal: totalAfter },
        include: ProcurementService.ORDER_INCLUDE,
      });

      // Only the difference reaches the books, as its own event.
      await postLedgerSources(tx, { organizationId: user.organizationId, actorId: user.id, scope: { purchaseOrderIds: [order.id] } });

      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "purchaseOrder.revise",
        entityType: "PurchaseOrder",
        entityId: order.id,
        before: { receivedTotal: totalBefore, lines: changes.map((c) => ({ product: c.item.product.name, ...c.before })) },
        after: { receivedTotal: totalAfter, revision: number, lines: changes.map((c) => ({ product: c.item.product.name, ...c.after })) },
        reason,
      });

      return this.toDto(updated, cutoverAt);
    });
  }

  // «Возврат поставщику»: goods of a received order handed back to its supplier
  // (torn bags, the wrong product, spoiled on arrival). The order is never
  // edited; a SupplierReturn document records it:
  //   · the goods leave the shelf (SUPPLIER_RETURN movements) at the price they
  //     were received at, and a raw material's average takes that price out;
  //   · the supplier's debt shrinks by their value (creditedAmount);
  //   · when the order was already paid for more than it is now worth, the
  //     supplier hands the difference back — its own cash movement into
  //     `refundAccountId` (an order received before the purchasing cutover has
  //     no debt in the system, so nothing about money is recorded for it).
  // Refused for more than is left of a line, for goods no longer on the shelf,
  // and for anything but a received order.
  async returnToSupplier(user: AuthenticatedUser, orderId: string, dto: SupplierReturnRequestDto): Promise<PurchaseOrderDto> {
    const reason = (dto.reason ?? "").trim();
    if (reason.length < PURCHASE_REVISION_REASON_MIN) {
      throw new BadRequestException(`Укажите причину возврата (не короче ${PURCHASE_REVISION_REASON_MIN} символов)`);
    }
    const wanted = (dto.items ?? []).filter((i) => i.quantity !== 0);
    if (wanted.length === 0) {
      throw new BadRequestException("Укажите, что возвращается");
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "purchase_orders" WHERE id = ${orderId} FOR UPDATE`;
      const order = await tx.purchaseOrder.findFirst({
        where: { id: orderId, organizationId: user.organizationId },
        include: {
          items: { include: { product: true } },
          payments: true,
          supplierReturns: { include: { lines: true } },
        },
      });
      if (!order) {
        throw new NotFoundException("Заказ не найден");
      }
      resolveLocationScope(user, order.locationId);
      if (order.status !== PrismaPurchaseOrderStatus.RECEIVED || !order.receivedAt) {
        throw new BadRequestException("Вернуть поставщику можно только товар принятого заказа");
      }
      const returnedAt = new Date();
      await new PeriodGuard(this.prisma).assertOpen(user.organizationId, returnedAt, tx);

      const alreadyReturned = new Map<string, number>();
      for (const r of order.supplierReturns) {
        for (const l of r.lines) alreadyReturned.set(l.itemId, (alreadyReturned.get(l.itemId) ?? 0) + l.quantity.toNumber());
      }
      const seen = new Set<string>();
      const lines = wanted.map((w) => {
        const item = order.items.find((i) => i.id === w.itemId);
        if (!item) throw new BadRequestException("В заказе нет такой позиции");
        if (seen.has(item.id)) throw new BadRequestException(`«${item.product.name}» указан дважды`);
        seen.add(item.id);
        const quantity = round3(w.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) {
          throw new BadRequestException(`«${item.product.name}»: количество должно быть больше нуля`);
        }
        const received = (item.receivedQuantity ?? item.quantity).toNumber();
        const left = round3(received - (alreadyReturned.get(item.id) ?? 0));
        if (quantity > left + 0.0005) {
          throw new BadRequestException(`«${item.product.name}»: принято ${received}, вернуть можно не больше ${left}`);
        }
        const unitCost = (item.receivedUnitCost ?? item.unitCost).toNumber();
        return { item, quantity, unitCost, subtotal: round2(quantity * unitCost) };
      });
      const credited = round2(lines.reduce((s, l) => s + l.subtotal, 0));

      const cutoverAt = await this.cutoverAt(user.organizationId, tx);
      const recognized = this.payableRecognized(order, cutoverAt);
      // What the order still owes AFTER this credit; below zero = the supplier
      // holds our money for goods we no longer have, and gives it back.
      const refund = recognized ? round2(Math.max(0, credited - purchaseOrderOwed(order))) : 0;
      let refundAccountId: string | null = null;
      if (refund > 0) {
        if (!dto.refundAccountId) {
          throw new BadRequestException(`Заказ уже оплачен: поставщик возвращает ${refund} — укажите, на какой счёт`);
        }
        const account = await tx.cashAccount.findFirst({ where: { id: dto.refundAccountId, organizationId: user.organizationId } });
        if (!account || !account.isActive) {
          throw new BadRequestException("Счёт не найден или заархивирован");
        }
        refundAccountId = account.id;
      }

      const document = await tx.supplierReturn.create({
        data: {
          organizationId: user.organizationId,
          purchaseOrderId: order.id,
          supplierId: order.supplierId,
          locationId: order.locationId,
          creditedAmount: credited,
          refundedAmount: refund,
          reason,
          createdById: user.id,
          createdAt: returnedAt,
          lines: {
            create: lines.map((l) => ({ itemId: l.item.id, productId: l.item.productId, quantity: l.quantity, unitCost: l.unitCost, subtotal: l.subtotal })),
          },
        },
      });

      for (const l of lines) {
        // The average gives back the price these goods came in at, before the stock leaves.
        await revisePurchaseAverage(tx, l.item.productId, { quantity: l.quantity, unitCost: l.unitCost }, { quantity: 0, unitCost: l.unitCost });
        await decrementStockOrThrow(
          tx,
          { locationId: order.locationId, productId: l.item.productId, quantity: l.quantity },
          `«${l.item.product.name}»: на складе нет ${l.quantity} — часть уже израсходована или продана`,
        );
      }
      await tx.stockMovement.createMany({
        data: lines.map((l) => ({
          organizationId: user.organizationId,
          locationId: order.locationId,
          productId: l.item.productId,
          type: StockMovementType.SUPPLIER_RETURN,
          quantity: l.quantity,
          reason: `Возврат поставщику: ${reason}`,
          supplierReturnId: document.id,
          createdById: user.id,
          createdAt: returnedAt,
          unitCost: l.unitCost,
          costBasis: CostBasis.PURCHASE_ACTUAL,
        })),
      });

      if (refund > 0 && refundAccountId) {
        await this.cash.recordMovement(tx, {
          organizationId: user.organizationId,
          accountId: refundAccountId,
          // Money coming back from the supplier: a signed correction, like a payment reversal.
          type: CashMovementType.ADJUSTMENT,
          amount: refund,
          supplierId: order.supplierId,
          supplierReturnId: document.id,
          reason: `Возврат денег от поставщика за возвращённый товар: ${reason}`,
          createdById: user.id,
        });
      }

      // Inventory and the supplier debt down — journalised with the return.
      await postLedgerSources(tx, { organizationId: user.organizationId, actorId: user.id, scope: { purchaseOrderIds: [order.id] } });

      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "purchaseOrder.supplierReturn",
        entityType: "PurchaseOrder",
        entityId: order.id,
        after: {
          supplierReturnId: document.id,
          creditedAmount: credited,
          refundedAmount: refund,
          lines: lines.map((l) => ({ product: l.item.product.name, quantity: l.quantity, unitCost: l.unitCost })),
        },
        reason,
      });

      const fresh = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: orderId }, include: ProcurementService.ORDER_INCLUDE });
      return this.toDto(fresh, cutoverAt);
    });
  }

  // «История изменений» of one order: who did what to it and when, with the
  // document's figures before and after. Read from the rows the actions left
  // behind (the order, its revisions, payments, the audit trail) — nothing is
  // stored for the history itself.
  async history(user: AuthenticatedUser, orderId: string): Promise<DocumentHistoryEntryDto[]> {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id: orderId, organizationId: user.organizationId },
      include: {
        createdBy: { select: { fullName: true } },
        items: { include: { product: { select: { name: true, unit: true } } } },
        payments: { include: { createdBy: { select: { fullName: true } }, reversedBy: { select: { fullName: true } } } },
        revisions: {
          include: { createdBy: { select: { fullName: true } }, lines: true },
          orderBy: { number: "asc" },
        },
        supplierReturns: { include: { createdBy: { select: { fullName: true } }, lines: true } },
      },
    });
    if (!order) {
      throw new NotFoundException("Заказ не найден");
    }
    resolveLocationScope(user, order.locationId);
    const [audit, firstReceipt] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: {
          organizationId: user.organizationId,
          entityType: "PurchaseOrder",
          entityId: orderId,
          action: { in: ["purchaseOrder.receive", "purchaseOrder.cancel"] },
        },
        include: { actor: { select: { fullName: true } } },
      }),
      this.prisma.stockMovement.findFirst({
        where: { purchaseOrderId: orderId, type: StockMovementType.RECEIPT },
        orderBy: { createdAt: "asc" },
        include: { createdBy: { select: { fullName: true } } },
      }),
    ]);
    const actorOf = (action: string) => audit.find((a) => a.action === action)?.actor?.fullName ?? null;
    const itemById = new Map(order.items.map((i) => [i.id, i]));
    const line = (itemId: string, qb: number, qa: number, cb: number, ca: number) => {
      const item = itemById.get(itemId)!;
      return { productName: item.product.name, unit: item.product.unit, quantityBefore: qb, quantityAfter: qa, unitCostBefore: cb, unitCostAfter: ca };
    };

    const entries: DocumentHistoryEntryDto[] = [
      {
        kind: DocumentHistoryKind.CREATED,
        at: order.orderedAt.toISOString(),
        actorName: order.createdBy.fullName,
        amountBefore: null,
        amountAfter: order.totalCost.toNumber(),
        amount: null,
        reason: null,
        lines: [],
      },
    ];

    if (order.receivedAt) {
      // What the receipt itself recorded: the values before the first correction
      // of each line, otherwise what the line says now.
      const firstBefore = new Map<string, { quantity: number; unitCost: number }>();
      for (const r of order.revisions) {
        for (const l of r.lines) {
          if (!firstBefore.has(l.itemId)) firstBefore.set(l.itemId, { quantity: l.quantityBefore.toNumber(), unitCost: l.unitCostBefore.toNumber() });
        }
      }
      const corrected = order.revisions.reduce((s, r) => s + r.totalAfter.toNumber() - r.totalBefore.toNumber(), 0);
      const receivedTotal = (order.receivedTotal ?? order.totalCost).toNumber();
      entries.push({
        kind: DocumentHistoryKind.RECEIVED,
        at: order.receivedAt.toISOString(),
        actorName: actorOf("purchaseOrder.receive") ?? firstReceipt?.createdBy?.fullName ?? null,
        amountBefore: order.totalCost.toNumber(),
        amountAfter: round2(receivedTotal - corrected),
        amount: null,
        reason: null,
        lines: order.items
          .map((item) => {
            const got = firstBefore.get(item.id) ?? {
              quantity: (item.receivedQuantity ?? item.quantity).toNumber(),
              unitCost: (item.receivedUnitCost ?? item.unitCost).toNumber(),
            };
            return line(item.id, item.quantity.toNumber(), got.quantity, item.unitCost.toNumber(), got.unitCost);
          })
          .filter((l) => l.quantityBefore !== l.quantityAfter || l.unitCostBefore !== l.unitCostAfter),
      });
    }

    for (const r of order.revisions) {
      entries.push({
        kind: DocumentHistoryKind.REVISED,
        at: r.createdAt.toISOString(),
        actorName: r.createdBy.fullName,
        amountBefore: r.totalBefore.toNumber(),
        amountAfter: r.totalAfter.toNumber(),
        amount: null,
        reason: r.reason,
        lines: r.lines.map((l) =>
          line(l.itemId, l.quantityBefore.toNumber(), l.quantityAfter.toNumber(), l.unitCostBefore.toNumber(), l.unitCostAfter.toNumber()),
        ),
      });
    }

    if (order.status === PrismaPurchaseOrderStatus.CANCELLED) {
      const cancel = audit.find((a) => a.action === "purchaseOrder.cancel");
      entries.push({
        kind: DocumentHistoryKind.CANCELLED,
        at: (cancel?.createdAt ?? order.orderedAt).toISOString(),
        actorName: cancel?.actor?.fullName ?? null,
        amountBefore: null,
        amountAfter: null,
        amount: null,
        reason: null,
        lines: [],
      });
    }

    for (const r of order.supplierReturns) {
      const credited = r.creditedAmount.toNumber();
      entries.push({
        kind: DocumentHistoryKind.SUPPLIER_RETURN,
        at: r.createdAt.toISOString(),
        actorName: r.createdBy.fullName,
        amountBefore: null,
        amountAfter: -credited,
        amount: r.refundedAmount.toNumber() > 0 ? r.refundedAmount.toNumber() : null,
        reason: r.reason,
        lines: r.lines.map((l) => {
          const q = l.quantity.toNumber();
          const c = l.unitCost.toNumber();
          return line(l.itemId, q, 0, c, c);
        }),
      });
    }

    for (const p of order.payments) {
      entries.push({
        kind: DocumentHistoryKind.PAID,
        at: p.paidAt.toISOString(),
        actorName: p.createdBy.fullName,
        amountBefore: null,
        amountAfter: null,
        amount: p.amount.toNumber(),
        reason: p.note,
        lines: [],
      });
      if (p.reversedAt) {
        entries.push({
          kind: DocumentHistoryKind.PAYMENT_REVERSED,
          at: p.reversedAt.toISOString(),
          actorName: p.reversedBy?.fullName ?? null,
          amountBefore: null,
          amountAfter: null,
          amount: p.amount.toNumber(),
          reason: p.reversalReason,
          lines: [],
        });
      }
    }

    return entries.sort((a, b) => a.at.localeCompare(b.at));
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
      _count?: { revisions: number };
      supplierReturns?: { creditedAmount: { toNumber: () => number }; refundedAmount: { toNumber: () => number }; lines: { itemId: string; quantity: { toNumber: () => number } }[] }[];
    },
    cutoverAt: Date | null,
  ): PurchaseOrderDto => {
    const recognized = this.payableRecognized(order, cutoverAt);
    const returns = order.supplierReturns ?? [];
    const paid = round2(order.payments.filter((p) => !p.reversedAt).reduce((sum, p) => sum + p.amount.toNumber(), 0));
    const owed = recognized ? purchaseOrderOwed({ ...order, supplierReturns: returns }) : 0;
    const balanceDue = Math.max(0, owed);
    // Paid before the goods came (an advance), or above what they came to.
    const advance = order.status === PrismaPurchaseOrderStatus.PLACED ? paid : Math.max(0, round2(-owed));
    const returnedOf = (itemId: string) =>
      round3(returns.reduce((s, r) => s + r.lines.filter((l) => l.itemId === itemId).reduce((t, l) => t + l.quantity.toNumber(), 0), 0));
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
      advance,
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
        returnedQuantity: returnedOf(item.id),
      })),
      revisionCount: order._count?.revisions ?? 0,
      returnedTotal: round2(returns.reduce((s, r) => s + r.creditedAmount.toNumber(), 0)),
      refundedTotal: round2(returns.reduce((s, r) => s + r.refundedAmount.toNumber(), 0)),
      returnCount: returns.length,
    };
  };
}

