import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  BusinessContextPurchaseSupplierRowDto,
  BusinessContextPurchaseProductRowDto,
  BusinessContextPurchasesDto,
  PurchaseOrderDto,
  PurchaseOrderStatus,
  Unit,
} from "@bakery-os/shared";
import { PurchaseOrderStatus as PrismaPurchaseOrderStatus, StockMovementType } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { requireLocationScope, resolveLocationScope } from "../common/location-scope";
import { CreatePurchaseOrderDto } from "./dto/create-purchase-order.dto";

@Injectable()
export class ProcurementService {
  constructor(private prisma: PrismaService) {}

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

  async findAll(user: AuthenticatedUser, requestedLocationId?: string): Promise<PurchaseOrderDto[]> {
    const locationId = resolveLocationScope(user, requestedLocationId);

    const orders = await this.prisma.purchaseOrder.findMany({
      where: {
        organizationId: user.organizationId,
        ...(locationId ? { locationId } : {}),
      },
      include: {
        supplier: true,
        location: true,
        createdBy: true,
        items: { include: { product: true } },
      },
      orderBy: { orderedAt: "desc" },
      take: 100,
    });

    return orders.map(this.toDto);
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
      subtotal: item.quantity * item.unitCost,
    }));
    const totalCost = items.reduce((sum, i) => sum + i.subtotal, 0);

    const order = await this.prisma.purchaseOrder.create({
      data: {
        organizationId: user.organizationId,
        supplierId: dto.supplierId,
        locationId,
        totalCost,
        createdById: user.id,
        items: { create: items },
      },
      include: {
        supplier: true,
        location: true,
        createdBy: true,
        items: { include: { product: true } },
      },
    });

    return this.toDto(order);
  }

  async receive(user: AuthenticatedUser, orderId: string): Promise<PurchaseOrderDto> {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.purchaseOrder.findFirst({
        where: { id: orderId, organizationId: user.organizationId },
        include: { items: { include: { product: true } } },
      });
      if (!order) {
        throw new NotFoundException("Заказ не найден");
      }
      resolveLocationScope(user, order.locationId);
      if (order.status !== PrismaPurchaseOrderStatus.PLACED) {
        throw new BadRequestException("Заказ уже обработан");
      }

      for (const item of order.items) {
        await tx.stockLevel.upsert({
          where: { locationId_productId: { locationId: order.locationId, productId: item.productId } },
          update: { quantity: { increment: item.quantity.toNumber() } },
          create: {
            organizationId: user.organizationId,
            locationId: order.locationId,
            productId: item.productId,
            quantity: item.quantity.toNumber(),
            minQuantity: item.product.minQuantity,
          },
        });
      }

      await tx.stockMovement.createMany({
        data: order.items.map((item) => ({
          organizationId: user.organizationId,
          locationId: order.locationId,
          productId: item.productId,
          type: StockMovementType.RECEIPT,
          quantity: item.quantity,
          reason: "Приёмка по заказу поставщику",
          purchaseOrderId: order.id,
          createdById: user.id,
        })),
      });

      const updated = await tx.purchaseOrder.update({
        where: { id: order.id },
        data: { status: PrismaPurchaseOrderStatus.RECEIVED, receivedAt: new Date() },
        include: {
          supplier: true,
          location: true,
          createdBy: true,
          items: { include: { product: true } },
        },
      });

      return this.toDto(updated);
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
    if (order.status !== PrismaPurchaseOrderStatus.PLACED) {
      throw new BadRequestException("Заказ уже обработан");
    }

    const updated = await this.prisma.purchaseOrder.update({
      where: { id: orderId },
      data: { status: PrismaPurchaseOrderStatus.CANCELLED },
      include: {
        supplier: true,
        location: true,
        createdBy: true,
        items: { include: { product: true } },
      },
    });

    return this.toDto(updated);
  }

  private toDto = (order: {
    id: string;
    supplierId: string;
    supplier: { name: string };
    locationId: string;
    location: { name: string };
    status: string;
    totalCost: { toNumber: () => number };
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
    }[];
  }): PurchaseOrderDto => ({
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
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.product.name,
      unit: item.product.unit as Unit,
      quantity: item.quantity.toNumber(),
      unitCost: item.unitCost.toNumber(),
      subtotal: item.subtotal.toNumber(),
    })),
  });
}
