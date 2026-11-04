import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { MaterialRequisitionKind, Prisma, ProductionBatchStatus, StockMovementType } from "@prisma/client";
import {
  debtDateKey,
  MATERIAL_REQUISITION_MAX_LINES,
  MaterialRequisitionDto,
  MaterialRequisitionLineDto,
  MaterialRequisitionLineInputDto,
  MaterialRequisitionStatus,
  ORG_WIDE_ROLES,
  ProductType,
  RequisitionNeedDto,
  Unit,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { CostingService } from "../costing/costing.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { recordAudit } from "../audit/audit";
import { addDays, startOfZonedDate } from "../common/day-ranges";
import { decrementStockOrThrow } from "../common/stock-guard";
import { round3 } from "../common/money";
import { expandRecipe, loadRecipeIndex } from "../recipes/recipe-tree";

// «Требование-накладная» (ТЗ §4): the workshop asks the warehouse for the raw
// materials of its production plan. The need = each planned task's quantity ×
// the recipe norm, expanded through semi-finished fillings exactly the way
// production will consume them (`expandRecipe`), only for items held as stock.
// The issued quantity is typed (it may differ from the need). Posting moves the
// goods: TRANSFER_OUT at the warehouse and TRANSFER_IN at the workshop, both
// stamped with the same cost — goods moved between own points keep their value,
// so nothing reaches money, events or the ledger.

const INCLUDE = {
  fromLocation: { select: { name: true } },
  toLocation: { select: { name: true } },
  lines: { include: { product: { select: { name: true, unit: true } } } },
} satisfies Prisma.MaterialRequisitionInclude;

type Row = Prisma.MaterialRequisitionGetPayload<{ include: typeof INCLUDE }>;

const OPEN_BATCH = [ProductionBatchStatus.PLANNED, ProductionBatchStatus.IN_PROGRESS];

@Injectable()
export class MaterialRequisitionsService {
  constructor(
    private prisma: PrismaService,
    private costing: CostingService,
  ) {}

  // A user tied to one point works only with requisitions to or from it.
  private assertAccess(user: AuthenticatedUser, fromLocationId: string, toLocationId: string) {
    if (ORG_WIDE_ROLES.includes(user.role)) return;
    if (!user.locationId) throw new ForbiddenException("Ваш аккаунт не привязан ни к одной точке");
    if (user.locationId !== fromLocationId && user.locationId !== toLocationId) {
      throw new ForbiddenException("Нет доступа к данным другой точки");
    }
  }

  private async assertLocations(organizationId: string, fromLocationId: string, toLocationId: string) {
    if (!fromLocationId || !toLocationId) throw new BadRequestException("Укажите склад и цех");
    if (fromLocationId === toLocationId) throw new BadRequestException("Склад и цех должны быть разными точками");
    const found = await this.prisma.location.count({ where: { organizationId, id: { in: [fromLocationId, toLocationId] }, isActive: true } });
    if (found !== 2) throw new NotFoundException("Точка не найдена");
  }

  private async stockAt(locationIds: string[], productIds: string[]): Promise<Map<string, number>> {
    if (productIds.length === 0) return new Map();
    const levels = await this.prisma.stockLevel.findMany({
      where: { locationId: { in: locationIds }, productId: { in: productIds } },
      select: { locationId: true, productId: true, quantity: true },
    });
    return new Map(levels.map((l) => [`${l.locationId}:${l.productId}`, l.quantity.toNumber()]));
  }

  // The day's tasks at the workshop and what the chosen ones need.
  async need(user: AuthenticatedUser, params: { fromLocationId: string; toLocationId: string; date: string; batchIds?: string[] }): Promise<RequisitionNeedDto> {
    await this.assertLocations(user.organizationId, params.fromLocationId, params.toLocationId);
    this.assertAccess(user, params.fromLocationId, params.toLocationId);
    const start = startOfZonedDate(params.date);
    const end = startOfZonedDate(addDays(params.date, 1));
    const batches = await this.prisma.productionBatch.findMany({
      where: {
        organizationId: user.organizationId,
        locationId: params.toLocationId,
        status: { in: OPEN_BATCH },
        scheduledFor: { gte: start, lt: end },
      },
      include: { recipe: { include: { product: { select: { name: true, unit: true } } } } },
      orderBy: { scheduledFor: "asc" },
    });
    const chosen = params.batchIds ? batches.filter((b) => params.batchIds!.includes(b.id)) : batches;

    const index = await loadRecipeIndex(this.prisma, user.organizationId, [...new Set(chosen.map((b) => b.recipe.productId))]);
    const need = new Map<string, number>();
    const missing = new Set<string>();
    for (const batch of chosen) {
      const node = index.get(batch.recipe.productId);
      if (!node || node.yieldQuantity <= 0) {
        missing.add(batch.recipe.product.name);
        continue;
      }
      const expanded = expandRecipe(node, batch.plannedQuantity.toNumber() / node.yieldQuantity, index);
      expanded.missing.forEach((m) => missing.add(m));
      for (const line of expanded.lines) {
        if (!line.ingredient.trackInventory) continue;
        need.set(line.ingredient.productId, (need.get(line.ingredient.productId) ?? 0) + line.quantity);
      }
    }

    const ids = [...need.keys()];
    const [products, stock] = await Promise.all([
      this.prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, unit: true } }),
      this.stockAt([params.fromLocationId, params.toLocationId], ids),
    ]);
    const lines: MaterialRequisitionLineDto[] = products
      .map((p) => {
        const required = round3(need.get(p.id) ?? 0);
        return {
          productId: p.id,
          productName: p.name,
          unit: p.unit as Unit,
          requiredQuantity: required,
          quantity: required,
          fromStock: stock.get(`${params.fromLocationId}:${p.id}`) ?? 0,
          toStock: stock.get(`${params.toLocationId}:${p.id}`) ?? 0,
        };
      })
      .filter((l) => (l.requiredQuantity ?? 0) > 0)
      .sort((a, b) => a.productName.localeCompare(b.productName, "ru"));

    return {
      batches: batches.map((b) => ({
        id: b.id,
        productName: b.recipe.product.name,
        unit: b.recipe.product.unit as Unit,
        plannedQuantity: b.plannedQuantity.toNumber(),
        status: b.status,
      })),
      lines,
      missing: [...missing],
    };
  }

  async list(user: AuthenticatedUser, from?: string, to?: string, kind: MaterialRequisitionKind = MaterialRequisitionKind.REQUISITION): Promise<MaterialRequisitionDto[]> {
    const pinned = ORG_WIDE_ROLES.includes(user.role) ? null : (user.locationId ?? "__none__");
    const rows = await this.prisma.materialRequisition.findMany({
      where: {
        organizationId: user.organizationId,
        kind,
        ...(from || to
          ? { planDate: { ...(from ? { gte: startOfZonedDate(from) } : {}), ...(to ? { lt: startOfZonedDate(addDays(to, 1)) } : {}) } }
          : {}),
        ...(pinned ? { OR: [{ fromLocationId: pinned }, { toLocationId: pinned }] } : {}),
      },
      include: INCLUDE,
      orderBy: [{ planDate: "desc" }, { number: "desc" }],
      take: 200,
    });
    return Promise.all(rows.map((r) => this.toDto(r)));
  }

  async findOne(user: AuthenticatedUser, id: string): Promise<MaterialRequisitionDto> {
    const row = await this.load(user, id);
    return this.toDto(row);
  }

  private async load(user: AuthenticatedUser, id: string): Promise<Row> {
    const row = await this.prisma.materialRequisition.findFirst({ where: { id, organizationId: user.organizationId }, include: INCLUDE });
    if (!row) throw new NotFoundException("Требование не найдено");
    this.assertAccess(user, row.fromLocationId, row.toLocationId);
    return row;
  }

  private async cleanLines(organizationId: string, lines: MaterialRequisitionLineInputDto[], kind: MaterialRequisitionKind = MaterialRequisitionKind.REQUISITION) {
    const kept = lines.filter((l) => l.quantity > 0 || (l.requiredQuantity ?? 0) > 0);
    if (kept.length === 0) throw new BadRequestException("Добавьте хотя бы одну строку");
    if (kept.length > MATERIAL_REQUISITION_MAX_LINES) throw new BadRequestException(`Не больше ${MATERIAL_REQUISITION_MAX_LINES} строк`);
    const ids = kept.map((l) => l.productId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException("Товар указан дважды");
    for (const l of kept) {
      if (!Number.isFinite(l.quantity) || l.quantity < 0) throw new BadRequestException("Количество не может быть отрицательным");
    }
    const products = await this.prisma.product.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true, name: true, type: true, trackInventory: true } });
    if (products.length !== ids.length) throw new NotFoundException("Товар не найден");
    const untracked = products.filter((p) => !p.trackInventory || (kind === MaterialRequisitionKind.REQUISITION && p.type === ProductType.FINISHED_GOOD));
    if (untracked.length > 0) {
      throw new BadRequestException(
        kind === MaterialRequisitionKind.TRANSFER
          ? `Не учитывается на складе: ${untracked.map((p) => p.name).join(", ")}`
          : `Не выдаётся со склада по требованию: ${untracked.map((p) => p.name).join(", ")}`,
      );
    }
    return kept.map((l) => ({
      productId: l.productId,
      requiredQuantity: l.requiredQuantity === null || l.requiredQuantity === undefined ? null : round3(l.requiredQuantity),
      quantity: round3(l.quantity),
    }));
  }

  async create(
    user: AuthenticatedUser,
    dto: { fromLocationId: string; toLocationId: string; planDate: string; batchIds?: string[]; note?: string; lines: MaterialRequisitionLineInputDto[] },
    kind: MaterialRequisitionKind = MaterialRequisitionKind.REQUISITION,
  ): Promise<MaterialRequisitionDto> {
    await this.assertLocations(user.organizationId, dto.fromLocationId, dto.toLocationId);
    this.assertAccess(user, dto.fromLocationId, dto.toLocationId);
    const planDate = startOfZonedDate(dto.planDate);
    const lines = await this.cleanLines(user.organizationId, dto.lines, kind);
    const batchIds = dto.batchIds?.length
      ? (
          await this.prisma.productionBatch.findMany({
            where: { organizationId: user.organizationId, id: { in: dto.batchIds }, locationId: dto.toLocationId },
            select: { id: true },
          })
        ).map((b) => b.id)
      : [];

    // The number is the next one in the organization; a concurrent requisition
    // taking it first makes the unique index refuse, and we take the next.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const row = await this.prisma.$transaction(async (tx) => {
          const last = await tx.materialRequisition.findFirst({
            where: { organizationId: user.organizationId, kind },
            orderBy: { number: "desc" },
            select: { number: true },
          });
          const created = await tx.materialRequisition.create({
            data: {
              organizationId: user.organizationId,
              kind,
              number: (last?.number ?? 0) + 1,
              fromLocationId: dto.fromLocationId,
              toLocationId: dto.toLocationId,
              planDate,
              batchIds,
              note: dto.note?.trim() || null,
              createdById: user.id,
              createdByName: user.fullName,
              lines: { create: lines },
            },
            include: INCLUDE,
          });
          await recordAudit(tx, {
            organizationId: user.organizationId,
            actorId: user.id,
            action: kind === MaterialRequisitionKind.TRANSFER ? "stockTransfer.create" : "materialRequisition.create",
            entityType: "MaterialRequisition",
            entityId: created.id,
            after: { number: created.number, lines: lines.length },
          });
          return created;
        });
        return this.toDto(row);
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
        throw e;
      }
    }
    throw new BadRequestException("Не удалось присвоить номер — попробуйте ещё раз");
  }

  async update(user: AuthenticatedUser, id: string, dto: { note?: string; lines: MaterialRequisitionLineInputDto[] }): Promise<MaterialRequisitionDto> {
    const current = await this.load(user, id);
    if (current.status !== MaterialRequisitionStatus.DRAFT) throw new BadRequestException("Проведённое требование не меняется");
    const lines = await this.cleanLines(user.organizationId, dto.lines);
    const row = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.materialRequisition.updateMany({
        where: { id, status: MaterialRequisitionStatus.DRAFT },
        data: { note: dto.note !== undefined ? dto.note.trim() || null : current.note, updatedAt: new Date() },
      });
      if (claimed.count !== 1) throw new BadRequestException("Проведённое требование не меняется");
      await tx.materialRequisitionLine.deleteMany({ where: { requisitionId: id } });
      await tx.materialRequisitionLine.createMany({ data: lines.map((l) => ({ ...l, requisitionId: id })) });
      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "materialRequisition.update",
        entityType: "MaterialRequisition",
        entityId: id,
        before: { lines: current.lines.map((l) => ({ productId: l.productId, quantity: l.quantity.toNumber() })) },
        after: { lines },
      });
      return tx.materialRequisition.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    });
    return this.toDto(row);
  }

  async remove(user: AuthenticatedUser, id: string): Promise<{ deleted: true }> {
    const current = await this.load(user, id);
    if (current.status !== MaterialRequisitionStatus.DRAFT) throw new BadRequestException("Проведённое требование удалить нельзя");
    await this.prisma.$transaction(async (tx) => {
      const gone = await tx.materialRequisition.deleteMany({ where: { id, status: MaterialRequisitionStatus.DRAFT } });
      if (gone.count !== 1) throw new BadRequestException("Проведённое требование удалить нельзя");
      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: "materialRequisition.delete",
        entityType: "MaterialRequisition",
        entityId: id,
        before: { number: current.number },
      });
    });
    return { deleted: true };
  }

  // Issues the goods: the warehouse loses each line's quantity, the workshop gets it.
  async post(user: AuthenticatedUser, id: string): Promise<MaterialRequisitionDto> {
    const current = await this.load(user, id);
    if (current.status !== MaterialRequisitionStatus.DRAFT) throw new BadRequestException("Требование уже проведено");
    const row = await this.prisma.$transaction(async (tx) => {
      const lines = (await tx.materialRequisitionLine.findMany({ where: { requisitionId: id }, include: { product: true } })).filter(
        (l) => l.quantity.toNumber() > 0,
      );
      if (lines.length === 0) throw new BadRequestException("Нечего выдавать — у всех строк количество 0");
      // Only the request that flips DRAFT → POSTED moves stock.
      const claimed = await tx.materialRequisition.updateMany({
        where: { id, status: MaterialRequisitionStatus.DRAFT },
        data: { status: MaterialRequisitionStatus.POSTED, postedById: user.id, postedByName: user.fullName, postedAt: new Date() },
      });
      if (claimed.count !== 1) throw new BadRequestException("Требование уже проведено");

      for (const line of lines) {
        await decrementStockOrThrow(
          tx,
          { locationId: current.fromLocationId, productId: line.productId, quantity: line.quantity },
          `Недостаточно «${line.product.name}» на складе «${current.fromLocation.name}»`,
        );
        await tx.stockLevel.upsert({
          where: { locationId_productId: { locationId: current.toLocationId, productId: line.productId } },
          update: { quantity: { increment: line.quantity } },
          create: {
            organizationId: user.organizationId,
            locationId: current.toLocationId,
            productId: line.productId,
            quantity: line.quantity,
            minQuantity: line.product.minQuantity,
          },
        });
      }
      // Both legs carry the SAME cost (a move between own points changes no value).
      const costs = await this.costing.snapshotCosts(user.organizationId, lines.map((l) => l.productId), tx);
      const reason = current.kind === MaterialRequisitionKind.TRANSFER ? `Перемещение №${current.number}` : `Требование-накладная №${current.number}`;
      await tx.stockMovement.createMany({
        data: lines.flatMap((line) => [
          {
            organizationId: user.organizationId,
            locationId: current.fromLocationId,
            productId: line.productId,
            type: StockMovementType.TRANSFER_OUT,
            quantity: line.quantity,
            reason,
            materialRequisitionId: id,
            createdById: user.id,
            ...this.costing.fields(costs.get(line.productId)),
          },
          {
            organizationId: user.organizationId,
            locationId: current.toLocationId,
            productId: line.productId,
            type: StockMovementType.TRANSFER_IN,
            quantity: line.quantity,
            reason,
            materialRequisitionId: id,
            createdById: user.id,
            ...this.costing.fields(costs.get(line.productId)),
          },
        ]),
      });
      await recordAudit(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
        action: current.kind === MaterialRequisitionKind.TRANSFER ? "stockTransfer.post" : "materialRequisition.post",
        entityType: "MaterialRequisition",
        entityId: id,
        after: { number: current.number, lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity.toNumber() })) },
      });
      return tx.materialRequisition.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    });
    return this.toDto(row);
  }

  // Склад → «Перемещение»: goods between any two own points, issued at once.
  async transfer(
    user: AuthenticatedUser,
    dto: { fromLocationId: string; toLocationId: string; note?: string; lines: MaterialRequisitionLineInputDto[] },
  ): Promise<MaterialRequisitionDto> {
    const draft = await this.create(user, { ...dto, planDate: debtDateKey(new Date()) }, MaterialRequisitionKind.TRANSFER);
    try {
      return await this.post(user, draft.id);
    } catch (e) {
      // Nothing moved: leave no half-made document behind.
      await this.prisma.materialRequisition.deleteMany({ where: { id: draft.id, status: MaterialRequisitionStatus.DRAFT } });
      throw e;
    }
  }

  private async toDto(row: Row): Promise<MaterialRequisitionDto> {
    const draft = row.status === MaterialRequisitionStatus.DRAFT;
    const stock = draft ? await this.stockAt([row.fromLocationId, row.toLocationId], row.lines.map((l) => l.productId)) : null;
    return {
      id: row.id,
      kind: row.kind as MaterialRequisitionDto["kind"],
      number: row.number,
      status: row.status as MaterialRequisitionStatus,
      fromLocationId: row.fromLocationId,
      fromLocationName: row.fromLocation.name,
      toLocationId: row.toLocationId,
      toLocationName: row.toLocation.name,
      planDate: debtDateKey(row.planDate),
      batchIds: row.batchIds,
      note: row.note,
      createdByName: row.createdByName,
      createdAt: row.createdAt.toISOString(),
      postedByName: row.postedByName,
      postedAt: row.postedAt?.toISOString() ?? null,
      lines: row.lines
        .map((l) => ({
          productId: l.productId,
          productName: l.product.name,
          unit: l.product.unit as Unit,
          requiredQuantity: l.requiredQuantity?.toNumber() ?? null,
          quantity: l.quantity.toNumber(),
          fromStock: stock ? (stock.get(`${row.fromLocationId}:${l.productId}`) ?? 0) : null,
          toStock: stock ? (stock.get(`${row.toLocationId}:${l.productId}`) ?? 0) : null,
        }))
        .sort((a, b) => a.productName.localeCompare(b.productName, "ru")),
    };
  }
}
