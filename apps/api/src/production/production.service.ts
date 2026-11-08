import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { lockProductRows } from "../common/product-lock";
import {
  BusinessContextProductionDto,
  BusinessContextProductionRowDto,
  ProductionBatchDto,
  ProductionBatchNormDto,
  ProductionBatchDocumentDto,
  ProductionBatchStatus,
  ProductionDeviationByIngredientDto,
  ProductionDeviationLineDto,
  ProductionDeviationReportDto,
  ProductionOutputReportDto,
  ProductionOutputRowDto,
  ProductionUnitCostTrendDto,
  ProductionReleasePreviewDto,
  ProductionReleaseRequestDto,
  ProductionReleaseResultDto,
  PRODUCTION_RELEASE_MAX_LINES,
  debtDateKey,
  ProductionCancelReason,
  ProductionCostComponent,
  ProductType,
  CostBasis,
  Unit,
  WriteOffReason,
} from "@bakery-os/shared";
import { round2, round3, round4 } from "../common/money";
import { monthRanges } from "../common/month-ranges";

const previousMonthKey = (key: string): string => {
  const [y, m] = key.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};
import { expandRecipe, isStockedSemiFinished, loadRecipeIndex, recipeUnitCost, TreeRecipe } from "../recipes/recipe-tree";
import { CostingService } from "../costing/costing.service";
import { Prisma, ProductionBatchStatus as PrismaProductionBatchStatus, StockMovementType } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { requireLocationScope, resolveLocationScope } from "../common/location-scope";
import { CreateBatchDto } from "./dto/create-batch.dto";
import { UpdateBatchDto } from "./dto/update-batch.dto";
import { CancelBatchDto } from "./dto/cancel-batch.dto";
import { CompleteBatchDto } from "./dto/complete-batch.dto";
import { allowsNegativeStock, decrementStock } from "../common/stock-guard";
import { recordAudit } from "../audit/audit";
import { postLedgerSources, recordProductionEvent } from "../ledger/event-posting";

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
      include: { location: true, recipe: { include: { product: true } }, createdBy: true, costs: true, recipeVersion: { select: { number: true } } },
      orderBy: { scheduledFor: "desc" },
      take: 100,
    });

    return batches.map(this.toDto);
  }

  async create(user: AuthenticatedUser, dto: CreateBatchDto): Promise<ProductionBatchDto> {
    const locationId = requireLocationScope(user, dto.locationId);

    const recipe = await this.prisma.recipe.findFirst({
      where: { id: dto.recipeId, organizationId: user.organizationId },
      include: { product: { select: { type: true, trackInventory: true } } },
    });
    if (!recipe) {
      throw new NotFoundException("Рецептура не найдена");
    }
    // A semi-finished product is made on its own only when it is held as stock;
    // otherwise it is a part of the finished product's recipe.
    if (recipe.product.type === ProductType.SEMI_FINISHED && !recipe.product.trackInventory) {
      throw new BadRequestException("Полуфабрикат без учёта склада отдельным заданием не производится — он входит в техкарту готового изделия");
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
      include: { location: true, recipe: { include: { product: true } }, createdBy: true, costs: true, recipeVersion: { select: { number: true } } },
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
      include: { location: true, recipe: { include: { product: true } }, createdBy: true, costs: true, recipeVersion: { select: { number: true } } },
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

    await this.prisma.$transaction(async (tx) => {
      await tx.productionBatch.delete({ where: { id: batchId } });
      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "productionBatch.delete",
        entityType: "ProductionBatch",
        entityId: batchId,
        before: {
          status: batch.status,
          recipeId: batch.recipeId,
          locationId: batch.locationId,
          plannedQuantity: batch.plannedQuantity,
          scheduledFor: batch.scheduledFor,
        },
      });
    });
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
      include: { location: true, recipe: { include: { product: true } }, createdBy: true, costs: true, recipeVersion: { select: { number: true } } },
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
      return this.completeLoadedBatch(tx, user, batch, dto);
    });
  }

  // The completion itself, on a batch already loaded and checked inside the caller's transaction:
  // «Завершить» of one batch and every line of «Выпуск за день» run exactly this.
  private async completeLoadedBatch(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    batch: LoadedBatch,
    dto: CompleteBatchDto,
  ): Promise<ProductionBatchDto> {
    {
      // A STOCKED semi-finished product (cream, filling) consumes what the plan
      // said and outputs what was actually weighed: the raw materials are gone
      // either way, so a smaller yield makes each kilo dearer. Every other
      // product consumes in proportion to what it actually produced, as always.
      const stockedOutput = batch.recipe.product.type === ProductType.SEMI_FINISHED && batch.recipe.product.trackInventory;
      // ТЗ §5.1/§5.3: finished goods are sold «по средней себестоимости» — the moving
      // average of what their batches cost, exactly like a stocked semi-finished
      // product. Valuing the shelf at today's recipe instead made the balance sheet's
      // inventory check drift every time a raw-material price moved.
      const averagedOutput =
        stockedOutput || (batch.recipe.product.type === ProductType.FINISHED_GOOD && batch.recipe.product.trackInventory);
      const consumeQuantity = stockedOutput ? batch.plannedQuantity.toNumber() : dto.actualQuantity;
      const scale = consumeQuantity / batch.recipe.yieldQuantity.toNumber();

      // The recipe expanded to what is really consumed: a semi-finished
      // ingredient (cream, crumbs) is replaced by the raw materials of its own
      // recipe, scaled to the amount this batch needs. For a flat recipe this is
      // exactly its own lines.
      const { index, recipeNode } = await this.recipeTreeOf(tx, user.organizationId, batch.recipe);
      const expanded = expandRecipe(recipeNode, scale, index);
      if (expanded.missing.length > 0) {
        throw new BadRequestException(`У полуфабриката нет активной техкарты: ${expanded.missing.join(", ")}`);
      }
      // Stock is held to 0.001 of a unit. The amount taken off the shelf is
      // rounded ONCE here and the same number goes on the consumption row: a
      // raw 0.1815 kg used to take 0.181 off the shelf (the database rounds the
      // difference) while the row said 0.182 — grams of drift between stock and
      // its history over a month of baking. The batch's COST stays computed from
      // the exact recipe amounts below, so it keeps matching the recipe card.
      const consumed = expanded.lines.map((line) => ({ ...line, quantity: round3(line.quantity) }));

      // Ingredients with trackInventory=false (e.g. tap water) aren't
      // received or held as stock, so they're excluded from the
      // insufficient-stock check and don't get a consumption movement —
      // they still priced into the recipe's cost via recipes.service.ts.
      const trackedItems = consumed.filter((line) => line.ingredient.trackInventory && line.quantity > 0);
      const unpriced = expanded.lines.filter((line) => line.unitCost === null).map((line) => line.ingredient.name);
      if (unpriced.length > 0) {
        throw new BadRequestException(`Нет себестоимости у: ${unpriced.join(", ")}`);
      }
      // A stocked semi-finished product's average cost moves when a batch of it is
      // made, so whoever reads or changes it first takes the row lock.
      const lockIds = [
        ...trackedItems.filter((l) => isStockedSemiFinished(l.ingredient)).map((l) => l.ingredient.productId),
        ...(averagedOutput ? [batch.recipe.productId] : []),
      ];
      await lockProductRows(tx, lockIds);

      // The norm per product (an ingredient can appear in the dough and in a
      // filling), and what was really used where the baker said otherwise.
      const norms = normByProduct(trackedItems);
      const actual = new Map([...norms].map(([productId, n]) => [productId, n.quantity]));
      for (const line of dto.consumption ?? []) {
        if (!norms.has(line.productId)) {
          throw new BadRequestException("В техкарте этого задания нет такого сырья");
        }
        if (!(line.quantity >= 0)) throw new BadRequestException("Фактический расход не может быть отрицательным");
        actual.set(line.productId, round3(line.quantity));
      }

      // Before the first stock count the organization may produce below zero (Organization.allowNegativeStock):
      // the consumption is written as always and the shelf goes negative until the count.
      const allowNegative = await allowsNegativeStock(tx, user.organizationId);
      for (const [productId, n] of allowNegative ? [] : norms) {
        const used = actual.get(productId) ?? 0;
        if (used <= 0) continue;
        const stockLevel = await tx.stockLevel.findUnique({
          where: { locationId_productId: { locationId: batch.locationId, productId } },
        });
        if (!stockLevel || stockLevel.quantity.toNumber() < used) {
          throw new BadRequestException(`Недостаточно ингредиента «${n.name}» на точке для этого объёма`);
        }
      }

      for (const [productId, n] of norms) {
        const used = actual.get(productId) ?? 0;
        if (used <= 0) continue;
        await decrementStock(
          tx,
          { organizationId: user.organizationId, locationId: batch.locationId, productId, quantity: used },
          `Недостаточно ингредиента «${n.name}» на точке для этого объёма`,
          allowNegative,
        );
      }

      // Ingredient cost of this batch: every consumed line (water included, as
      // in the recipe's own cost) at the ingredient's price today. Frozen onto
      // the consumption rows, the output row and ProductionBatchCost, so the
      // finished goods carry what they cost to make even after prices move.
      // Packaging, labour, utilities, overhead and technological loss are not
      // computed — their policy (D6) is not approved.
      const ingredientTotal = round2(
        expanded.lines.reduce((sum, line) => sum + round2(line.quantity * (line.unitCost as number)), 0),
      );

      if (trackedItems.length > 0) {
        await tx.stockMovement.createMany({
          data: trackedItems.map((item) => ({
            organizationId: user.organizationId,
            locationId: batch.locationId,
            productId: item.ingredient.productId,
            type: StockMovementType.PRODUCTION_CONSUMPTION,
            quantity: item.quantity,
            reason: "Расход на производственное задание",
            batchId: batch.id,
            createdById: user.id,
            unitCost: round4(item.unitCost as number),
            costBasis: consumptionBasis(item.ingredient),
          })),
        });
      }

      // The difference from the norm is not the product's cost (D1: abnormal
      // loss is a write-off): more used = «Перерасход» written off at the same
      // stamped cost, less used = «Экономия», the stock comes back. Together
      // with the norm rows they add up to what left the shelf.
      const deviationIds: string[] = [];
      for (const [productId, n] of norms) {
        const diff = round3((actual.get(productId) ?? 0) - n.quantity);
        if (diff === 0) continue;
        const row = await tx.stockMovement.create({
          data: {
            organizationId: user.organizationId,
            locationId: batch.locationId,
            productId,
            type: diff > 0 ? StockMovementType.WRITE_OFF : StockMovementType.ADJUSTMENT,
            writeOffReason: diff > 0 ? WriteOffReason.PRODUCTION_OVERUSE : undefined,
            // WRITE_OFF holds what left; ADJUSTMENT the signed change (+ back on the shelf).
            quantity: Math.abs(diff),
            reason: `${diff > 0 ? "Перерасход сырья" : "Экономия сырья"}: ${batch.recipe.product.name}`,
            batchId: batch.id,
            createdById: user.id,
            unitCost: round4(n.unitCost),
            costBasis: n.costBasis,
          },
          select: { id: true },
        });
        deviationIds.push(row.id);
      }
      if (deviationIds.length > 0) {
        await postLedgerSources(tx, { organizationId: user.organizationId, actorId: user.id, scope: { stockMovementIds: deviationIds } });
      }

      if (averagedOutput && dto.actualQuantity > 0) {
        // Moving weighted average: what is on the shelf (all locations) at its
        // average, plus this batch at what it cost, over the new quantity. One
        // price per product, so a transfer between locations needs no revaluation.
        const batchUnitCost = round4(ingredientTotal / dto.actualQuantity);
        const [onHand, current] = await Promise.all([
          tx.stockLevel.aggregate({ _sum: { quantity: true }, where: { productId: batch.recipe.productId } }),
          tx.product.findUniqueOrThrow({ where: { id: batch.recipe.productId }, select: { averageUnitCost: true } }),
        ]);
        const quantityBefore = Math.max(onHand._sum.quantity?.toNumber() ?? 0, 0);
        let previousAverage = current.averageUnitCost?.toNumber() ?? null;
        if (previousAverage === null && quantityBefore > 0) {
          // Stock that arrived without a batch (a count correction): value it as its recipe does.
          previousAverage = recipeNode ? recipeUnitCost(recipeNode, index) : null;
        }
        const newAverage =
          quantityBefore > 0 && previousAverage !== null
            ? round4((quantityBefore * previousAverage + dto.actualQuantity * batchUnitCost) / (quantityBefore + dto.actualQuantity))
            : batchUnitCost;
        await tx.product.update({ where: { id: batch.recipe.productId }, data: { averageUnitCost: newAverage } });
      }

      // The output goes to the batch's own point, or straight to another one (ТЗ §4.2:
      // «готовая продукция приходуется на склад цеха или сразу в кондитерскую»).
      let outputLocationId = batch.locationId;
      let outputNote = "";
      if (dto.outputLocationId && dto.outputLocationId !== batch.locationId) {
        const target = await tx.location.findFirst({ where: { id: dto.outputLocationId, organizationId: user.organizationId, isActive: true } });
        if (!target) throw new BadRequestException("Точка для выпуска не найдена");
        outputLocationId = target.id;
        outputNote = ` → ${target.name}`;
      }
      await tx.stockLevel.upsert({
        where: { locationId_productId: { locationId: outputLocationId, productId: batch.recipe.productId } },
        update: { quantity: { increment: dto.actualQuantity } },
        create: {
          organizationId: user.organizationId,
          locationId: outputLocationId,
          productId: batch.recipe.productId,
          quantity: dto.actualQuantity,
          minQuantity: batch.recipe.product.minQuantity,
        },
      });

      await tx.stockMovement.create({
        data: {
          organizationId: user.organizationId,
          locationId: outputLocationId,
          productId: batch.recipe.productId,
          type: StockMovementType.PRODUCTION_OUTPUT,
          quantity: dto.actualQuantity,
          reason: `Выпуск по производственному заданию${outputNote}`,
          batchId: batch.id,
          createdById: user.id,
          unitCost: dto.actualQuantity > 0 ? round4(ingredientTotal / dto.actualQuantity) : null,
          costBasis: dto.actualQuantity > 0 ? CostBasis.PRODUCTION_INGREDIENTS : null,
        },
      });

      await tx.productionBatchCost.create({
        data: {
          batchId: batch.id,
          component: ProductionCostComponent.INGREDIENT,
          amount: ingredientTotal,
          basis: CostBasis.RAW_MATERIAL_PRICE,
        },
      });

      const updated = await tx.productionBatch.update({
        where: { id: batch.id },
        data: {
          status: PrismaProductionBatchStatus.COMPLETED,
          actualQuantity: dto.actualQuantity,
          completedAt: new Date(),
          // The recipe version in force now — what this batch was produced by.
          recipeVersionId:
            (await tx.recipeVersion.findFirst({ where: { recipeId: batch.recipeId }, orderBy: { number: "desc" }, select: { id: true } }))?.id ?? null,
        },
        include: { location: true, recipe: { include: { product: true } }, createdBy: true, costs: true, recipeVersion: { select: { number: true } } },
      });

      // Raw materials became finished goods at cost: a real event with no
      // ledger balance effect under the current (ingredient-only) policy.
      await recordProductionEvent(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        batchId: batch.id,
        completedAt: updated.completedAt ?? new Date(),
        consumedValue: ingredientTotal,
        outputValue: dto.actualQuantity > 0 ? round2(round4(ingredientTotal / dto.actualQuantity) * dto.actualQuantity) : 0,
        outputQuantity: dto.actualQuantity,
      });

      return this.toDto(updated);
    }
  }

  // ── «Выпуск за день» ──
  // The bakers make what they make; the operator enters the day's output in ONE document and it
  // becomes one completed batch per product (no plan, no «Начать»). The preview writes nothing:
  // it is the «проверьте ещё раз» screen — the raw materials that will go and what is missing.
  async previewRelease(user: AuthenticatedUser, dto: ProductionReleaseRequestDto): Promise<ProductionReleasePreviewDto> {
    const plan = await this.planRelease(this.prisma, user, dto);
    const totals = new Map<string, { name: string; quantity: number; unitCost: number; fromStock: boolean }>();
    for (const line of plan.lines) {
      for (const [productId, n] of line.norms) {
        const prev = totals.get(productId);
        totals.set(productId, {
          name: n.name,
          quantity: round3((prev?.quantity ?? 0) + n.quantity),
          unitCost: n.unitCost,
          fromStock: n.costBasis === CostBasis.PRODUCTION_AVERAGE,
        });
      }
    }
    const ids = [...totals.keys()];
    const [levels, units, allowNegative] = await Promise.all([
      this.prisma.stockLevel.findMany({ where: { locationId: plan.locationId, productId: { in: ids } }, select: { productId: true, quantity: true } }),
      this.prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, unit: true } }),
      allowsNegativeStock(this.prisma, user.organizationId),
    ]);
    const onHand = new Map(levels.map((l) => [l.productId, l.quantity.toNumber()]));
    // A filling made in this same release (and put on the workshop's shelf) is there for the lines after it.
    if (plan.outputLocationId === plan.locationId) {
      for (const line of plan.lines) {
        if (line.stockedSemiFinished) onHand.set(line.productId, (onHand.get(line.productId) ?? 0) + line.quantity);
      }
    }
    const unitOf = new Map(units.map((u) => [u.id, u.unit as Unit]));
    const materials = [...totals]
      .map(([productId, m]) => {
        const have = round3(onHand.get(productId) ?? 0);
        return {
          productId,
          name: m.name,
          unit: unitOf.get(productId) ?? Unit.KG,
          quantity: m.quantity,
          onHand: have,
          shortage: round3(Math.max(0, m.quantity - Math.max(have, 0))),
          unitCost: m.unitCost,
          fromStock: m.fromStock,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
    return {
      lines: plan.lines.map((l) => ({ productId: l.productId, productName: l.productName, unit: l.unit, quantity: l.quantity, cost: l.cost })),
      materials,
      totalCost: round2(plan.lines.reduce((s, l) => s + l.cost, 0)),
      allowNegativeStock: allowNegative,
    };
  }

  // One transaction: every line is a batch created and completed at once by the same code as
  // «Завершить»; one line short of raw material stops the whole release and names the product.
  async release(user: AuthenticatedUser, dto: ProductionReleaseRequestDto): Promise<ProductionReleaseResultDto> {
    return this.prisma.$transaction(
      async (tx) => {
        const plan = await this.planRelease(tx, user, dto);
        const consumption = splitReleaseConsumption(plan.lines.map((l) => l.norms), dto.consumption ?? []);
        const now = new Date();
        const batchIds: string[] = [];
        for (const [i, line] of plan.lines.entries()) {
          const created = await tx.productionBatch.create({
            data: {
              organizationId: user.organizationId,
              locationId: plan.locationId,
              recipeId: line.recipeId,
              plannedQuantity: line.quantity,
              scheduledFor: now,
              startedAt: now,
              status: PrismaProductionBatchStatus.IN_PROGRESS,
              createdById: user.id,
            },
            include: { recipe: { include: { items: { include: { ingredientProduct: true } }, product: true } } },
          });
          try {
            const done = await this.completeLoadedBatch(tx, user, created, {
              actualQuantity: line.quantity,
              outputLocationId: plan.outputLocationId !== plan.locationId ? plan.outputLocationId : undefined,
              consumption: consumption[i],
            });
            batchIds.push(done.id);
          } catch (err) {
            if (err instanceof BadRequestException) throw new BadRequestException(`«${line.productName}»: ${err.message}`);
            throw err;
          }
        }
        const totalCost = round2(plan.lines.reduce((s, l) => s + l.cost, 0));
        await recordAudit(tx, {
          organizationId: user.organizationId,
          actorId: user.id,
          action: "production.release",
          entityType: "ProductionBatch",
          entityId: batchIds[0],
          after: {
            locationId: plan.locationId,
            outputLocationId: plan.outputLocationId,
            lines: plan.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
            consumption: dto.consumption ?? [],
            batchIds,
          },
        });
        return { batchIds, totalCost };
      },
      // A day's output can be dozens of batches; on the hosted database each takes a moment.
      { timeout: 180_000 },
    );
  }

  private async planRelease(db: Prisma.TransactionClient | PrismaService, user: AuthenticatedUser, dto: ProductionReleaseRequestDto) {
    const locationId = requireLocationScope(user, dto.locationId);
    const location = await db.location.findFirst({ where: { id: locationId, organizationId: user.organizationId }, select: { id: true } });
    if (!location) throw new NotFoundException("Цех не найден");
    let outputLocationId = locationId;
    if (dto.outputLocationId && dto.outputLocationId !== locationId) {
      const target = await db.location.findFirst({ where: { id: dto.outputLocationId, organizationId: user.organizationId, isActive: true }, select: { id: true } });
      if (!target) throw new BadRequestException("Точка для выпуска не найдена");
      outputLocationId = target.id;
    }
    const lines = dto.lines ?? [];
    if (lines.length === 0) throw new BadRequestException("Добавьте хотя бы один товар");
    if (lines.length > PRODUCTION_RELEASE_MAX_LINES) throw new BadRequestException(`Не больше ${PRODUCTION_RELEASE_MAX_LINES} строк в одном выпуске`);
    if (new Set(lines.map((l) => l.productId)).size !== lines.length) throw new BadRequestException("Один и тот же товар указан дважды — объедините строки");
    if (lines.some((l) => !(l.quantity > 0))) throw new BadRequestException("Количество должно быть больше нуля");

    const recipes = await db.recipe.findMany({
      where: { organizationId: user.organizationId, productId: { in: lines.map((l) => l.productId) }, isActive: true },
      include: { items: { include: { ingredientProduct: true } }, product: true },
    });
    const byProduct = new Map(recipes.map((r) => [r.productId, r]));
    const noRecipe = lines.filter((l) => !byProduct.has(l.productId)).map((l) => l.productId);
    if (noRecipe.length > 0) {
      const names = await db.product.findMany({ where: { id: { in: noRecipe }, organizationId: user.organizationId }, select: { name: true } });
      throw new BadRequestException(`Нет действующей техкарты: ${names.map((n) => n.name).join(", ") || "товар не найден"}`);
    }
    const index = await loadRecipeIndex(db, user.organizationId, lines.map((l) => l.productId));

    const planned = lines.map((line) => {
      const recipe = byProduct.get(line.productId)!;
      const stockedSemiFinished = recipe.product.type === ProductType.SEMI_FINISHED && recipe.product.trackInventory;
      if (recipe.product.type === ProductType.SEMI_FINISHED && !stockedSemiFinished) {
        throw new BadRequestException(`«${recipe.product.name}»: полуфабрикат без учёта склада не производится отдельно — он входит в техкарту готового изделия`);
      }
      const quantity = round3(line.quantity);
      const expanded = expandRecipe(index.get(line.productId)!, quantity / recipe.yieldQuantity.toNumber(), index);
      if (expanded.missing.length > 0) {
        throw new BadRequestException(`«${recipe.product.name}»: у полуфабриката нет активной техкарты: ${expanded.missing.join(", ")}`);
      }
      const unpriced = expanded.lines.filter((l) => l.unitCost === null).map((l) => l.ingredient.name);
      if (unpriced.length > 0) throw new BadRequestException(`«${recipe.product.name}»: нет себестоимости у: ${unpriced.join(", ")}`);
      const tracked = expanded.lines
        .map((l) => ({ ...l, quantity: round3(l.quantity) }))
        .filter((l) => l.ingredient.trackInventory && l.quantity > 0);
      return {
        recipeId: recipe.id,
        productId: recipe.productId,
        productName: recipe.product.name,
        unit: recipe.product.unit as Unit,
        quantity,
        stockedSemiFinished,
        norms: normByProduct(tracked),
        cost: round2(expanded.lines.reduce((sum, l) => sum + round2(l.quantity * (l.unitCost as number)), 0)),
      };
    });
    // A filling held as stock is made before what is made from it.
    planned.sort((a, b) => Number(b.stockedSemiFinished) - Number(a.stockedSemiFinished));
    return { locationId, outputLocationId, lines: planned };
  }

  private async recipeTreeOf(
    db: Prisma.TransactionClient | PrismaService,
    organizationId: string,
    recipe: {
      productId: string;
      yieldQuantity: Prisma.Decimal;
      items: {
        quantity: Prisma.Decimal;
        ingredientProductId: string;
        ingredientProduct: { name: string; type: string; price: Prisma.Decimal; trackInventory: boolean; averageUnitCost: Prisma.Decimal | null };
      }[];
    },
  ) {
    const index = await loadRecipeIndex(db, organizationId, [recipe.productId]);
    // An archived recipe can still finish a batch that was already running.
    const recipeNode: TreeRecipe = index.get(recipe.productId) ?? {
      productId: recipe.productId,
      yieldQuantity: recipe.yieldQuantity.toNumber(),
      items: recipe.items.map((item) => ({
        quantity: item.quantity.toNumber(),
        ingredient: {
          productId: item.ingredientProductId,
          name: item.ingredientProduct.name,
          type: item.ingredientProduct.type as ProductType,
          price: item.ingredientProduct.price.toNumber(),
          trackInventory: item.ingredientProduct.trackInventory,
          averageUnitCost: item.ingredientProduct.averageUnitCost?.toNumber() ?? null,
        },
      })),
    };
    return { index, recipeNode };
  }

  // What a running batch takes off the shelf per unit it consumes for — the
  // completion form multiplies it by the output (or the plan) to show the norm
  // next to the field where the baker types what was really used.
  async norm(user: AuthenticatedUser, batchId: string): Promise<ProductionBatchNormDto> {
    const batch = await this.prisma.productionBatch.findFirst({
      where: { id: batchId, organizationId: user.organizationId },
      include: { recipe: { include: { items: { include: { ingredientProduct: true } }, product: true } } },
    });
    if (!batch) throw new NotFoundException("Задание не найдено");
    this.assertLocationAccess(user, batch.locationId);
    const { index, recipeNode } = await this.recipeTreeOf(this.prisma, user.organizationId, batch.recipe);
    const expanded = expandRecipe(recipeNode, 1 / batch.recipe.yieldQuantity.toNumber(), index);
    const perUnit = new Map<string, { name: string; quantity: number; fromStock: boolean }>();
    for (const line of expanded.lines) {
      if (!line.ingredient.trackInventory) continue;
      const prev = perUnit.get(line.ingredient.productId);
      perUnit.set(line.ingredient.productId, {
        name: line.ingredient.name,
        quantity: (prev?.quantity ?? 0) + line.quantity,
        fromStock: isStockedSemiFinished(line.ingredient),
      });
    }
    const units = new Map(
      (await this.prisma.product.findMany({ where: { id: { in: [...perUnit.keys()] } }, select: { id: true, unit: true } })).map((p) => [p.id, p.unit as Unit]),
    );
    return {
      batchId: batch.id,
      consumesByPlan: batch.recipe.product.type === ProductType.SEMI_FINISHED && batch.recipe.product.trackInventory,
      plannedQuantity: batch.plannedQuantity.toNumber(),
      lines: [...perUnit].map(([productId, l]) => ({
        productId,
        name: l.name,
        unit: units.get(productId) ?? Unit.KG,
        perUnit: Math.round(l.quantity * 1e7) / 1e7,
        fromStock: l.fromStock,
      })),
    };
  }

  // «Выпуск»: completed batches in [from, to] per product and point — how much
  // came out and what its ingredients cost (ProductionBatchCost, by the norm).
  async output(user: AuthenticatedUser, from: Date, to: Date, requestedLocationId?: string): Promise<ProductionOutputReportDto> {
    const locationId = resolveLocationScope(user, requestedLocationId);
    const batches = await this.prisma.productionBatch.findMany({
      where: {
        organizationId: user.organizationId,
        status: PrismaProductionBatchStatus.COMPLETED,
        completedAt: { gte: from, lte: to },
        ...(locationId ? { locationId } : {}),
      },
      select: {
        actualQuantity: true,
        locationId: true,
        location: { select: { name: true, defaultDirection: { select: { id: true, name: true } } } },
        recipe: { select: { product: { select: { id: true, name: true, unit: true } } } },
        costs: { where: { component: ProductionCostComponent.INGREDIENT }, select: { amount: true } },
      },
    });
    const rows = new Map<string, ProductionOutputRowDto>();
    for (const b of batches) {
      const product = b.recipe.product;
      const key = `${product.id}:${b.locationId}`;
      const row = rows.get(key) ?? {
        productId: product.id,
        productName: product.name,
        unit: product.unit as Unit,
        locationId: b.locationId,
        locationName: b.location.name,
        directionId: b.location.defaultDirection?.id ?? null,
        directionName: b.location.defaultDirection?.name ?? null,
        batches: 0,
        quantity: 0,
        cost: 0,
        unitCost: null,
      };
      row.batches += 1;
      row.quantity = round3(row.quantity + (b.actualQuantity?.toNumber() ?? 0));
      row.cost = round2(row.cost + b.costs.reduce((sum, c) => sum + c.amount.toNumber(), 0));
      rows.set(key, row);
    }
    const list = [...rows.values()].map((r) => ({ ...r, unitCost: r.quantity > 0 ? round2(r.cost / r.quantity) : null }));
    list.sort((a, b) => b.cost - a.cost || a.productName.localeCompare(b.productName, "ru"));
    return { from: from.toISOString(), to: to.toISOString(), rows: list, totalCost: round2(list.reduce((s, r) => s + r.cost, 0)) };
  }

  // How one product's unit cost moved, month by month (Almaty months; a month
  // with no output has no unit cost rather than a zero).
  async unitCostTrend(user: AuthenticatedUser, productId: string, months: number, requestedLocationId?: string): Promise<ProductionUnitCostTrendDto> {
    const locationId = resolveLocationScope(user, requestedLocationId);
    const product = await this.prisma.product.findFirst({
      where: { id: productId, organizationId: user.organizationId },
      select: { id: true, name: true, unit: true },
    });
    if (!product) throw new NotFoundException("Товар не найден");
    const count = Math.min(Math.max(Math.floor(months) || 12, 1), 24);
    const lastKey = debtDateKey(new Date()).slice(0, 7);
    let firstKey = lastKey;
    for (let i = 1; i < count; i += 1) firstKey = previousMonthKey(firstKey);
    const ranges = monthRanges(firstKey, lastKey, new Date(), 24);
    const batches = await this.prisma.productionBatch.findMany({
      where: {
        organizationId: user.organizationId,
        status: PrismaProductionBatchStatus.COMPLETED,
        recipe: { productId },
        completedAt: { gte: ranges[0].from, lte: ranges.at(-1)!.to },
        ...(locationId ? { locationId } : {}),
      },
      select: { completedAt: true, actualQuantity: true, costs: { where: { component: ProductionCostComponent.INGREDIENT }, select: { amount: true } } },
    });
    const byMonth = new Map(ranges.map((r) => [r.key, { quantity: 0, cost: 0 }]));
    for (const b of batches) {
      const key = debtDateKey(b.completedAt as Date).slice(0, 7);
      const m = byMonth.get(key);
      if (!m) continue;
      m.quantity += b.actualQuantity?.toNumber() ?? 0;
      m.cost += b.costs.reduce((sum, c) => sum + c.amount.toNumber(), 0);
    }
    return {
      productId: product.id,
      productName: product.name,
      unit: product.unit as Unit,
      months: ranges.map((r) => {
        const m = byMonth.get(r.key)!;
        const quantity = round3(m.quantity);
        const cost = round2(m.cost);
        return { month: r.key, quantity, cost, unitCost: quantity > 0 ? round2(cost / quantity) : null };
      }),
    };
  }

  // «Отклонения от техкарты»: per completed batch in the period, raw material
  // used against the norm, read back from the batch's own stock movements —
  // the norm rows, «Перерасход» write-offs and «Экономия» adjustments.
  // «Акт выпуска» of a completed batch (ТЗ §4.3): what was written off per
  // ingredient (norm / fact / price / sum), the batch cost and the cost of one
  // unit, and the deviation from the recipe — read back from the batch's own
  // movements, exactly like «Отклонения».
  async document(user: AuthenticatedUser, batchId: string): Promise<ProductionBatchDocumentDto> {
    const batch = await this.prisma.productionBatch.findFirst({
      where: { id: batchId, organizationId: user.organizationId },
      include: {
        location: { select: { name: true } },
        createdBy: { select: { fullName: true } },
        recipe: { select: { product: { select: { name: true, unit: true } } } },
        recipeVersion: { select: { number: true } },
        costs: true,
        stockMovements: {
          where: {
            OR: [
              { type: StockMovementType.PRODUCTION_CONSUMPTION },
              { type: StockMovementType.WRITE_OFF, writeOffReason: WriteOffReason.PRODUCTION_OVERUSE },
              { type: StockMovementType.ADJUSTMENT },
              { type: StockMovementType.PRODUCTION_OUTPUT },
            ],
          },
          select: { type: true, productId: true, quantity: true, unitCost: true, location: { select: { name: true } }, product: { select: { name: true, unit: true } } },
        },
      },
    });
    if (!batch) throw new NotFoundException("Задание не найдено");
    this.assertLocationAccess(user, batch.locationId);
    if (batch.status !== PrismaProductionBatchStatus.COMPLETED) throw new BadRequestException("Акт выпуска есть только у завершённого задания");

    const perProduct = new Map<string, { name: string; unit: Unit; norm: number; actual: number; unitCost: number | null }>();
    let outputLocationName = batch.location.name;
    for (const m of batch.stockMovements) {
      if (m.type === StockMovementType.PRODUCTION_OUTPUT) {
        outputLocationName = m.location.name;
        continue;
      }
      const q = m.quantity.toNumber();
      const row = perProduct.get(m.productId) ?? { name: m.product.name, unit: m.product.unit as Unit, norm: 0, actual: 0, unitCost: null };
      if (m.type === StockMovementType.PRODUCTION_CONSUMPTION) {
        row.norm += q;
        row.actual += q;
      } else if (m.type === StockMovementType.WRITE_OFF) row.actual += q;
      else row.actual -= q;
      row.unitCost = row.unitCost ?? m.unitCost?.toNumber() ?? null;
      perProduct.set(m.productId, row);
    }
    const lines = [...perProduct]
      .map(([ingredientId, r]) => {
        const norm = round3(r.norm);
        const actual = round3(r.actual);
        const deviation = round3(actual - norm);
        return {
          ingredientId,
          ingredientName: r.name,
          unit: r.unit,
          norm,
          actual,
          deviation,
          unitCost: r.unitCost,
          normAmount: r.unitCost === null ? null : round2(norm * r.unitCost),
          actualAmount: r.unitCost === null ? null : round2(actual * r.unitCost),
          deviationValue: r.unitCost === null ? null : round2(deviation * r.unitCost),
        };
      })
      .sort((a, b) => a.ingredientName.localeCompare(b.ingredientName, "ru"));
    const batchCost = batch.costs.find((c) => c.component === ProductionCostComponent.INGREDIENT)?.amount.toNumber() ?? null;
    const actualQuantity = batch.actualQuantity?.toNumber() ?? 0;
    const normTracked = round2(lines.reduce((s, l) => s + (l.normAmount ?? 0), 0));
    return {
      batchId: batch.id,
      productName: batch.recipe.product.name,
      unit: batch.recipe.product.unit as Unit,
      locationName: batch.location.name,
      outputLocationName,
      plannedQuantity: batch.plannedQuantity.toNumber(),
      actualQuantity,
      completedAt: (batch.completedAt ?? batch.createdAt).toISOString(),
      createdByName: batch.createdBy.fullName,
      recipeVersionNumber: batch.recipeVersion?.number ?? null,
      lines,
      // Ingredients not held as stock (water…) are in the cost but have no movement.
      untrackedCost: batchCost === null ? 0 : Math.max(0, round2(batchCost - normTracked)),
      batchCost,
      unitCost: batchCost !== null && actualQuantity > 0 ? round2(batchCost / actualQuantity) : null,
      deviationValue: round2(lines.reduce((s, l) => s + (l.deviationValue ?? 0), 0)),
    };
  }

  async deviations(user: AuthenticatedUser, from: Date, to: Date, requestedLocationId?: string): Promise<ProductionDeviationReportDto> {
    const locationId = resolveLocationScope(user, requestedLocationId);
    const batches = await this.prisma.productionBatch.findMany({
      where: {
        organizationId: user.organizationId,
        status: PrismaProductionBatchStatus.COMPLETED,
        completedAt: { gte: from, lte: to },
        ...(locationId ? { locationId } : {}),
      },
      orderBy: { completedAt: "desc" },
      select: {
        id: true,
        completedAt: true,
        actualQuantity: true,
        location: { select: { name: true } },
        recipe: { select: { product: { select: { name: true, unit: true } } } },
        stockMovements: {
          where: {
            OR: [
              { type: StockMovementType.PRODUCTION_CONSUMPTION },
              { type: StockMovementType.WRITE_OFF, writeOffReason: WriteOffReason.PRODUCTION_OVERUSE },
              { type: StockMovementType.ADJUSTMENT },
            ],
          },
          select: { type: true, productId: true, quantity: true, unitCost: true, product: { select: { name: true, unit: true } } },
        },
      },
    });

    const lines: ProductionDeviationLineDto[] = [];
    const byIngredient = new Map<string, ProductionDeviationByIngredientDto>();
    let overuseValue = 0;
    let savingValue = 0;
    for (const batch of batches) {
      const perProduct = new Map<string, { name: string; unit: Unit; norm: number; actual: number; unitCost: number | null }>();
      for (const m of batch.stockMovements) {
        const q = m.quantity.toNumber();
        const row = perProduct.get(m.productId) ?? { name: m.product.name, unit: m.product.unit as Unit, norm: 0, actual: 0, unitCost: null };
        if (m.type === StockMovementType.PRODUCTION_CONSUMPTION) {
          row.norm += q;
          row.actual += q;
        } else if (m.type === StockMovementType.WRITE_OFF) row.actual += q;
        else row.actual -= q; // «Экономия»: back on the shelf
        row.unitCost = row.unitCost ?? m.unitCost?.toNumber() ?? null;
        perProduct.set(m.productId, row);
      }
      for (const [ingredientId, r] of perProduct) {
        const norm = round3(r.norm);
        const actual = round3(r.actual);
        const deviation = round3(actual - norm);
        const value = r.unitCost === null ? null : round2(deviation * r.unitCost);
        const agg = byIngredient.get(ingredientId) ?? { ingredientId, ingredientName: r.name, unit: r.unit, norm: 0, actual: 0, deviation: 0, deviationValue: 0 };
        agg.norm = round3(agg.norm + norm);
        agg.actual = round3(agg.actual + actual);
        agg.deviation = round3(agg.deviation + deviation);
        agg.deviationValue = round2(agg.deviationValue + (value ?? 0));
        byIngredient.set(ingredientId, agg);
        if (deviation === 0) continue;
        if (value !== null) {
          if (value > 0) overuseValue += value;
          else savingValue -= value;
        }
        lines.push({
          batchId: batch.id,
          completedAt: (batch.completedAt as Date).toISOString(),
          locationName: batch.location.name,
          productName: batch.recipe.product.name,
          outputQuantity: batch.actualQuantity?.toNumber() ?? 0,
          outputUnit: batch.recipe.product.unit as Unit,
          ingredientId,
          ingredientName: r.name,
          unit: r.unit,
          norm,
          actual,
          deviation,
          unitCost: r.unitCost,
          deviationValue: value,
        });
      }
    }
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      batchesCount: batches.length,
      overuseValue: round2(overuseValue),
      savingValue: round2(savingValue),
      byIngredient: [...byIngredient.values()].sort((a, b) => b.deviationValue - a.deviationValue || a.ingredientName.localeCompare(b.ingredientName, "ru")),
      lines,
    };
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

    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.productionBatch.update({
        where: { id: batchId },
        data: {
          status: PrismaProductionBatchStatus.CANCELLED,
          cancelReason: dto.reason,
          cancelNote: dto.note,
        },
        include: { location: true, recipe: { include: { product: true } }, createdBy: true, costs: true, recipeVersion: { select: { number: true } } },
      });
      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "productionBatch.cancel",
        entityType: "ProductionBatch",
        entityId: batchId,
        before: { status: batch.status },
        after: { status: saved.status, cancelReason: dto.reason ?? null },
        reason: dto.note ?? null,
      });
      return saved;
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
    recipe: { productId: string; product: { name: string; unit: string; type?: string; trackInventory?: boolean } };
    status: string;
    plannedQuantity: { toNumber: () => number };
    actualQuantity: { toNumber: () => number } | null;
    scheduledFor: Date;
    startedAt: Date | null;
    completedAt: Date | null;
    cancelReason: string | null;
    cancelNote: string | null;
    createdBy: { fullName: string };
    costs?: { component: string; amount: { toNumber: () => number } }[];
    recipeVersion?: { number: number } | null;
  }): ProductionBatchDto => ({
    id: batch.id,
    locationId: batch.locationId,
    locationName: batch.location.name,
    recipeId: batch.recipeId,
    productId: batch.recipe.productId,
    productName: batch.recipe.product.name,
    unit: batch.recipe.product.unit as Unit,
    consumesByPlan: batch.recipe.product.type === ProductType.SEMI_FINISHED && batch.recipe.product.trackInventory === true,
    status: batch.status as ProductionBatchStatus,
    plannedQuantity: batch.plannedQuantity.toNumber(),
    actualQuantity: batch.actualQuantity ? batch.actualQuantity.toNumber() : null,
    scheduledFor: batch.scheduledFor.toISOString(),
    startedAt: batch.startedAt ? batch.startedAt.toISOString() : null,
    completedAt: batch.completedAt ? batch.completedAt.toISOString() : null,
    cancelReason: batch.cancelReason as ProductionCancelReason | null,
    cancelNote: batch.cancelNote,
    createdByName: batch.createdBy.fullName,
    recipeVersionNumber: batch.recipeVersion?.number ?? null,
    // Only a completed batch has a cost; every other component is listed as
    // NOT_CONFIGURED rather than left out or shown as zero.
    costComponents:
      batch.status === "COMPLETED"
        ? CostingService.componentStatuses(
            batch.costs?.find((c) => c.component === ProductionCostComponent.INGREDIENT)?.amount.toNumber() ?? null,
          )
        : null,
  });
}

type ConsumedLine = {
  quantity: number;
  unitCost: number | null;
  ingredient: { productId: string; name: string; type: ProductType; trackInventory: boolean; averageUnitCost: number | null };
};

function consumptionBasis(ingredient: ConsumedLine["ingredient"]): CostBasis {
  return isStockedSemiFinished(ingredient)
    ? CostBasis.PRODUCTION_AVERAGE
    : ingredient.averageUnitCost !== null
      ? CostBasis.RAW_MATERIAL_AVERAGE
      : CostBasis.RAW_MATERIAL_PRICE;
}

// The recipe norm per product of a batch's tracked lines (already rounded per line).
export function normByProduct(lines: ConsumedLine[]): Map<string, { name: string; quantity: number; unitCost: number; costBasis: CostBasis }> {
  const out = new Map<string, { name: string; quantity: number; unitCost: number; costBasis: CostBasis }>();
  for (const line of lines) {
    const prev = out.get(line.ingredient.productId);
    out.set(line.ingredient.productId, {
      name: line.ingredient.name,
      quantity: round3((prev?.quantity ?? 0) + line.quantity),
      unitCost: line.unitCost ?? 0,
      costBasis: consumptionBasis(line.ingredient),
    });
  }
  return out;
}

// A batch as `complete` loads it: the recipe with its lines and output product.
type LoadedBatch = Prisma.ProductionBatchGetPayload<{
  include: { recipe: { include: { items: { include: { ingredientProduct: true } }; product: true } } };
}>;

// What was really used for the whole release, shared over its batches in proportion to each one's
// norm (the last batch takes the rounding), as each batch's «Факт». Unmentioned material = the norm.
export function splitReleaseConsumption(
  norms: Map<string, { quantity: number }>[],
  totals: { productId: string; quantity: number }[],
): { productId: string; quantity: number }[][] {
  const out = norms.map(() => [] as { productId: string; quantity: number }[]);
  for (const total of totals) {
    if (!(total.quantity >= 0)) throw new BadRequestException("Фактический расход не может быть отрицательным");
    const holders = norms.map((n, i) => ({ i, norm: n.get(total.productId)?.quantity ?? 0 })).filter((h) => h.norm > 0);
    if (holders.length === 0) throw new BadRequestException("В техкартах этого выпуска нет такого сырья");
    const normTotal = holders.reduce((s, h) => s + h.norm, 0);
    const diff = total.quantity - normTotal;
    let given = 0;
    holders.forEach((h, k) => {
      const share = k === holders.length - 1 ? round3(diff - given) : round3((diff * h.norm) / normTotal);
      given = round3(given + share);
      out[h.i].push({ productId: total.productId, quantity: Math.max(0, round3(h.norm + share)) });
    });
  }
  return out;
}
