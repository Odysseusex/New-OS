import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, StockMovementType, StocktakeStatus as PrismaStocktakeStatus } from "@prisma/client";
import {
  StocktakeDto,
  StocktakeLineDto,
  StocktakeStatus,
  StocktakeSummaryDto,
  Unit,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { requireLocationScope, resolveLocationScope } from "../common/location-scope";
import { decrementStockOrThrow } from "../common/stock-guard";
import { stockSignOf } from "../common/ledger-effects";
import { recordAudit } from "../audit/audit";
import { CostingService } from "../costing/costing.service";
import { CreateStocktakeDto, UpdateStocktakeLineDto } from "./dto/stocktake.dto";

const OPEN_STATUSES: PrismaStocktakeStatus[] = [PrismaStocktakeStatus.COUNTING, PrismaStocktakeStatus.REVIEW];

const STOCKTAKE_INCLUDE = {
  location: true,
  createdBy: true,
  approvedBy: true,
  lines: { include: { product: { include: { categoryRef: true } } } },
} satisfies Prisma.StocktakeInclude;

type StocktakeWithLines = Prisma.StocktakeGetPayload<{ include: typeof STOCKTAKE_INCLUDE }>;

const round3 = (v: number) => Number(v.toFixed(3));
const round2 = (v: number) => Number(v.toFixed(2));

@Injectable()
export class StocktakeService {
  constructor(
    private prisma: PrismaService,
    private costing: CostingService,
  ) {}

  async findAll(user: AuthenticatedUser, requestedLocationId?: string): Promise<StocktakeSummaryDto[]> {
    const locationId = resolveLocationScope(user, requestedLocationId);
    const rows = await this.prisma.stocktake.findMany({
      where: { organizationId: user.organizationId, ...(locationId ? { locationId } : {}) },
      include: STOCKTAKE_INCLUDE,
      orderBy: { snapshotAt: "desc" },
      take: 100,
    });
    return rows.map((r) => this.toSummary(r));
  }

  async findOne(user: AuthenticatedUser, id: string): Promise<StocktakeDto> {
    const row = await this.load(user, id);
    return this.toDto(row);
  }

  // Snapshot: one line per stock-tracked product that is active or still has
  // stock at the location. The snapshot is read from StockLevel inside the
  // same transaction that creates the document.
  async create(user: AuthenticatedUser, dto: CreateStocktakeDto): Promise<StocktakeDto> {
    const locationId = requireLocationScope(user, dto.locationId);
    const location = await this.prisma.location.findFirst({ where: { id: locationId, organizationId: user.organizationId } });
    if (!location) throw new NotFoundException("Точка не найдена");

    const created = await this.prisma.$transaction(async (tx) => {
      const open = await tx.stocktake.findFirst({
        where: { organizationId: user.organizationId, locationId, status: { in: OPEN_STATUSES } },
      });
      if (open) {
        throw new ConflictException("На этой точке уже идёт инвентаризация — завершите или отмените её");
      }

      const [levels, products] = await Promise.all([
        tx.stockLevel.findMany({ where: { organizationId: user.organizationId, locationId } }),
        tx.product.findMany({
          where: {
            organizationId: user.organizationId,
            trackInventory: true,
            ...(dto.categoryId ? { categoryId: dto.categoryId } : {}),
          },
          select: { id: true, isActive: true },
        }),
      ]);
      const levelByProduct = new Map(levels.map((l) => [l.productId, l.quantity]));
      const included = products.filter(
        (p) => p.isActive || (levelByProduct.get(p.id)?.toNumber() ?? 0) !== 0,
      );
      if (included.length === 0) {
        throw new BadRequestException("Нет товаров для инвентаризации на этой точке");
      }

      const stocktake = await tx.stocktake.create({
        data: {
          organizationId: user.organizationId,
          locationId,
          note: dto.note?.trim() || null,
          createdById: user.id,
          lines: {
            create: included.map((p) => ({
              productId: p.id,
              systemQuantity: levelByProduct.get(p.id) ?? 0,
            })),
          },
        },
      });
      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "stocktake.create",
        entityType: "Stocktake",
        entityId: stocktake.id,
        after: { locationId, lineCount: included.length, categoryId: dto.categoryId ?? null },
      });
      return stocktake;
    });

    return this.findOne(user, created.id);
  }

  async updateLine(
    user: AuthenticatedUser,
    id: string,
    lineId: string,
    dto: UpdateStocktakeLineDto,
  ): Promise<StocktakeLineDto> {
    const stocktake = await this.load(user, id);
    if (stocktake.status !== PrismaStocktakeStatus.COUNTING) {
      throw new BadRequestException("Изменять количество можно только во время подсчёта");
    }
    const line = stocktake.lines.find((l) => l.id === lineId);
    if (!line) throw new NotFoundException("Позиция не найдена");
    if (dto.countedQuantity !== null && dto.countedQuantity !== undefined && dto.countedQuantity < 0) {
      throw new BadRequestException("Количество не может быть отрицательным");
    }

    const updated = await this.prisma.stocktakeLine.update({
      where: { id: lineId },
      data: {
        ...(dto.countedQuantity !== undefined ? { countedQuantity: dto.countedQuantity } : {}),
        ...(dto.note !== undefined ? { note: dto.note?.trim() || null } : {}),
      },
      include: { product: { include: { categoryRef: true } } },
    });
    const costs = await this.costing.currentUnitCosts(user.organizationId);
    return this.toLineDto(updated, costs.get(updated.productId)?.unitCost ?? null);
  }

  async submit(user: AuthenticatedUser, id: string): Promise<StocktakeDto> {
    const stocktake = await this.load(user, id);
    if (!stocktake.lines.some((l) => l.countedQuantity !== null)) {
      throw new BadRequestException("Не посчитано ни одной позиции");
    }
    await this.transition(user, stocktake, PrismaStocktakeStatus.COUNTING, PrismaStocktakeStatus.REVIEW, "stocktake.submit", {
      submittedAt: new Date(),
    });
    return this.findOne(user, id);
  }

  // Back from review to counting — for a recount the reviewer asked for.
  async reopen(user: AuthenticatedUser, id: string): Promise<StocktakeDto> {
    const stocktake = await this.load(user, id);
    await this.transition(user, stocktake, PrismaStocktakeStatus.REVIEW, PrismaStocktakeStatus.COUNTING, "stocktake.reopen", {
      submittedAt: null,
    });
    return this.findOne(user, id);
  }

  async cancel(user: AuthenticatedUser, id: string, reason: string): Promise<StocktakeDto> {
    const stocktake = await this.load(user, id);
    if (!OPEN_STATUSES.includes(stocktake.status)) {
      throw new BadRequestException("Инвентаризация уже завершена");
    }
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.stocktake.updateMany({
        where: { id, status: { in: OPEN_STATUSES } },
        data: { status: PrismaStocktakeStatus.CANCELLED, cancelledAt: new Date(), cancelReason: reason },
      });
      if (result.count !== 1) throw new ConflictException("Инвентаризация уже изменена другим пользователем");
      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "stocktake.cancel",
        entityType: "Stocktake",
        entityId: id,
        before: { status: stocktake.status },
        after: { status: PrismaStocktakeStatus.CANCELLED },
        reason,
      });
    });
    return this.findOne(user, id);
  }

  // Writes one ADJUSTMENT per counted line whose count differs from the
  // snapshot. The status flip is a conditional UPDATE, so a double-click (or
  // two approvers) cannot apply the same count twice.
  async approve(user: AuthenticatedUser, id: string): Promise<StocktakeDto> {
    const stocktake = await this.load(user, id);
    if (stocktake.status !== PrismaStocktakeStatus.REVIEW) {
      throw new BadRequestException("Провести можно только инвентаризацию на проверке");
    }

    await this.prisma.$transaction(async (tx) => {
      const flipped = await tx.stocktake.updateMany({
        where: { id, status: PrismaStocktakeStatus.REVIEW },
        data: { status: PrismaStocktakeStatus.APPROVED, approvedAt: new Date(), approvedById: user.id },
      });
      if (flipped.count !== 1) throw new ConflictException("Инвентаризация уже проведена или изменена");

      const costs = await this.costing.currentUnitCosts(user.organizationId, tx);
      let shortageValue = 0;
      let surplusValue = 0;
      let adjustedLines = 0;

      for (const line of stocktake.lines) {
        if (line.countedQuantity === null) continue;
        const difference = round3(line.countedQuantity.toNumber() - line.systemQuantity.toNumber());
        if (difference === 0) continue;

        const cost = costs.get(line.productId) ?? null;
        const movement = await tx.stockMovement.create({
          data: {
            organizationId: user.organizationId,
            locationId: stocktake.locationId,
            productId: line.productId,
            type: StockMovementType.ADJUSTMENT,
            quantity: difference,
            reason: "Инвентаризация",
            stocktakeId: id,
            createdById: user.id,
            ...this.costFields(cost),
          },
        });

        if (difference > 0) {
          await tx.stockLevel.upsert({
            where: { locationId_productId: { locationId: stocktake.locationId, productId: line.productId } },
            update: { quantity: { increment: difference } },
            create: {
              organizationId: user.organizationId,
              locationId: stocktake.locationId,
              productId: line.productId,
              quantity: difference,
              minQuantity: line.product.minQuantity,
            },
          });
          surplusValue += cost ? difference * cost.unitCost : 0;
        } else {
          await decrementStockOrThrow(
            tx,
            { locationId: stocktake.locationId, productId: line.productId, quantity: -difference },
            `«${line.product.name}»: остаток стал меньше недостачи — пересчитайте позицию`,
          );
          shortageValue += cost ? -difference * cost.unitCost : 0;
        }
        await tx.stocktakeLine.update({ where: { id: line.id }, data: { movementId: movement.id } });
        adjustedLines += 1;
      }

      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "stocktake.approve",
        entityType: "Stocktake",
        entityId: id,
        before: { status: PrismaStocktakeStatus.REVIEW },
        after: {
          status: PrismaStocktakeStatus.APPROVED,
          adjustedLines,
          shortageValue: round2(shortageValue),
          surplusValue: round2(surplusValue),
        },
      });
    });

    return this.findOne(user, id);
  }

  // Overridden in Phase 3 once movements carry a cost snapshot.
  protected costFields(_cost: { unitCost: number } | null): Record<string, unknown> {
    return {};
  }

  private async transition(
    user: AuthenticatedUser,
    stocktake: StocktakeWithLines,
    from: PrismaStocktakeStatus,
    to: PrismaStocktakeStatus,
    action: "stocktake.submit" | "stocktake.reopen",
    extra: Prisma.StocktakeUpdateManyMutationInput,
  ) {
    if (stocktake.status !== from) {
      throw new BadRequestException("Инвентаризация сейчас в другом статусе");
    }
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.stocktake.updateMany({ where: { id: stocktake.id, status: from }, data: { status: to, ...extra } });
      if (result.count !== 1) throw new ConflictException("Инвентаризация уже изменена другим пользователем");
      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action,
        entityType: "Stocktake",
        entityId: stocktake.id,
        before: { status: from },
        after: { status: to },
      });
    });
  }

  private async load(user: AuthenticatedUser, id: string): Promise<StocktakeWithLines> {
    const row = await this.prisma.stocktake.findFirst({
      where: { id, organizationId: user.organizationId },
      include: STOCKTAKE_INCLUDE,
    });
    if (!row) throw new NotFoundException("Инвентаризация не найдена");
    resolveLocationScope(user, row.locationId);
    return row;
  }

  private async toDto(row: StocktakeWithLines): Promise<StocktakeDto> {
    const [costs, drift] = await Promise.all([
      this.costing.currentUnitCosts(row.organizationId),
      this.snapshotDrift(row),
    ]);
    const lines = row.lines
      .map((l) => this.toLineDto(l, costs.get(l.productId)?.unitCost ?? null))
      .sort((a, b) => (a.categoryName ?? "").localeCompare(b.categoryName ?? "") || a.productName.localeCompare(b.productName));
    let shortageValue = 0;
    let surplusValue = 0;
    for (const l of lines) {
      if (l.differenceValue === null) continue;
      if (l.differenceValue < 0) shortageValue += -l.differenceValue;
      else surplusValue += l.differenceValue;
    }
    return {
      ...this.toSummary(row),
      lines,
      shortageValue: round2(shortageValue),
      surplusValue: round2(surplusValue),
      snapshotDriftCount: drift,
    };
  }

  // How many snapshot lines disagree with the movement ledger as of the
  // snapshot moment (see ledger-effects: return-scrap markers count as zero).
  private async snapshotDrift(row: StocktakeWithLines): Promise<number> {
    const groups = await this.prisma.stockMovement.groupBy({
      by: ["productId", "type"],
      where: {
        organizationId: row.organizationId,
        locationId: row.locationId,
        createdAt: { lte: row.snapshotAt },
        NOT: { type: StockMovementType.WRITE_OFF, saleReturnId: { not: null } },
      },
      _sum: { quantity: true },
    });
    const ledger = new Map<string, number>();
    for (const g of groups) {
      const sign = stockSignOf(g.type);
      const q = g._sum.quantity?.toNumber() ?? 0;
      const delta = sign === "SIGNED" ? q : (sign as number) * q;
      ledger.set(g.productId, (ledger.get(g.productId) ?? 0) + delta);
    }
    return row.lines.filter((l) => round3(ledger.get(l.productId) ?? 0) !== round3(l.systemQuantity.toNumber())).length;
  }

  private toSummary(row: StocktakeWithLines): StocktakeSummaryDto {
    return {
      id: row.id,
      locationId: row.locationId,
      locationName: row.location.name,
      status: row.status as StocktakeStatus,
      note: row.note,
      snapshotAt: row.snapshotAt.toISOString(),
      createdByName: row.createdBy.fullName,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      approvedByName: row.approvedBy?.fullName ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      cancelReason: row.cancelReason,
      lineCount: row.lines.length,
      countedCount: row.lines.filter((l) => l.countedQuantity !== null).length,
    };
  }

  private toLineDto(
    line: StocktakeWithLines["lines"][number],
    unitCost: number | null,
  ): StocktakeLineDto {
    const systemQuantity = line.systemQuantity.toNumber();
    const countedQuantity = line.countedQuantity?.toNumber() ?? null;
    const difference = countedQuantity === null ? null : round3(countedQuantity - systemQuantity);
    return {
      id: line.id,
      productId: line.productId,
      productName: line.product.name,
      sku: line.product.sku,
      unit: line.product.unit as Unit,
      categoryName: line.product.categoryRef?.name ?? null,
      systemQuantity,
      countedQuantity,
      difference,
      unitCost,
      differenceValue: difference === null || unitCost === null ? null : round2(difference * unitCost),
      note: line.note,
      movementId: line.movementId,
    };
  }
}
