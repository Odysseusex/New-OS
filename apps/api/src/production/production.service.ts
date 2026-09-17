import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  BusinessContextProductionDto,
  BusinessContextProductionRowDto,
  ProductionBatchDto,
  ProductionBatchStatus,
  ProductionCancelReason,
  Unit,
} from "@bakery-os/shared";
import { ProductionBatchStatus as PrismaProductionBatchStatus, StockMovementType } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { requireLocationScope, resolveLocationScope } from "../common/location-scope";
import { CreateBatchDto } from "./dto/create-batch.dto";
import { UpdateBatchDto } from "./dto/update-batch.dto";
import { CancelBatchDto } from "./dto/cancel-batch.dto";
import { CompleteBatchDto } from "./dto/complete-batch.dto";

@Injectable()
export class ProductionService {
  constructor(private prisma: PrismaService) {}

  // Production per product over a period — what the batch list cannot answer
  // because it is one row per batch.
  //
  // A batch belongs to the period by `scheduledFor`, which every batch has
  // from the moment it is planned. Using completedAt instead would make a
  // batch appear only once finished, so a period with work still in progress
  // would report nothing planned — the opposite of what production planning
  // needs to see.
  //
  // `varianceQuantity` is actual − planned over COMPLETED batches only: an
  // unfinished batch has no actual yet, and averaging it in as zero would
  // read as a total failure to produce. This is production variance, NOT
  // waste — goods written off later are a separate event that this system
  // does not link back to the batch they came from (see QualityService).
  async summaryByProduct(
    user: AuthenticatedUser,
    from: Date,
    to: Date,
    requestedLocationId?: string,
  ): Promise<BusinessContextProductionDto> {
    const locationId = resolveLocationScope(user, requestedLocationId);

    // One query with a join, not a query per batch: the product a batch makes
    // is reachable only through its recipe.
    const batches = await this.prisma.productionBatch.findMany({
      where: {
        organizationId: user.organizationId,
        scheduledFor: { gte: from, lte: to },
        ...(locationId ? { locationId } : {}),
      },
      select: {
        status: true,
        plannedQuantity: true,
        actualQuantity: true,
        recipe: { select: { product: { select: { id: true, name: true, unit: true } } } },
      },
    });

    const acc = new Map<string, BusinessContextProductionRowDto>();
    let unitsPlanned = 0;
    let unitsProduced = 0;

    for (const batch of batches) {
      const product = batch.recipe.product;
      const row =
        acc.get(product.id) ??
        ({
          productId: product.id,
          productName: product.name,
          unit: product.unit as Unit,
          batchesPlanned: 0,
          batchesInProgress: 0,
          batchesCompleted: 0,
          batchesCancelled: 0,
          plannedQuantity: 0,
          actualQuantity: 0,
          varianceQuantity: 0,
          variancePercent: null,
        } satisfies BusinessContextProductionRowDto);

      const planned = batch.plannedQuantity.toNumber();
      row.plannedQuantity += planned;
      unitsPlanned += planned;

      if (batch.status === PrismaProductionBatchStatus.PLANNED) row.batchesPlanned += 1;
      if (batch.status === PrismaProductionBatchStatus.IN_PROGRESS) row.batchesInProgress += 1;
      if (batch.status === PrismaProductionBatchStatus.CANCELLED) row.batchesCancelled += 1;
      if (batch.status === PrismaProductionBatchStatus.COMPLETED) {
        row.batchesCompleted += 1;
        const actual = batch.actualQuantity?.toNumber() ?? 0;
        row.actualQuantity += actual;
        row.varianceQuantity += actual - planned;
        unitsProduced += actual;
      }

      acc.set(product.id, row);
    }

    const round = (value: number) => Number(value.toFixed(3));
    const byProduct = Array.from(acc.values())
      .map((row) => {
        // Measured against the planned quantity of COMPLETED batches only,
        // which is the only planned figure the actual can be compared to.
        const completedPlanned = row.batchesCompleted > 0 ? row.actualQuantity - row.varianceQuantity : 0;
        return {
          ...row,
          plannedQuantity: round(row.plannedQuantity),
          actualQuantity: round(row.actualQuantity),
          varianceQuantity: round(row.varianceQuantity),
          variancePercent:
            completedPlanned > 0 ? Number(((row.varianceQuantity / completedPlanned) * 100).toFixed(2)) : null,
        };
      })
      .sort((a, b) => b.actualQuantity - a.actualQuantity);

    return {
      batchesTotal: batches.length,
      unitsPlanned: round(unitsPlanned),
      unitsProduced: round(unitsProduced),
      byProduct,
    };
  }

  async findAll(user: AuthenticatedUser, requestedLocationId?: string): Promise<ProductionBatchDto[]> {
    const locationId = resolveLocationScope(user, requestedLocationId);

    const batches = await this.prisma.productionBatch.findMany({
      where: {
        organizationId: user.organizationId,
        ...(locationId ? { locationId } : {}),
      },
      include: { location: true, recipe: { include: { product: true } }, createdBy: true },
      orderBy: { scheduledFor: "desc" },
      take: 100,
    });

    return batches.map(this.toDto);
  }

  async create(user: AuthenticatedUser, dto: CreateBatchDto): Promise<ProductionBatchDto> {
    const locationId = requireLocationScope(user, dto.locationId);

    const recipe = await this.prisma.recipe.findFirst({
      where: { id: dto.recipeId, organizationId: user.organizationId },
    });
    if (!recipe) {
      throw new NotFoundException("Рецептура не найдена");
    }

    const batch = await this.prisma.productionBatch.create({
      data: {
        organizationId: user.organizationId,
        locationId,
        recipeId: dto.recipeId,
        plannedQuantity: dto.plannedQuantity,
        scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : undefined,
        createdById: user.id,
      },
      include: { location: true, recipe: { include: { product: true } }, createdBy: true },
    });

    return this.toDto(batch);
  }

  // Only while PLANNED — once production has started (IN_PROGRESS), the
  // schedule/quantity that were fixed at start time are what actually
  // happened, not a plan to be edited.
  async update(user: AuthenticatedUser, batchId: string, dto: UpdateBatchDto): Promise<ProductionBatchDto> {
    const batch = await this.prisma.productionBatch.findFirst({
      where: { id: batchId, organizationId: user.organizationId },
    });
    if (!batch) {
      throw new NotFoundException("Задание не найдено");
    }
    this.assertLocationAccess(user, batch.locationId);
    if (batch.status !== PrismaProductionBatchStatus.PLANNED) {
      throw new BadRequestException("Редактировать можно только запланированные задания");
    }

    const updated = await this.prisma.productionBatch.update({
      where: { id: batchId },
      data: {
        ...(dto.scheduledFor !== undefined ? { scheduledFor: new Date(dto.scheduledFor) } : {}),
        ...(dto.plannedQuantity !== undefined ? { plannedQuantity: dto.plannedQuantity } : {}),
      },
      include: { location: true, recipe: { include: { product: true } }, createdBy: true },
    });

    return this.toDto(updated);
  }

  // Deletion is only allowed before production has started — a PLANNED
  // batch has no stock impact yet, so removing it is safe. Once IN_PROGRESS
  // or later, use cancel/abort instead so the history is preserved.
  async remove(user: AuthenticatedUser, batchId: string): Promise<{ deleted: true }> {
    const batch = await this.prisma.productionBatch.findFirst({
      where: { id: batchId, organizationId: user.organizationId },
    });
    if (!batch) {
      throw new NotFoundException("Задание не найдено");
    }
    this.assertLocationAccess(user, batch.locationId);
    if (batch.status !== PrismaProductionBatchStatus.PLANNED) {
      throw new BadRequestException("Удалить можно только запланированное задание, которое ещё не запущено");
    }

    await this.prisma.productionBatch.delete({ where: { id: batchId } });
    return { deleted: true };
  }

  async start(user: AuthenticatedUser, batchId: string): Promise<ProductionBatchDto> {
    const batch = await this.prisma.productionBatch.findFirst({
      where: { id: batchId, organizationId: user.organizationId },
    });
    if (!batch) {
      throw new NotFoundException("Задание не найдено");
    }
    this.assertLocationAccess(user, batch.locationId);
    if (batch.status !== PrismaProductionBatchStatus.PLANNED) {
      throw new BadRequestException("Начать можно только запланированное задание");
    }

    const updated = await this.prisma.productionBatch.update({
      where: { id: batchId },
      data: { status: PrismaProductionBatchStatus.IN_PROGRESS, startedAt: new Date() },
      include: { location: true, recipe: { include: { product: true } }, createdBy: true },
    });

    return this.toDto(updated);
  }

  async complete(user: AuthenticatedUser, batchId: string, dto: CompleteBatchDto): Promise<ProductionBatchDto> {
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.productionBatch.findFirst({
        where: { id: batchId, organizationId: user.organizationId },
        include: { recipe: { include: { items: { include: { ingredientProduct: true } }, product: true } } },
      });
      if (!batch) {
        throw new NotFoundException("Задание не найдено");
      }
      this.assertLocationAccess(user, batch.locationId);
      if (batch.status === PrismaProductionBatchStatus.PLANNED) {
        throw new BadRequestException("Сначала запустите задание («Начать производство»), затем завершите его");
      }
      if (batch.status !== PrismaProductionBatchStatus.IN_PROGRESS) {
        throw new BadRequestException("Задание уже обработано");
      }

      const scale = dto.actualQuantity / batch.recipe.yieldQuantity.toNumber();

      // Ingredients with trackInventory=false (e.g. tap water) aren't
      // received or held as stock, so they're excluded from the
      // insufficient-stock check and don't get a consumption movement —
      // they still priced into the recipe's cost via recipes.service.ts.
      const trackedItems = batch.recipe.items.filter((item) => item.ingredientProduct.trackInventory);

      for (const item of trackedItems) {
        const requiredQuantity = item.quantity.toNumber() * scale;
        const stockLevel = await tx.stockLevel.findUnique({
          where: { locationId_productId: { locationId: batch.locationId, productId: item.ingredientProductId } },
        });
        if (!stockLevel || stockLevel.quantity.toNumber() < requiredQuantity) {
          throw new BadRequestException(
            `Недостаточно ингредиента «${item.ingredientProduct.name}» на точке для этого объёма`,
          );
        }
      }

      for (const item of trackedItems) {
        const requiredQuantity = item.quantity.toNumber() * scale;
        await tx.stockLevel.update({
          where: { locationId_productId: { locationId: batch.locationId, productId: item.ingredientProductId } },
          data: { quantity: { decrement: requiredQuantity } },
        });
      }

      if (trackedItems.length > 0) {
        await tx.stockMovement.createMany({
          data: trackedItems.map((item) => ({
            organizationId: user.organizationId,
            locationId: batch.locationId,
            productId: item.ingredientProductId,
            type: StockMovementType.PRODUCTION_CONSUMPTION,
            quantity: item.quantity.toNumber() * scale,
            reason: "Расход на производственное задание",
            batchId: batch.id,
            createdById: user.id,
          })),
        });
      }

      await tx.stockLevel.upsert({
        where: { locationId_productId: { locationId: batch.locationId, productId: batch.recipe.productId } },
        update: { quantity: { increment: dto.actualQuantity } },
        create: {
          organizationId: user.organizationId,
          locationId: batch.locationId,
          productId: batch.recipe.productId,
          quantity: dto.actualQuantity,
          minQuantity: batch.recipe.product.minQuantity,
        },
      });

      await tx.stockMovement.create({
        data: {
          organizationId: user.organizationId,
          locationId: batch.locationId,
          productId: batch.recipe.productId,
          type: StockMovementType.PRODUCTION_OUTPUT,
          quantity: dto.actualQuantity,
          reason: "Выпуск по производственному заданию",
          batchId: batch.id,
          createdById: user.id,
        },
      });

      const updated = await tx.productionBatch.update({
        where: { id: batch.id },
        data: {
          status: PrismaProductionBatchStatus.COMPLETED,
          actualQuantity: dto.actualQuantity,
          completedAt: new Date(),
        },
        include: { location: true, recipe: { include: { product: true } }, createdBy: true },
      });

      return this.toDto(updated);
    });
  }

  // Covers both "cancel a batch that never started" and "abort one that
  // did" — a reason is required for the latter (equipment/ingredient
  // problems are worth reporting on), optional for the former.
  async cancel(user: AuthenticatedUser, batchId: string, dto: CancelBatchDto): Promise<ProductionBatchDto> {
    const batch = await this.prisma.productionBatch.findFirst({
      where: { id: batchId, organizationId: user.organizationId },
    });
    if (!batch) {
      throw new NotFoundException("Задание не найдено");
    }
    this.assertLocationAccess(user, batch.locationId);
    if (
      batch.status !== PrismaProductionBatchStatus.PLANNED &&
      batch.status !== PrismaProductionBatchStatus.IN_PROGRESS
    ) {
      throw new BadRequestException("Задание уже обработано");
    }
    if (batch.status === PrismaProductionBatchStatus.IN_PROGRESS && !dto.reason) {
      throw new BadRequestException("Укажите причину прерывания производства");
    }

    const updated = await this.prisma.productionBatch.update({
      where: { id: batchId },
      data: {
        status: PrismaProductionBatchStatus.CANCELLED,
        cancelReason: dto.reason,
        cancelNote: dto.note,
      },
      include: { location: true, recipe: { include: { product: true } }, createdBy: true },
    });

    return this.toDto(updated);
  }

  private assertLocationAccess(user: AuthenticatedUser, locationId: string) {
    resolveLocationScope(user, locationId);
  }

  private toDto = (batch: {
    id: string;
    locationId: string;
    location: { name: string };
    recipeId: string;
    recipe: { productId: string; product: { name: string; unit: string } };
    status: string;
    plannedQuantity: { toNumber: () => number };
    actualQuantity: { toNumber: () => number } | null;
    scheduledFor: Date;
    startedAt: Date | null;
    completedAt: Date | null;
    cancelReason: string | null;
    cancelNote: string | null;
    createdBy: { fullName: string };
  }): ProductionBatchDto => ({
    id: batch.id,
    locationId: batch.locationId,
    locationName: batch.location.name,
    recipeId: batch.recipeId,
    productId: batch.recipe.productId,
    productName: batch.recipe.product.name,
    unit: batch.recipe.product.unit as Unit,
    status: batch.status as ProductionBatchStatus,
    plannedQuantity: batch.plannedQuantity.toNumber(),
    actualQuantity: batch.actualQuantity ? batch.actualQuantity.toNumber() : null,
    scheduledFor: batch.scheduledFor.toISOString(),
    startedAt: batch.startedAt ? batch.startedAt.toISOString() : null,
    completedAt: batch.completedAt ? batch.completedAt.toISOString() : null,
    cancelReason: batch.cancelReason as ProductionCancelReason | null,
    cancelNote: batch.cancelNote,
    createdByName: batch.createdBy.fullName,
  });
}
