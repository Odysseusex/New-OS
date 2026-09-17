import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  BusinessContextMovementRowDto,
  isStockLow,
  StockLevelDto,
  StockMovementDto,
  StockMovementType,
  Unit,
  WriteOffReason,
} from "@bakery-os/shared";
import { AuthenticatedUser } from "../auth/auth.types";
import { requireLocationScope, resolveLocationScope } from "../common/location-scope";
import { ReceiveStockDto } from "./dto/receive-stock.dto";
import { WriteOffStockDto } from "./dto/write-off-stock.dto";
import { AdjustStockDto } from "./dto/adjust-stock.dto";
import { StockMovementType as PrismaStockMovementType } from "@prisma/client";

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}

  // Every stock movement in a period, grouped by type — receipts, sales,
  // write-offs, production output and consumption, transfers, adjustments.
  //
  // A groupBy rather than reading the rows: this ledger is the busiest table
  // in the system (a row per sale line, per production input, per delivery),
  // and a month of it has no business being pulled into memory to be summed.
  //
  // Types are NOT netted against each other. RECEIPT and WRITE_OFF moving the
  // same product in opposite directions are different events, and the whole
  // point of reporting them separately is that "почему выросли списания"
  // cannot be answered from a net figure.
  async movementsSummary(
    user: AuthenticatedUser,
    from: Date,
    to: Date,
    requestedLocationId?: string,
  ): Promise<BusinessContextMovementRowDto[]> {
    const locationId = resolveLocationScope(user, requestedLocationId);

    const grouped = await this.prisma.stockMovement.groupBy({
      by: ["type"],
      where: {
        organizationId: user.organizationId,
        createdAt: { gte: from, lte: to },
        ...(locationId ? { locationId } : {}),
      },
      _sum: { quantity: true },
      _count: { _all: true },
    });

    return grouped
      .map((row) => ({
        type: row.type as StockMovementType,
        // A MAGNITUDE, not a signed delta — because that is how the ledger
        // stores it. receive() and writeOff() both persist a positive
        // quantity and carry the direction in `type`; only ADJUSTMENT stores
        // a signed value, since a correction can go either way. So a
        // WRITE_OFF total of 19 means 19 units left, not 19 units arrived,
        // and the reader has to know the type to know the direction.
        totalQuantity: Number((row._sum.quantity?.toNumber() ?? 0).toFixed(3)),
        movementCount: row._count._all,
      }))
      .sort((a, b) => b.movementCount - a.movementCount);
  }

  async getStockLevels(user: AuthenticatedUser, requestedLocationId?: string): Promise<StockLevelDto[]> {
    const locationId = resolveLocationScope(user, requestedLocationId);

    const levels = await this.prisma.stockLevel.findMany({
      where: {
        organizationId: user.organizationId,
        ...(locationId ? { locationId } : {}),
        product: { trackInventory: true },
      },
      include: { location: true, product: { include: { categoryRef: true } } },
      orderBy: [{ location: { name: "asc" } }, { product: { name: "asc" } }],
    });

    return levels.map((level) => ({
      id: level.id,
      locationId: level.locationId,
      locationName: level.location.name,
      productId: level.productId,
      productName: level.product.name,
      sku: level.product.sku,
      unit: level.product.unit as Unit,
      categoryName: level.product.categoryRef?.name ?? null,
      quantity: level.quantity.toNumber(),
      minQuantity: level.minQuantity.toNumber(),
      isLow: isStockLow(level.quantity.toNumber(), level.minQuantity.toNumber()),
    }));
  }

  async getMovements(
    user: AuthenticatedUser,
    requestedLocationId?: string,
    limit = 50,
  ): Promise<StockMovementDto[]> {
    const locationId = resolveLocationScope(user, requestedLocationId);

    const movements = await this.prisma.stockMovement.findMany({
      where: {
        organizationId: user.organizationId,
        ...(locationId ? { locationId } : {}),
      },
      include: { location: true, product: true, createdBy: true },
      orderBy: { createdAt: "desc" },
      take: limit,
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

  async receive(user: AuthenticatedUser, dto: ReceiveStockDto): Promise<StockMovementDto> {
    const locationId = requireLocationScope(user, dto.locationId);
    await this.assertTrackable(user.organizationId, dto.productId);
    return this.applyMovement(user, {
      locationId,
      productId: dto.productId,
      quantity: dto.quantity,
      reason: dto.reason ?? "Поступление",
      type: PrismaStockMovementType.RECEIPT,
      delta: dto.quantity,
    });
  }

  async writeOff(user: AuthenticatedUser, dto: WriteOffStockDto): Promise<StockMovementDto> {
    const locationId = requireLocationScope(user, dto.locationId);
    await this.assertTrackable(user.organizationId, dto.productId);

    const stockLevel = await this.prisma.stockLevel.findUnique({
      where: { locationId_productId: { locationId, productId: dto.productId } },
    });
    if (!stockLevel || stockLevel.quantity.toNumber() < dto.quantity) {
      throw new BadRequestException("Недостаточно товара на складе для списания");
    }

    return this.applyMovement(user, {
      locationId,
      productId: dto.productId,
      quantity: dto.quantity,
      reason: dto.reason,
      writeOffReason: dto.writeOffReason,
      type: PrismaStockMovementType.WRITE_OFF,
      delta: -dto.quantity,
    });
  }

  // actualQuantity is the true, physically-counted quantity — not a delta —
  // so a mistaken past receipt/write-off can be corrected by stating what's
  // really on the shelf. The difference is recorded as a signed ADJUSTMENT
  // movement rather than editing or deleting the movement that caused the
  // mistake, keeping the ledger append-only.
  async adjust(user: AuthenticatedUser, dto: AdjustStockDto): Promise<StockMovementDto> {
    const locationId = requireLocationScope(user, dto.locationId);
    await this.assertTrackable(user.organizationId, dto.productId);

    const stockLevel = await this.prisma.stockLevel.findUnique({
      where: { locationId_productId: { locationId, productId: dto.productId } },
    });
    const currentQuantity = stockLevel?.quantity.toNumber() ?? 0;
    const delta = dto.actualQuantity - currentQuantity;
    if (delta === 0) {
      throw new BadRequestException("Фактический остаток совпадает с текущим — корректировка не требуется");
    }

    return this.applyMovement(user, {
      locationId,
      productId: dto.productId,
      quantity: delta,
      reason: dto.reason,
      type: PrismaStockMovementType.ADJUSTMENT,
      delta,
    });
  }

  private async assertTrackable(organizationId: string, productId: string): Promise<void> {
    const product = await this.prisma.product.findFirst({ where: { id: productId, organizationId } });
    if (!product) {
      throw new NotFoundException("Товар не найден");
    }
    if (!product.trackInventory) {
      throw new BadRequestException("Этот товар не учитывается на складе — приход, списание и корректировка для него отключены");
    }
  }

  private async applyMovement(
    user: AuthenticatedUser,
    params: {
      locationId: string;
      productId: string;
      quantity: number;
      reason?: string;
      writeOffReason?: WriteOffReason;
      type: PrismaStockMovementType;
      delta: number;
    },
  ): Promise<StockMovementDto> {
    const product = await this.prisma.product.findFirst({
      where: { id: params.productId, organizationId: user.organizationId },
    });
    if (!product) {
      throw new NotFoundException("Товар не найден");
    }

    const [movement] = await this.prisma.$transaction([
      this.prisma.stockMovement.create({
        data: {
          organizationId: user.organizationId,
          locationId: params.locationId,
          productId: params.productId,
          type: params.type,
          quantity: params.quantity,
          reason: params.reason,
          writeOffReason: params.writeOffReason,
          createdById: user.id,
        },
        include: { location: true, product: true, createdBy: true },
      }),
      this.prisma.stockLevel.upsert({
        where: {
          locationId_productId: { locationId: params.locationId, productId: params.productId },
        },
        update: { quantity: { increment: params.delta } },
        create: {
          organizationId: user.organizationId,
          locationId: params.locationId,
          productId: params.productId,
          quantity: params.delta,
          minQuantity: product.minQuantity,
        },
      }),
    ]);

    return {
      id: movement.id,
      locationId: movement.locationId,
      locationName: movement.location.name,
      productId: movement.productId,
      productName: movement.product.name,
      unit: movement.product.unit as Unit,
      type: movement.type as StockMovementType,
      quantity: movement.quantity.toNumber(),
      reason: movement.reason,
      writeOffReason: movement.writeOffReason as WriteOffReason | null,
      createdByName: movement.createdBy.fullName,
      createdAt: movement.createdAt.toISOString(),
    };
  }
}
