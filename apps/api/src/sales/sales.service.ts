import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  CashAccountType,
  CashMovementType,
  PaymentMethod,
  PaymentStatus,
  SaleDetailDto,
  SaleDto,
  SalesReportDto,
  SalesSummaryDto,
} from "@bakery-os/shared";
import { StockMovementType } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { requireLocationScope, resolveLocationScope } from "../common/location-scope";
import { CashMovementsService } from "../finance/cash-movements.service";
import { CreateSaleDto } from "./dto/create-sale.dto";
import { RecordPaymentDto } from "./dto/record-payment.dto";

const SALE_INCLUDE = { location: true, customer: true, createdBy: true, items: true };
const SALE_DETAIL_INCLUDE = {
  location: true,
  customer: true,
  createdBy: true,
  items: { include: { product: true } },
};

@Injectable()
export class SalesService {
  constructor(
    private prisma: PrismaService,
    private cashMovementsService: CashMovementsService,
  ) {}

  // CASH sales land in the selling location's own till, auto-created the
  // first time it's needed so a cashier never has to set up accounting
  // before ringing up a sale. CARD/TRANSFER land in the organization's
  // default bank account; if none is configured yet, the sale still
  // succeeds — the cash ledger is additive, never a gate on selling — it
  // just doesn't gain a CashMovement for that receipt.
  private async resolveSaleAccountId(
    tx: Prisma.TransactionClient,
    organizationId: string,
    locationId: string,
    paymentMethod: PaymentMethod,
  ): Promise<string | null> {
    if (paymentMethod === PaymentMethod.CASH) {
      const existing = await tx.cashAccount.findFirst({
        where: { organizationId, locationId, type: CashAccountType.CASH },
      });
      if (existing) return existing.id;

      const location = await tx.location.findUnique({ where: { id: locationId } });
      const created = await tx.cashAccount.create({
        data: {
          organizationId,
          name: `Касса «${location?.name ?? "точка"}»`,
          type: CashAccountType.CASH,
          locationId,
        },
      });
      return created.id;
    }

    const bank = await tx.cashAccount.findFirst({
      where: { organizationId, type: CashAccountType.BANK, isDefault: true, isActive: true },
    });
    return bank?.id ?? null;
  }

  async findAll(user: AuthenticatedUser, requestedLocationId?: string, limit = 50): Promise<SaleDto[]> {
    const locationId = resolveLocationScope(user, requestedLocationId);

    const sales = await this.prisma.sale.findMany({
      where: {
        organizationId: user.organizationId,
        ...(locationId ? { locationId } : {}),
      },
      include: SALE_INCLUDE,
      orderBy: { soldAt: "desc" },
      take: limit,
    });

    return sales.map(this.toSaleDto);
  }

  async summary(user: AuthenticatedUser, requestedLocationId?: string): Promise<SalesSummaryDto> {
    const locationId = resolveLocationScope(user, requestedLocationId);
    const baseWhere = {
      organizationId: user.organizationId,
      ...(locationId ? { locationId } : {}),
    };

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const [todaySales, last7DaysSales] = await Promise.all([
      this.prisma.sale.findMany({ where: { ...baseWhere, soldAt: { gte: startOfToday } } }),
      this.prisma.sale.findMany({ where: { ...baseWhere, soldAt: { gte: sevenDaysAgo } } }),
    ]);

    const todayRevenue = todaySales.reduce((sum, s) => sum + s.totalAmount.toNumber(), 0);
    const last7DaysRevenue = last7DaysSales.reduce((sum, s) => sum + s.totalAmount.toNumber(), 0);
    const averageTicket = last7DaysSales.length > 0 ? last7DaysRevenue / last7DaysSales.length : 0;

    return {
      todayRevenue,
      todaySalesCount: todaySales.length,
      last7DaysRevenue,
      averageTicket,
    };
  }

  async report(
    user: AuthenticatedUser,
    from: Date,
    to: Date,
    requestedLocationId?: string,
  ): Promise<SalesReportDto> {
    const locationId = resolveLocationScope(user, requestedLocationId);

    const sales = await this.prisma.sale.findMany({
      where: {
        organizationId: user.organizationId,
        soldAt: { gte: from, lte: to },
        ...(locationId ? { locationId } : {}),
      },
      include: { location: true, items: { include: { product: true } } },
    });

    const byLocationMap = new Map<string, { locationName: string; revenue: number; count: number }>();
    const byProductMap = new Map<string, { productName: string; quantity: number; revenue: number }>();
    let totalRevenue = 0;

    for (const sale of sales) {
      const revenue = sale.totalAmount.toNumber();
      totalRevenue += revenue;

      const locationEntry = byLocationMap.get(sale.locationId) ?? {
        locationName: sale.location.name,
        revenue: 0,
        count: 0,
      };
      locationEntry.revenue += revenue;
      locationEntry.count += 1;
      byLocationMap.set(sale.locationId, locationEntry);

      for (const item of sale.items) {
        const productEntry = byProductMap.get(item.productId) ?? {
          productName: item.product.name,
          quantity: 0,
          revenue: 0,
        };
        productEntry.quantity += item.quantity.toNumber();
        productEntry.revenue += item.subtotal.toNumber();
        byProductMap.set(item.productId, productEntry);
      }
    }

    const byLocation = Array.from(byLocationMap.entries())
      .map(([locationId, v]) => ({ locationId, locationName: v.locationName, revenue: v.revenue, count: v.count }))
      .sort((a, b) => b.revenue - a.revenue);

    const byProduct = Array.from(byProductMap.entries())
      .map(([productId, v]) => ({ productId, productName: v.productName, quantity: v.quantity, revenue: v.revenue }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 20);

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      totalRevenue,
      totalCount: sales.length,
      byLocation,
      byProduct,
    };
  }

  async findOne(user: AuthenticatedUser, saleId: string): Promise<SaleDetailDto> {
    const sale = await this.prisma.sale.findFirst({
      where: { id: saleId, organizationId: user.organizationId },
      include: SALE_DETAIL_INCLUDE,
    });
    if (!sale) {
      throw new NotFoundException("Продажа не найдена");
    }
    resolveLocationScope(user, sale.locationId);
    return this.toSaleDetailDto(sale);
  }

  async create(user: AuthenticatedUser, dto: CreateSaleDto): Promise<SaleDetailDto> {
    const locationId = requireLocationScope(user, dto.locationId);

    if (dto.customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: dto.customerId, organizationId: user.organizationId },
      });
      if (!customer) {
        throw new NotFoundException("Клиент не найден");
      }
    }

    const productIds = dto.items.map((i) => i.productId);
    const items = dto.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      subtotal: item.quantity * item.unitPrice,
    }));
    const totalAmount = items.reduce((sum, i) => sum + i.subtotal, 0);

    // Walk-in retail sales are always settled immediately. Only a sale tied
    // to a customer account can be placed on credit (partially or fully).
    const amountPaid = dto.customerId ? Math.min(dto.amountPaid ?? 0, totalAmount) : totalAmount;
    const paymentMethod = dto.paymentMethod ?? PaymentMethod.CASH;

    return this.prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({
        where: { id: { in: productIds }, organizationId: user.organizationId },
      });
      if (products.length !== new Set(productIds).size) {
        throw new BadRequestException("Один или несколько товаров не найдены");
      }

      const stockLevels = await tx.stockLevel.findMany({
        where: { locationId, productId: { in: productIds } },
      });
      const stockByProduct = new Map(stockLevels.map((s) => [s.productId, s.quantity.toNumber()]));

      for (const item of items) {
        const available = stockByProduct.get(item.productId) ?? 0;
        if (available < item.quantity) {
          const product = products.find((p) => p.id === item.productId);
          throw new BadRequestException(
            `Недостаточно товара «${product?.name ?? item.productId}» на складе точки`,
          );
        }
      }

      const sale = await tx.sale.create({
        data: {
          organizationId: user.organizationId,
          locationId,
          customerId: dto.customerId,
          totalAmount,
          amountPaid,
          paymentMethod,
          createdById: user.id,
          items: { create: items },
        },
        include: SALE_DETAIL_INCLUDE,
      });

      if (amountPaid > 0) {
        const accountId = await this.resolveSaleAccountId(tx, user.organizationId, locationId, paymentMethod);
        if (accountId) {
          await this.cashMovementsService.recordMovement(tx, {
            organizationId: user.organizationId,
            accountId,
            type: CashMovementType.SALE_RECEIPT,
            amount: amountPaid,
            customerId: dto.customerId,
            saleId: sale.id,
            reason: "Продажа",
            createdById: user.id,
          });
        }
      }

      for (const item of items) {
        await tx.stockLevel.update({
          where: { locationId_productId: { locationId, productId: item.productId } },
          data: { quantity: { decrement: item.quantity } },
        });
      }

      await tx.stockMovement.createMany({
        data: items.map((item) => ({
          organizationId: user.organizationId,
          locationId,
          productId: item.productId,
          type: StockMovementType.SALE,
          quantity: item.quantity,
          reason: "Продажа",
          saleId: sale.id,
          createdById: user.id,
        })),
      });

      return this.toSaleDetailDto(sale);
    });
  }

  async recordPayment(user: AuthenticatedUser, saleId: string, dto: RecordPaymentDto): Promise<SaleDetailDto> {
    const sale = await this.prisma.sale.findFirst({
      where: { id: saleId, organizationId: user.organizationId },
    });
    if (!sale) {
      throw new NotFoundException("Продажа не найдена");
    }
    resolveLocationScope(user, sale.locationId);

    const balanceDue = sale.totalAmount.toNumber() - sale.amountPaid.toNumber();
    if (dto.amount > balanceDue) {
      throw new BadRequestException("Сумма оплаты превышает остаток задолженности");
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const accountId =
        dto.accountId ??
        (await this.resolveSaleAccountId(
          tx,
          user.organizationId,
          sale.locationId,
          sale.paymentMethod as PaymentMethod,
        ));
      if (accountId) {
        await this.cashMovementsService.recordMovement(tx, {
          organizationId: user.organizationId,
          accountId,
          type: CashMovementType.CUSTOMER_PAYMENT,
          amount: dto.amount,
          customerId: sale.customerId ?? undefined,
          saleId: sale.id,
          reason: "Погашение долга по продаже",
          createdById: user.id,
        });
      }
      return tx.sale.update({
        where: { id: saleId },
        data: { amountPaid: { increment: dto.amount } },
        include: SALE_DETAIL_INCLUDE,
      });
    });

    return this.toSaleDetailDto(updated);
  }

  private toSaleDto = (sale: {
    id: string;
    locationId: string;
    location: { name: string };
    customerId: string | null;
    customer: { name: string } | null;
    soldAt: Date;
    totalAmount: { toNumber: () => number };
    amountPaid: { toNumber: () => number };
    paymentMethod: string;
    createdBy: { fullName: string };
    items: unknown[];
  }): SaleDto => {
    const totalAmount = sale.totalAmount.toNumber();
    const amountPaid = sale.amountPaid.toNumber();
    const balanceDue = totalAmount - amountPaid;

    return {
      id: sale.id,
      locationId: sale.locationId,
      locationName: sale.location.name,
      customerId: sale.customerId,
      customerName: sale.customer?.name ?? null,
      soldAt: sale.soldAt.toISOString(),
      totalAmount,
      amountPaid,
      balanceDue,
      paymentStatus:
        balanceDue <= 0 ? PaymentStatus.PAID : amountPaid > 0 ? PaymentStatus.PARTIALLY_PAID : PaymentStatus.UNPAID,
      paymentMethod: sale.paymentMethod as PaymentMethod,
      itemsCount: sale.items.length,
      createdByName: sale.createdBy.fullName,
    };
  };

  private toSaleDetailDto = (sale: {
    id: string;
    locationId: string;
    location: { name: string };
    customerId: string | null;
    customer: { name: string } | null;
    soldAt: Date;
    totalAmount: { toNumber: () => number };
    amountPaid: { toNumber: () => number };
    paymentMethod: string;
    createdBy: { fullName: string };
    items: {
      id: string;
      productId: string;
      product: { name: string };
      quantity: { toNumber: () => number };
      unitPrice: { toNumber: () => number };
      subtotal: { toNumber: () => number };
    }[];
  }): SaleDetailDto => ({
    ...this.toSaleDto(sale),
    items: sale.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.product.name,
      quantity: item.quantity.toNumber(),
      unitPrice: item.unitPrice.toNumber(),
      subtotal: item.subtotal.toNumber(),
    })),
  });
}
