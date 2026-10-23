import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { CostingService } from "../costing/costing.service";
import { PrismaService } from "../prisma/prisma.service";
import { CATEGORY_WITH_PARENT, categoryLabel } from "../common/category-label";
import {
  BusinessContextMovementRowDto,
  isStockLow,
  StockBatchResultDto,
  StockLevelDto,
  StockMovementDto,
  StockMovementType,
  Unit,
  WriteOffReason,
} from "@bakery-os/shared";
import { AuthenticatedUser } from "../auth/auth.types";
import { decrementStockOrThrow } from "../common/stock-guard";
import { requireLocationScope, resolveLocationScope } from "../common/location-scope";
import { ReceiveStockDto } from "./dto/receive-stock.dto";
import { WriteOffStockDto } from "./dto/write-off-stock.dto";
import { AdjustStockDto } from "./dto/adjust-stock.dto";
import { StockBatchLineDto } from "./dto/stock-batch.dto";
import { StockMovementType as PrismaStockMovementType } from "@prisma/client";
import { postLedgerSources } from "../ledger/event-posting";

// A batch of up to 100 lines is a few hundred round trips against a remote database.
const BATCH_TRANSACTION = { maxWait: 15_000, timeout: 120_000 };

const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

@Injectable()
export class InventoryService {
  constructor(
    private prisma: PrismaService,
    private costing: CostingService = new CostingService(prisma),
  ) {}

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
        // Annulled erroneous receipts/write-offs did not happen.
        voidLine: null,
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
      include: { location: true, product: { include: { categoryRef: CATEGORY_WITH_PARENT } } },
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
      categoryName: categoryLabel(level.product.categoryRef),
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
      include: { location: true, product: true, createdBy: true, voidLine: { select: { voidId: true } } },
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
      voided: m.voidLine !== null,
    }));
  }

  async receive(user: AuthenticatedUser, dto: ReceiveStockDto): Promise<StockMovementDto> {
    const locationId = requireLocationScope(user, dto.locationId);
    await this.assertTrackable(user.organizationId, dto.productId);
    const received = await this.prisma.product.findFirst({ where: { id: dto.productId, organizationId: user.organizationId }, select: { type: true } });
    if (received?.type === "SEMI_FINISHED") {
      throw new BadRequestException("Полуфабрикат появляется на складе только из производства — приход вручную невозможен");
    }
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
      insufficientMessage: "Недостаточно товара на складе для списания",
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
      // Only reachable if stock moved between reading it above and writing
      // the correction: the computed difference is stale, so recount.
      insufficientMessage: "Остаток изменился во время корректировки — обновите данные и повторите",
    });
  }

  // Several products in ONE document (Склад → Приёмка / Списание / Корректировка),
  // written all-or-nothing: one line that cannot go through (not enough stock, a
  // product that is not stocked) stops the whole document, naming the product.
  // The single-product paths above stay as they were (the Telegram bot uses them).
  async applyBatch(
    user: AuthenticatedUser,
    kind: "receive" | "write-off" | "adjustment",
    dto: { locationId?: string; reason?: string; writeOffReason?: WriteOffReason; lines: StockBatchLineDto[] },
  ): Promise<StockBatchResultDto> {
    const organizationId = user.organizationId;
    const locationId = requireLocationScope(user, dto.locationId);
    const ids = dto.lines.map((l) => l.productId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException("Один и тот же товар указан дважды — объедините строки");
    }
    if (kind !== "adjustment" && dto.lines.some((l) => !(l.quantity > 0))) {
      throw new BadRequestException("Количество должно быть больше нуля");
    }
    const location = await this.prisma.location.findFirst({ where: { id: locationId, organizationId }, select: { id: true } });
    if (!location) throw new NotFoundException("Точка не найдена");

    const products = await this.prisma.product.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true, name: true, trackInventory: true, type: true, minQuantity: true },
    });
    if (products.length !== ids.length) throw new NotFoundException("Товар не найден");
    const untracked = products.filter((p) => !p.trackInventory).map((p) => p.name);
    if (untracked.length > 0) {
      throw new BadRequestException(`Эти товары не учитываются на складе: ${untracked.join(", ")}`);
    }
    if (kind === "receive") {
      const semi = products.filter((p) => p.type === "SEMI_FINISHED").map((p) => p.name);
      if (semi.length > 0) {
        throw new BadRequestException(`Полуфабрикат появляется на складе только из производства — приход вручную невозможен: ${semi.join(", ")}`);
      }
    }
    const byId = new Map(products.map((p) => [p.id, p]));
    const type =
      kind === "receive"
        ? PrismaStockMovementType.RECEIPT
        : kind === "write-off"
          ? PrismaStockMovementType.WRITE_OFF
          : PrismaStockMovementType.ADJUSTMENT;

    return this.prisma.$transaction(async (tx) => {
      const unchanged: string[] = [];
      let lines: { productId: string; quantity: number; delta: number }[];
      if (kind === "adjustment") {
        // The count is the truth; the difference is computed against stock as it is
        // inside this transaction, and the decrement below re-checks it at the write.
        const levels = await tx.stockLevel.findMany({ where: { locationId, productId: { in: ids } }, select: { productId: true, quantity: true } });
        const current = new Map(levels.map((l) => [l.productId, l.quantity.toNumber()]));
        lines = [];
        for (const line of dto.lines) {
          const delta = round3(line.quantity - (current.get(line.productId) ?? 0));
          if (delta === 0) unchanged.push(byId.get(line.productId)!.name);
          else lines.push({ productId: line.productId, quantity: delta, delta });
        }
        if (lines.length === 0) {
          throw new BadRequestException("Фактические остатки совпадают с системными — корректировка не требуется");
        }
      } else {
        lines = dto.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, delta: kind === "receive" ? l.quantity : -l.quantity }));
      }

      // Valued when it happens (see CostingService), one read for the whole document.
      const costs = await this.costing.snapshotCosts(organizationId, lines.map((l) => l.productId), tx);
      const movementIds: string[] = [];
      for (const line of lines) {
        const product = byId.get(line.productId)!;
        const created = await tx.stockMovement.create({
          data: {
            organizationId,
            locationId,
            productId: line.productId,
            type,
            quantity: line.quantity,
            reason: dto.reason?.trim() || (kind === "receive" ? "Поступление" : undefined),
            writeOffReason: kind === "write-off" ? dto.writeOffReason : undefined,
            createdById: user.id,
            ...this.costing.fields(costs.get(line.productId)),
          },
          select: { id: true },
        });
        movementIds.push(created.id);
        if (line.delta < 0) {
          await decrementStockOrThrow(
            tx,
            { locationId, productId: line.productId, quantity: -line.delta },
            kind === "adjustment"
              ? `Остаток изменился во время корректировки — обновите данные и повторите (${product.name})`
              : `Недостаточно товара на складе для списания: ${product.name}`,
          );
        } else {
          await tx.stockLevel.upsert({
            where: { locationId_productId: { locationId, productId: line.productId } },
            update: { quantity: { increment: line.delta } },
            create: { organizationId, locationId, productId: line.productId, quantity: line.delta, minQuantity: product.minQuantity },
          });
        }
      }
      // Write-offs and corrections change inventory value: journalised with the movements.
      await postLedgerSources(tx, { organizationId, actorId: user.id, scope: { stockMovementIds: movementIds } });
      return { created: movementIds.length, unchanged };
    }, BATCH_TRANSACTION);
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
      insufficientMessage?: string;
    },
  ): Promise<StockMovementDto> {
    const product = await this.prisma.product.findFirst({
      where: { id: params.productId, organizationId: user.organizationId },
    });
    if (!product) {
      throw new NotFoundException("Товар не найден");
    }

    const movement = await this.prisma.$transaction(async (tx) => {
      // Valued when it happens, so a write-off or count difference keeps the
      // cost it had that day (see CostingService).
      const costs = await this.costing.snapshotCosts(user.organizationId, [params.productId], tx);
      const created = await tx.stockMovement.create({
        data: {
          organizationId: user.organizationId,
          locationId: params.locationId,
          productId: params.productId,
          type: params.type,
          quantity: params.quantity,
          reason: params.reason,
          writeOffReason: params.writeOffReason,
          createdById: user.id,
          ...this.costing.fields(costs.get(params.productId)),
        },
        include: { location: true, product: true, createdBy: true },
      });

      if (params.delta < 0) {
        // Removing stock is conditional on it being there at the moment of
        // the write, not at the moment of the earlier read (see stock-guard).
        await decrementStockOrThrow(
          tx,
          { locationId: params.locationId, productId: params.productId, quantity: -params.delta },
          params.insufficientMessage ?? "Недостаточно товара на складе",
        );
      } else {
        await tx.stockLevel.upsert({
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
        });
      }
      // Write-offs and corrections change inventory value: journalised with the movement.
      await postLedgerSources(tx, { organizationId: user.organizationId, actorId: user.id, scope: { stockMovementIds: [created.id] } });
      return created;
    });

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
