import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { QualitySummaryDto, StockMovementDto, StockMovementType, Unit, WriteOffReason } from "@bakery-os/shared";
import { StockMovementType as PrismaStockMovementType } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { resolveLocationScope } from "../common/location-scope";

@Injectable()
export class QualityService {
  constructor(private prisma: PrismaService) {}

  async findWriteOffs(
    user: AuthenticatedUser,
    requestedLocationId?: string,
    from?: Date,
    to?: Date,
  ): Promise<StockMovementDto[]> {
    const locationId = resolveLocationScope(user, requestedLocationId);

    const movements = await this.prisma.stockMovement.findMany({
      where: {
        organizationId: user.organizationId,
        type: PrismaStockMovementType.WRITE_OFF,
        ...(locationId ? { locationId } : {}),
        ...(from || to ? { createdAt: { gte: from, lte: to } } : {}),
      },
      include: { location: true, product: true, createdBy: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return movements.map((m) => ({
      id: m.id,
      locationId: m.locationId,
      locationName: m.location.name,
      productId: m.productId,
      productName: m.product.name,
      unit: m.product.unit as Unit,
      type: m.type as StockMovementType,
      quantity: m.quantity.toNumber(),
      reason: m.reason,
      writeOffReason: m.writeOffReason as WriteOffReason | null,
      createdByName: m.createdBy.fullName,
      createdAt: m.createdAt.toISOString(),
    }));
  }

  async getSummary(
    user: AuthenticatedUser,
    from: Date,
    to: Date,
    requestedLocationId?: string,
  ): Promise<QualitySummaryDto> {
    const locationId = resolveLocationScope(user, requestedLocationId);

    const movements = await this.prisma.stockMovement.findMany({
      where: {
        organizationId: user.organizationId,
        type: PrismaStockMovementType.WRITE_OFF,
        createdAt: { gte: from, lte: to },
        ...(locationId ? { locationId } : {}),
      },
      include: { product: true },
    });

    const byReasonMap = new Map<WriteOffReason, { quantity: number; value: number }>();
    const byProductMap = new Map<string, { productName: string; quantity: number; value: number }>();
    let totalValue = 0;

    for (const m of movements) {
      const quantity = m.quantity.toNumber();
      const value = quantity * m.product.price.toNumber();
      totalValue += value;

      const reason = (m.writeOffReason as WriteOffReason | null) ?? WriteOffReason.OTHER;
      const reasonEntry = byReasonMap.get(reason) ?? { quantity: 0, value: 0 };
      reasonEntry.quantity += quantity;
      reasonEntry.value += value;
      byReasonMap.set(reason, reasonEntry);

      const productEntry = byProductMap.get(m.productId) ?? {
        productName: m.product.name,
        quantity: 0,
        value: 0,
      };
      productEntry.quantity += quantity;
      productEntry.value += value;
      byProductMap.set(m.productId, productEntry);
    }

    const byReason = Array.from(byReasonMap.entries())
      .map(([reason, v]) => ({ reason, quantity: v.quantity, value: v.value }))
      .sort((a, b) => b.value - a.value);

    const byProduct = Array.from(byProductMap.entries())
      .map(([productId, v]) => ({ productId, productName: v.productName, quantity: v.quantity, value: v.value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      totalValue,
      totalMovements: movements.length,
      byReason,
      byProduct,
    };
  }
}
