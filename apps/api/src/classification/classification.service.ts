import { createHash } from "crypto";
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  ClassificationBatchDto,
  ClassificationCategoryToCreateDto,
  ClassificationPreviewDto,
  ClassificationPreviewRowDto,
  ClassificationPromotionImpactDto,
  ClassificationRevertResultDto,
  PRODUCT_TYPE_LABELS_RU,
  ProductType,
  STANDARD_CATEGORY_CATALOG,
  normalizeCategoryName,
} from "@bakery-os/shared";
import { AuthenticatedUser } from "../auth/auth.types";
import { recordAudit } from "../audit/audit";
import { PrismaService } from "../prisma/prisma.service";
import { ClassificationApplyDto, ClassificationPreviewDto as PreviewRequest, ClassificationRevertDto, ClassificationRowDto } from "./dto/classification.dto";

type Db = Prisma.TransactionClient;

// Re-files products by SKU: Preview → Apply → Audit → Rollback.
//
// It changes ONE thing about a product — its category — and may create
// categories/subcategories to hold them. It never changes a type, a price, a
// cost, a stock level, the «под реализацию» flag, or any document, and the only
// top-level categories it will create are the approved ones (the standard
// catalogue); anything else must already exist.

const DASHES = new Set(["", "-", "–", "—"]);
const clean = (value?: string | null): string => (value ?? "").replace(/\s+/g, " ").trim();
const isBlank = (value: string): boolean => DASHES.has(value);
const fold = (value: string): string => value.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
const sameName = (a: string, b: string): boolean => fold(a.replace(/[«»"]/g, "")) === fold(b.replace(/[«»"]/g, ""));

// File type labels → product types. «Сервисная позиция POS» is not a product
// type at all: such a row is skipped.
const TYPE_BY_LABEL = new Map<string, ProductType | "SERVICE">([
  ["сырье", ProductType.RAW_MATERIAL],
  ["raw_material", ProductType.RAW_MATERIAL],
  ["упаковка", ProductType.PACKAGING],
  ["packaging", ProductType.PACKAGING],
  ["готовая продукция", ProductType.FINISHED_GOOD],
  ["finished_good", ProductType.FINISHED_GOOD],
  ["сервисная позиция pos", "SERVICE"],
  ["сервисная позиция", "SERVICE"],
]);

interface CategoryRow {
  id: string;
  name: string;
  type: string | null;
  parentId: string | null;
  isActive: boolean;
}

// A category a row will sit in: one that exists, or one the batch will create.
interface TopRef {
  id: string | null;
  // «id:<id>» for an existing category, «new:<type>|<name>» for a planned one.
  ref: string;
  type: ProductType;
  name: string;
}
interface SubRef {
  id: string | null;
  ref: string;
  name: string;
}

interface PlanRow extends ClassificationPreviewRowDto {
  beforeCategoryId: string | null;
  top: TopRef | null;
  sub: SubRef | null;
}

interface Plan {
  rows: PlanRow[];
  createTops: Map<string, { type: ProductType; name: string }>;
  createSubs: Map<string, { type: ProductType; name: string; parentRef: string; parentName: string }>;
  fingerprint: string;
  labelOf: (categoryId: string | null) => string | null;
  promotions: ClassificationPromotionImpactDto[];
  productsNotInFile: number;
}

@Injectable()
export class ClassificationService {
  constructor(private prisma: PrismaService) {}

  // ── preview: writes nothing ──────────────────────────────────────────────
  async preview(user: AuthenticatedUser, dto: PreviewRequest): Promise<ClassificationPreviewDto> {
    const plan = await this.plan(this.prisma as unknown as Db, user.organizationId, dto.rows);
    return this.toPreview(plan);
  }

  // ── apply: one transaction ───────────────────────────────────────────────
  async apply(user: AuthenticatedUser, dto: ClassificationApplyDto): Promise<ClassificationBatchDto> {
    const organizationId = user.organizationId;
    const batchId = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const plan = await this.plan(tx, organizationId, dto.rows);
      if (plan.fingerprint !== dto.fingerprint) {
        throw new ConflictException("Данные изменились с момента предпросмотра — сделайте предпросмотр заново");
      }
      const rejected = plan.rows.filter((r) => r.status === "REJECT").length;
      if (rejected > 0 && !dto.acceptRejected) {
        throw new BadRequestException(`В файле есть отклонённые строки (${rejected}) — исправьте их или подтвердите применение остальных`);
      }
      const moves = plan.rows.filter((r) => r.status === "MOVE");
      if (moves.length === 0) {
        throw new BadRequestException("Нечего применять: ни один товар не меняет категорию");
      }

      const batch = await tx.classificationBatch.create({
        data: { organizationId, createdById: user.id, note: dto.note?.trim() || null },
      });

      // Categories first: the approved top-level ones the file needs, then the
      // subcategories under them (new or existing parents).
      const createdIds: string[] = [];
      const idByRef = new Map<string, string>();
      for (const [ref, c] of plan.createTops) {
        const created = await tx.category.create({ data: { organizationId, name: c.name, type: c.type, parentId: null } });
        idByRef.set(ref, created.id);
        createdIds.push(created.id);
      }
      for (const [ref, c] of plan.createSubs) {
        const parentId = c.parentRef.startsWith("id:") ? c.parentRef.slice(3) : idByRef.get(c.parentRef);
        if (!parentId) throw new Error(`parent category missing for ${ref}`);
        const created = await tx.category.create({ data: { organizationId, name: c.name, type: c.type, parentId } });
        idByRef.set(ref, created.id);
        createdIds.push(created.id);
      }
      const resolve = (r: { id: string | null; ref: string }): string => {
        const id = r.id ?? idByRef.get(r.ref);
        if (!id) throw new Error(`category missing for ${r.ref}`);
        return id;
      };

      // Products: ONLY categoryId changes, and only if the product still sits
      // where the plan saw it.
      const lines: Prisma.ClassificationBatchLineCreateManyInput[] = [];
      for (const row of moves) {
        const afterId = resolve(row.sub ?? (row.top as TopRef));
        const updated = await tx.product.updateMany({
          where: { id: row.productId as string, organizationId, categoryId: row.beforeCategoryId },
          data: { categoryId: afterId },
        });
        if (updated.count !== 1) {
          throw new ConflictException(`Товар ${row.sku} изменился во время применения — сделайте предпросмотр заново`);
        }
        await recordAudit(tx, {
          organizationId,
          actorId: user.id,
          action: "product.update",
          entityType: "Product",
          entityId: row.productId as string,
          before: { categoryId: row.beforeCategoryId },
          after: { categoryId: afterId },
          reason: `Классификация, пакет ${batch.id}`,
        });
        lines.push({
          batchId: batch.id,
          productId: row.productId as string,
          sku: row.sku,
          productName: row.productName as string,
          beforeCategoryId: row.beforeCategoryId,
          afterCategoryId: afterId,
          beforeLabel: row.currentPath,
          afterLabel: row.targetPath as string,
        });
      }
      await tx.classificationBatchLine.createMany({ data: lines });
      await tx.classificationBatch.update({ where: { id: batch.id }, data: { createdCategoryIds: createdIds } });

      await recordAudit(tx, {
        organizationId,
        actorId: user.id,
        action: "classification.apply",
        entityType: "ClassificationBatch",
        entityId: batch.id,
        after: { productsMoved: lines.length, categoriesCreated: createdIds.length, rejectedRows: rejected, note: dto.note ?? null },
      });
      return batch.id;
    });
    return (await this.listBatches(organizationId)).find((b) => b.id === batchId) as ClassificationBatchDto;
  }

  // ── rollback ─────────────────────────────────────────────────────────────
  // Each line goes back only if the product still sits where the batch put it;
  // anything touched since is reported as a conflict and left alone.
  async revert(user: AuthenticatedUser, batchId: string, dto: ClassificationRevertDto): Promise<ClassificationRevertResultDto> {
    const organizationId = user.organizationId;
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const batch = await tx.classificationBatch.findFirst({ where: { id: batchId, organizationId }, include: { lines: true } });
      if (!batch) throw new NotFoundException("Пакет не найден");
      if (batch.status === "REVERTED") throw new BadRequestException("Этот пакет уже отменён");

      const categories = await tx.category.findMany({ where: { organizationId }, select: { id: true, name: true, parentId: true } });
      const labelOf = (id: string | null): string => {
        const c = categories.find((x) => x.id === id);
        if (!c) return "без категории";
        const parent = c.parentId ? categories.find((x) => x.id === c.parentId) : null;
        return parent ? `${parent.name} › ${c.name}` : c.name;
      };

      let restored = 0;
      const conflicts: { sku: string; productName: string; reason: string }[] = [];
      const now = new Date();
      for (const line of batch.lines) {
        if (line.revertedAt) continue;
        const product = await tx.product.findFirst({ where: { id: line.productId, organizationId }, select: { id: true, categoryId: true } });
        let reason: string | null = null;
        if (!product) reason = "Товар удалён";
        else if (product.categoryId !== line.afterCategoryId) reason = `Категория изменилась после применения (сейчас: ${labelOf(product.categoryId)})`;
        else if (line.beforeCategoryId && !categories.some((c) => c.id === line.beforeCategoryId)) reason = "Прежняя категория удалена";
        if (reason) {
          conflicts.push({ sku: line.sku, productName: line.productName, reason });
          continue;
        }
        const updated = await tx.product.updateMany({
          where: { id: line.productId, organizationId, categoryId: line.afterCategoryId },
          data: { categoryId: line.beforeCategoryId },
        });
        if (updated.count !== 1) {
          conflicts.push({ sku: line.sku, productName: line.productName, reason: "Товар изменился во время отката" });
          continue;
        }
        await recordAudit(tx, {
          organizationId,
          actorId: user.id,
          action: "product.update",
          entityType: "Product",
          entityId: line.productId,
          before: { categoryId: line.afterCategoryId },
          after: { categoryId: line.beforeCategoryId },
          reason: `Откат классификации, пакет ${batch.id}`,
        });
        await tx.classificationBatchLine.update({ where: { id: line.id }, data: { revertedAt: now } });
        restored += 1;
      }

      // Optionally remove categories this batch created that are still empty:
      // subcategories first, and never one that anything now depends on.
      let categoriesRemoved = 0;
      if (dto.removeEmptyCategories) {
        const created = await tx.category.findMany({ where: { id: { in: batch.createdCategoryIds }, organizationId }, orderBy: { parentId: { sort: "desc", nulls: "last" } } });
        for (const c of created) {
          const used = await tx.category.findUnique({ where: { id: c.id }, include: { _count: { select: { products: true, children: true, promotionRules: true } } } });
          if (!used || used._count.products > 0 || used._count.children > 0 || used._count.promotionRules > 0) continue;
          await tx.category.delete({ where: { id: c.id } });
          await recordAudit(tx, {
            organizationId,
            actorId: user.id,
            action: "category.delete",
            entityType: "Category",
            entityId: c.id,
            before: { name: c.name, type: c.type, parentId: c.parentId },
            reason: `Откат классификации, пакет ${batch.id}`,
          });
          categoriesRemoved += 1;
        }
      }

      const remaining = await tx.classificationBatchLine.count({ where: { batchId: batch.id, revertedAt: null } });
      const total = batch.lines.length;
      const status = remaining === 0 ? "REVERTED" : remaining < total ? "PARTIALLY_REVERTED" : "APPLIED";
      await tx.classificationBatch.update({
        where: { id: batch.id },
        data: { status, ...(status === "REVERTED" ? { revertedAt: now, revertedById: user.id } : {}) },
      });
      await recordAudit(tx, {
        organizationId,
        actorId: user.id,
        action: "classification.revert",
        entityType: "ClassificationBatch",
        entityId: batch.id,
        after: { restored, conflicts: conflicts.length, categoriesRemoved, status },
      });
      return { restored, conflicts, categoriesRemoved };
    });
    const batch = (await this.listBatches(organizationId)).find((b) => b.id === batchId) as ClassificationBatchDto;
    return { batch, ...result };
  }

  async listBatches(organizationId: string): Promise<ClassificationBatchDto[]> {
    const batches = await this.prisma.classificationBatch.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { lines: { select: { revertedAt: true } } },
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(batches.map((b) => b.createdById))] } },
      select: { id: true, fullName: true },
    });
    const nameById = new Map(users.map((u) => [u.id, u.fullName]));
    return batches.map((b) => ({
      id: b.id,
      createdAt: b.createdAt.toISOString(),
      createdByName: nameById.get(b.createdById) ?? "—",
      note: b.note,
      status: b.status,
      productsMoved: b.lines.length,
      productsRestored: b.lines.filter((l) => l.revertedAt).length,
      categoriesCreated: b.createdCategoryIds.length,
      revertedAt: b.revertedAt?.toISOString() ?? null,
    }));
  }

  // ── the plan: reads only ─────────────────────────────────────────────────
  private async plan(db: Db, organizationId: string, input: ClassificationRowDto[]): Promise<Plan> {
    const skus = [...new Set(input.map((r) => clean(r.sku)).filter(Boolean))];
    const [products, categories, allActive] = await Promise.all([
      // SKU is matched ignoring case; an exact-case match always wins, and a SKU
      // that is ambiguous ignoring case is rejected rather than guessed.
      skus.length === 0
        ? Promise.resolve([])
        : db.product.findMany({ where: { organizationId, OR: skus.map((sku) => ({ sku: { equals: sku, mode: "insensitive" as const } })) }, select: { id: true, sku: true, name: true, type: true, categoryId: true, isOpenPrice: true } }),
      db.category.findMany({ where: { organizationId }, select: { id: true, name: true, type: true, parentId: true, isActive: true } }),
      db.product.findMany({ where: { organizationId, isActive: true, isOpenPrice: false }, select: { id: true } }),
    ]);
    const exactBySku = new Map(products.map((p) => [p.sku, p]));
    const foldedBySku = new Map<string, typeof products>();
    for (const p of products) foldedBySku.set(p.sku.toUpperCase(), [...(foldedBySku.get(p.sku.toUpperCase()) ?? []), p]);
    const byId = new Map<string, CategoryRow>(categories.map((c) => [c.id, c]));
    const tops = categories.filter((c) => c.parentId === null);
    const kidsOf = new Map<string, CategoryRow[]>();
    for (const c of categories) if (c.parentId) kidsOf.set(c.parentId, [...(kidsOf.get(c.parentId) ?? []), c]);
    const labelOf = (id: string | null): string | null => {
      if (!id) return null;
      const c = byId.get(id);
      if (!c) return null;
      const parent = c.parentId ? byId.get(c.parentId) : null;
      return parent ? `${parent.name} › ${c.name}` : c.name;
    };

    const skuCount = new Map<string, number>();
    for (const r of input) {
      const key = clean(r.sku).toUpperCase();
      if (key) skuCount.set(key, (skuCount.get(key) ?? 0) + 1);
    }

    const createTops = new Map<string, { type: ProductType; name: string }>();
    const createSubs = new Map<string, { type: ProductType; name: string; parentRef: string; parentName: string }>();
    const rows: PlanRow[] = [];

    input.forEach((raw, index) => {
      const sku = clean(raw.sku);
      const fileName = clean(raw.name) || null;
      const row: PlanRow = {
        line: index + 1,
        sku,
        fileName,
        productId: null,
        productName: null,
        productType: null,
        currentPath: null,
        targetPath: null,
        status: "REJECT",
        reason: null,
        warning: null,
        beforeCategoryId: null,
        top: null,
        sub: null,
      };
      const reject = (reason: string) => {
        row.status = "REJECT";
        row.reason = reason;
        rows.push(row);
      };
      const skip = (reason: string) => {
        row.status = "SKIP";
        row.reason = reason;
        rows.push(row);
      };

      if (!sku) return reject("Нет артикула");
      if ((skuCount.get(sku.toUpperCase()) ?? 0) > 1) return reject("Артикул повторяется в файле");
      const candidates = foldedBySku.get(sku.toUpperCase()) ?? [];
      const product = exactBySku.get(sku) ?? (candidates.length === 1 ? candidates[0] : undefined);
      if (!product) return reject(candidates.length > 1 ? "Артикул неоднозначен (в системе есть похожие)" : "Артикул не найден в системе");

      row.productId = product.id;
      row.productName = product.name;
      row.productType = product.type as ProductType;
      row.beforeCategoryId = product.categoryId;
      row.currentPath = labelOf(product.categoryId);
      if (fileName && !sameName(fileName, product.name)) row.warning = `Название в файле отличается: «${fileName}»`;

      if (product.isOpenPrice) return skip("Служебная позиция кассы — не классифицируется");
      const typeLabel = clean(raw.type);
      if (typeLabel) {
        const mapped = TYPE_BY_LABEL.get(fold(typeLabel));
        if (!mapped) return reject(`Неизвестный тип «${typeLabel}»`);
        if (mapped === "SERVICE") return skip("Служебная позиция — не классифицируется");
        if (mapped !== product.type) {
          return reject(`Тип в файле («${PRODUCT_TYPE_LABELS_RU[mapped]}») не совпадает с типом товара («${PRODUCT_TYPE_LABELS_RU[product.type as ProductType]}»): классификация тип не меняет`);
        }
      }
      const categoryName = clean(raw.category);
      if (isBlank(categoryName)) return skip("Категория не указана — товар не классифицируется");
      const subName = clean(raw.subcategory);
      const type = product.type as ProductType;

      // ── the category ──
      let top: TopRef;
      const matches = tops.filter((c) => normalizeCategoryName(c.name) === normalizeCategoryName(categoryName));
      const usable =
        matches.find((c) => c.type === type && c.isActive && c.name === categoryName) ?? matches.find((c) => c.type === type && c.isActive);
      if (usable) {
        top = { id: usable.id, ref: `id:${usable.id}`, type, name: usable.name };
      } else if (matches.length > 0) {
        const m = matches[0];
        return reject(
          m.type === null
            ? `Категория «${m.name}» есть, но без типа — сначала задайте ей тип`
            : m.type !== type
              ? `Категория «${m.name}» относится к другому типу («${PRODUCT_TYPE_LABELS_RU[m.type as ProductType]}»)`
              : `Категория «${m.name}» в архиве`,
        );
      } else {
        const approved = STANDARD_CATEGORY_CATALOG.find((c) => c.type === type && normalizeCategoryName(c.name) === normalizeCategoryName(categoryName));
        if (!approved) return reject(`Категории «${categoryName}» нет, и она не входит в утверждённое дерево — создайте её вручную`);
        const ref = `new:${type}|${normalizeCategoryName(approved.name)}`;
        createTops.set(ref, { type, name: approved.name });
        top = { id: null, ref, type, name: approved.name };
      }

      // ── the subcategory (optional) ──
      let sub: SubRef | null = null;
      if (!isBlank(subName)) {
        if (subName.length < 2) return reject("Название подкатегории слишком короткое");
        const existing = top.id ? (kidsOf.get(top.id) ?? []).find((c) => normalizeCategoryName(c.name) === normalizeCategoryName(subName)) : undefined;
        if (existing) {
          if (!existing.isActive) return reject(`Подкатегория «${existing.name}» в архиве`);
          sub = { id: existing.id, ref: `id:${existing.id}`, name: existing.name };
        } else {
          const ref = `${top.ref}/${normalizeCategoryName(subName)}`;
          // The first spelling of a new subcategory in the file is the one created.
          if (!createSubs.has(ref)) createSubs.set(ref, { type, name: subName, parentRef: top.ref, parentName: top.name });
          sub = { id: null, ref, name: (createSubs.get(ref) as { name: string }).name };
        }
      }

      row.top = top;
      row.sub = sub;
      row.targetPath = sub ? `${top.name} › ${sub.name}` : top.name;
      const targetId = top.id && (!sub || sub.id) ? (sub?.id ?? top.id) : null;
      row.status = targetId !== null && targetId === product.categoryId ? "UNCHANGED" : "MOVE";
      rows.push(row);
    });

    // ── promotions whose category would lose products ──
    const promotions = await this.promotionImpact(db, organizationId, rows, byId);
    const touched = new Set(rows.filter((r) => r.productId).map((r) => r.productId));
    const productsNotInFile = allActive.filter((p) => !touched.has(p.id)).length;

    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          rows: rows.map((r) => [r.sku, r.status, r.productId, r.beforeCategoryId, r.top?.ref ?? null, r.sub?.ref ?? null]),
          tops: [...createTops.keys()].sort(),
          subs: [...createSubs.keys()].sort(),
        }),
      )
      .digest("hex");

    return { rows, createTops, createSubs, fingerprint, labelOf, promotions, productsNotInFile };
  }

  // A promotion's rule on category C (which also covers C's subcategories) stops
  // applying to a product that moves out of C's tree.
  private async promotionImpact(db: Db, organizationId: string, rows: PlanRow[], byId: Map<string, CategoryRow>): Promise<ClassificationPromotionImpactDto[]> {
    const promotions = await db.promotion.findMany({
      where: { organizationId, isActive: true, endAt: { gte: new Date() } },
      include: { rules: { include: { category: { select: { id: true, name: true } } } } },
    });
    const rootOf = (id: string | null): string | null => (id ? (byId.get(id)?.parentId ?? id) : null);
    const out: ClassificationPromotionImpactDto[] = [];
    for (const promotion of promotions) {
      for (const rule of promotion.rules) {
        let leaving = 0;
        for (const row of rows) {
          if (row.status !== "MOVE") continue;
          if (rootOf(row.beforeCategoryId) !== rule.categoryId) continue;
          const targetRoot = row.top?.id ?? null;
          if (targetRoot !== rule.categoryId) leaving += 1;
        }
        if (leaving > 0) out.push({ promotionId: promotion.id, promotionName: promotion.name, categoryName: rule.category.name, productsLeaving: leaving });
      }
    }
    return out;
  }

  private toPreview(plan: Plan): ClassificationPreviewDto {
    const count = (status: string) => plan.rows.filter((r) => r.status === status).length;
    const categoriesToCreate: ClassificationCategoryToCreateDto[] = [
      ...[...plan.createTops.values()].map((c) => ({ type: c.type, name: c.name, parentName: null })),
      ...[...plan.createSubs.values()].map((c) => ({ type: c.type, name: c.name, parentName: c.parentName })),
    ];
    return {
      fingerprint: plan.fingerprint,
      rows: plan.rows.map(({ beforeCategoryId: _b, top: _t, sub: _s, ...row }) => row),
      summary: {
        rows: plan.rows.length,
        toMove: count("MOVE"),
        unchanged: count("UNCHANGED"),
        skipped: count("SKIP"),
        rejected: count("REJECT"),
        categoriesToCreate: plan.createTops.size,
        subcategoriesToCreate: plan.createSubs.size,
        productsNotInFile: plan.productsNotInFile,
      },
      categoriesToCreate,
      promotions: plan.promotions,
    };
  }

  // One classification at a time per organization (apply and revert both).
  private async lock(tx: Db, organizationId: string): Promise<void> {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`classification:${organizationId}`}))::text AS locked`;
  }
}
