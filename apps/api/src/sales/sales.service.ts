import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SaleDetailDto, SaleDto, SalesSummaryDto } from "@bakery-os/shared";
import { StockMovementType } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { requireLocationScope, resolveLocationScope } from "../common/location-scope";
import { CreateSaleDto } from "./dto/create-sale.dto";

@Injectable()
export class SalesService {
  constructor(private prisma: PrismaService) {}

  async findAll(user: AuthenticatedUser, requestedLocationId?: string, limit = 50): Promise<SaleDto[]> {
    const locationId = resolveLocationScope(user, requestedLocationId);

    const sales = await this.prisma.sale.findMany({
      where: {
        organizationId: user.organizationId,
        ...(locationId ? { locationId } : {}),
      },
      include: { location: true, createdBy: true, items: true },
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

  async create(user: AuthenticatedUser, dto: CreateSaleDto): Promise<SaleDetailDto> {
    const locationId = requireLocationScope(user, dto.locationId);

    const productIds = dto.items.map((i) => i.productId);
    const items = dto.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      subtotal: item.quantity * item.unitPrice,
    }));
    const totalAmount = items.reduce((sum, i) => sum + i.subtotal, 0);

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
          totalAmount,
          createdById: user.id,
          items: { create: items },
        },
        include: { location: true, createdBy: true, items: { include: { product: true } } },
      });

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

  private toSaleDto = (sale: {
    id: string;
    locationId: string;
    location: { name: string };
    soldAt: Date;
    totalAmount: { toNumber: () => number };
    createdBy: { fullName: string };
    items: unknown[];
  }): SaleDto => ({
    id: sale.id,
    locationId: sale.locationId,
    locationName: sale.location.name,
    soldAt: sale.soldAt.toISOString(),
    totalAmount: sale.totalAmount.toNumber(),
    itemsCount: sale.items.length,
    createdByName: sale.createdBy.fullName,
  });

  private toSaleDetailDto = (sale: {
    id: string;
    locationId: string;
    location: { name: string };
    soldAt: Date;
    totalAmount: { toNumber: () => number };
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
