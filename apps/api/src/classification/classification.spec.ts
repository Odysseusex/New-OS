import { readFileSync } from "fs";
import { join } from "path";
import { AUDIT_ACTION_GROUPS } from "../audit/audit";
import { PaymentMethod, ProductType, Unit } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { PromotionsService } from "../promotions/promotions.service";
import { ClassificationService } from "./classification.service";

// Preview → Apply → Audit → Rollback of a SKU → category/subcategory file. It
// must change ONLY a product's category, find products by SKU, create only the
// approved top-level categories, and be fully undoable.

const prisma = new PrismaService();
const services = buildServices(prisma);
const promotions = new PromotionsService(prisma);
const classification = new ClassificationService(prisma);
const originalFiscal = process.env.FISCALIZATION_ENABLED;

let org: IsolatedOrg;
let other: IsolatedOrg;
const RAW = ProductType.RAW_MATERIAL;
const FIN = ProductType.FINISHED_GOOD;
const row = (sku: string, category: string, subcategory = "", extra: object = {}) => ({ sku, category, subcategory, ...extra });

let n = 0;
const product = (type: ProductType, extra: object = {}, organizationId = org.organizationId) =>
  prisma.product.create({
    data: { organizationId, name: `Товар ${++n}`, sku: `CL-${String(n).padStart(4, "0")}`, unit: Unit.PCS, type, price: 100, ...extra } as never,
  });
const cat = (name: string, type: ProductType | null, extra: object = {}) =>
  prisma.category.create({ data: { organizationId: org.organizationId, name, type, ...extra } as never });
const preview = (rows: object[]) => classification.preview(org.user, { rows } as never);
const apply = async (rows: object[], extra: object = {}) => {
  const p = await preview(rows);
  return classification.apply(org.user, { rows, fingerprint: p.fingerprint, ...extra } as never);
};
const snapshot = async () => ({
  categories: await prisma.category.count({ where: { organizationId: org.organizationId } }),
  batches: await prisma.classificationBatch.count({ where: { organizationId: org.organizationId } }),
  audits: await prisma.auditLog.count({ where: { organizationId: org.organizationId } }),
  products: (await prisma.product.findMany({ where: { organizationId: org.organizationId }, orderBy: { id: "asc" } })).map((p) => [p.id, p.categoryId]),
});
const categoryLabelOf = async (id: string | null) => {
  if (!id) return null;
  const c = await prisma.category.findUniqueOrThrow({ where: { id }, include: { parent: true } });
  return c.parent ? `${c.parent.name} › ${c.name}` : c.name;
};

beforeAll(async () => {
  await prisma.$connect();
  delete process.env.FISCALIZATION_ENABLED;
  org = await createIsolatedOrg(prisma, "classification");
  other = await createIsolatedOrg(prisma, "classification-other");
});

afterAll(async () => {
  if (originalFiscal !== undefined) process.env.FISCALIZATION_ENABLED = originalFiscal;
  const leftovers = [...(await destroyOrg(prisma, org.organizationId)), ...(await destroyOrg(prisma, other.organizationId))];
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

describe("preview writes nothing and finds products by SKU", () => {
  it("reports what would happen without changing a single row", async () => {
    const bread = await cat("Хлеб", FIN);
    const a = await product(FIN, { categoryId: bread.id });
    const b = await product(RAW);
    const before = await snapshot();
    const result = await preview([row(a.sku, "Хлеб", "Батон"), row(b.sku, "Бакалея", "Мука")]);
    expect(result.summary).toMatchObject({ rows: 2, toMove: 2, rejected: 0, categoriesToCreate: 1, subcategoriesToCreate: 2 });
    expect(result.categoriesToCreate).toEqual([
      { type: RAW, name: "Бакалея", parentName: null },
      { type: FIN, name: "Батон", parentName: "Хлеб" },
      { type: RAW, name: "Мука", parentName: "Бакалея" },
    ]);
    expect(result.rows[0]).toMatchObject({ productId: a.id, currentPath: "Хлеб", targetPath: "Хлеб › Батон", status: "MOVE" });
    expect(await snapshot()).toEqual(before);
  });

  it("matches by SKU, not by name: a different name only warns, a wrong or repeated SKU is rejected", async () => {
    const bread = await cat("Хлеб-2", FIN);
    const p = await product(FIN, { name: "Мука пшеничная 1-го сорта ТМ «Гранум»", categoryId: bread.id });
    const res = await preview([
      row(p.sku.toLowerCase(), "Хлеб-2", "Другой", { name: "Мука пшеничная 1-го сорта" }),
      row("NOPE-1", "Хлеб-2"),
      row("", "Хлеб-2"),
    ]);
    expect(res.rows[0]).toMatchObject({ status: "MOVE", productId: p.id });
    expect(res.rows[0].warning).toContain("Название в файле отличается");
    expect(res.rows[1]).toMatchObject({ status: "REJECT", reason: "Артикул не найден в системе" });
    expect(res.rows[2]).toMatchObject({ status: "REJECT", reason: "Нет артикула" });
    const dup = await preview([row(p.sku, "Хлеб-2"), row(p.sku, "Хлеб-2")]);
    expect(dup.rows.map((r) => [r.status, r.reason])).toEqual([["REJECT", "Артикул повторяется в файле"], ["REJECT", "Артикул повторяется в файле"]]);
  });

  it("two products with the same name are told apart by SKU", async () => {
    const x = await product(FIN, { name: "Мини пицца" });
    const y = await product(FIN, { name: "Мини пицца" });
    const res = await preview([row(x.sku, "Пицца, роллы, блины", "Пицца"), row(y.sku, "Пицца, роллы, блины", "Блины")]);
    expect(res.rows.map((r) => r.productId)).toEqual([x.id, y.id]);
    expect(res.rows.map((r) => r.targetPath)).toEqual(["Пицца, роллы, блины › Пицца", "Пицца, роллы, блины › Блины"]);
  });
});

describe("what a row may and may not do", () => {
  it("never changes a type: a mismatching type is rejected, service rows are skipped", async () => {
    const raw = await product(RAW);
    const fin = await product(FIN);
    const service = await product(FIN, { isOpenPrice: true });
    const res = await preview([
      row(raw.sku, "Хлеб", "", { type: "Готовая продукция" }),
      row(fin.sku, "Хлеб", "Батон", { type: "Готовая продукция" }),
      row(service.sku, "Хлеб"),
      row(fin.sku + "X", "Хлеб"),
    ]);
    expect(res.rows[0].status).toBe("REJECT");
    expect(res.rows[0].reason).toContain("классификация тип не меняет");
    expect(res.rows[1].status).toBe("MOVE");
    expect(res.rows[2]).toMatchObject({ status: "SKIP", reason: "Служебная позиция кассы — не классифицируется" });
    const posService = await preview([{ sku: fin.sku, type: "Сервисная позиция POS", category: "—", subcategory: "—" }]);
    expect(posService.rows[0]).toMatchObject({ status: "SKIP" });
    const unknown = await preview([{ sku: fin.sku, type: "Что-то", category: "Хлеб" }]);
    expect(unknown.rows[0]).toMatchObject({ status: "REJECT", reason: "Неизвестный тип «Что-то»" });
  });

  it("a row with no category («—») is skipped and the product is left alone", async () => {
    const p = await product(FIN);
    const res = await preview([{ sku: p.sku, type: "Готовая продукция", category: "—", subcategory: "—" }]);
    expect(res.rows[0]).toMatchObject({ status: "SKIP", reason: "Категория не указана — товар не классифицируется" });
    expect(res.summary).toMatchObject({ skipped: 1, toMove: 0 });
  });

  it("creates only APPROVED top-level categories; anything else must already exist", async () => {
    const p = await product(FIN);
    const q = await product(RAW);
    const res = await preview([row(p.sku, "Придуманная категория", "Что-то"), row(q.sku, "Хлеб", "Мука")]);
    expect(res.rows[0]).toMatchObject({ status: "REJECT" });
    expect(res.rows[0].reason).toContain("не входит в утверждённое дерево");
    // «Хлеб» is approved for finished goods only: never made for a raw material.
    expect(res.rows[1]).toMatchObject({ status: "REJECT" });
    expect(res.rows[1].reason).toMatch(/не входит в утверждённое дерево|относится к другому типу/);
  });

  it("reuses an existing category ignoring case and a trailing «…»; rejects untyped, other-type and archived ones", async () => {
    const lower = await cat("кондитерские изделия", FIN);
    const dots = await cat("Пицца, роллы, блины…", FIN);
    await cat("Яйца", ProductType.PACKAGING);
    await cat("Бакалея", null);
    await cat("Архивная категория", FIN, { isActive: false });
    const sweet = await product(FIN);
    const pizza = await product(FIN);
    const egg = await product(RAW);
    const flour = await product(RAW);
    const bun = await product(FIN);
    const res = await preview([
      row(sweet.sku, "Кондитерские изделия"),
      row(pizza.sku, "Пицца, роллы, блины", "Пицца"),
      row(egg.sku, "Яйца", "Яйца"),
      row(flour.sku, "Бакалея", "Мука"),
      row(bun.sku, "Архивная категория", "Булочки"),
    ]);
    expect(res.rows[0]).toMatchObject({ status: "MOVE", targetPath: "кондитерские изделия" });
    expect(res.rows[1]).toMatchObject({ status: "MOVE", targetPath: "Пицца, роллы, блины… › Пицца" });
    expect(res.rows[2].reason).toContain("другому типу");
    expect(res.rows[3].reason).toContain("без типа");
    expect(res.rows[4].reason).toContain("в архиве");
    expect(res.categoriesToCreate.map((c) => c.name)).toEqual(["Пицца"]);
    expect([lower.id, dots.id]).toHaveLength(2);
  });

  it("a subcategory is optional; a repeated new subcategory is created once; the same name under two parents is two", async () => {
    const a = await product(FIN);
    const b = await product(FIN);
    const c = await product(FIN);
    const d = await product(FIN);
    const res = await preview([
      row(a.sku, "Торты"),
      row(b.sku, "Торты", "Чизкейки"),
      row(c.sku, "Торты", "чизкейки"),
      row(d.sku, "Пироги", "Чизкейки"),
    ]);
    expect(res.rows.map((r) => r.targetPath)).toEqual(["Торты", "Торты › Чизкейки", "Торты › Чизкейки", "Пироги › Чизкейки"]);
    expect(res.summary.subcategoriesToCreate).toBe(2);
  });

  it("an unchanged row is reported unchanged", async () => {
    const bread = await cat("Хлеб-3", FIN);
    const sub = await cat("Батон-3", FIN, { parentId: bread.id });
    const p = await product(FIN, { categoryId: sub.id });
    const res = await preview([row(p.sku, "Хлеб-3", "Батон-3")]);
    expect(res.rows[0]).toMatchObject({ status: "UNCHANGED", currentPath: "Хлеб-3 › Батон-3" });
  });
});

describe("apply", () => {
  it("is refused when the data moved since the preview, and when there are rejected rows unless accepted", async () => {
    const p = await product(FIN);
    const rows = [row(p.sku, "Торты", "Торты"), row("NOPE-X", "Торты")];
    const pv = await preview(rows);
    await expect(classification.apply(org.user, { rows, fingerprint: pv.fingerprint } as never)).rejects.toThrow(/отклонённые строки/);
    await expect(classification.apply(org.user, { rows, fingerprint: "stale", acceptRejected: true } as never)).rejects.toThrow(/сделайте предпросмотр заново/);
    // The product changed under the preview's feet → the old fingerprint no longer fits.
    await prisma.product.update({ where: { id: p.id }, data: { categoryId: (await cat("Где-то", FIN)).id } });
    await expect(classification.apply(org.user, { rows, fingerprint: pv.fingerprint, acceptRejected: true } as never)).rejects.toThrow(/сделайте предпросмотр заново/);
  });

  it("changes ONLY categoryId, records before/after, audits every product, and creates what the file needs", async () => {
    const supplier = await prisma.supplier.create({ data: { organizationId: org.organizationId, name: "Деревня" } });
    const own = await product(FIN, { name: "Чизкейк ап", price: 777, minQuantity: 3, ntin: "123", barcode: "999" });
    const village = await product(FIN, { name: "Булочка ап", consignmentSupplierId: supplier.id, price: 150 });
    const raw = await product(RAW, { price: 55, trackInventory: false });
    const keep = await product(FIN, { name: "Не в файле" });
    const beforeRows = await prisma.product.findMany({ where: { id: { in: [own.id, village.id, raw.id, keep.id] } }, orderBy: { id: "asc" } });

    const rows = [row(own.sku, "Торты", "Торты"), row(village.sku, "Выпечка", "Булочки"), row(raw.sku, "Кондитерское сырьё", "Орехи", { type: "Сырьё" })];
    const batch = await apply(rows, { note: "тест" });
    expect(batch).toMatchObject({ status: "APPLIED", productsMoved: 3, productsRestored: 0, note: "тест" });

    const afterRows = await prisma.product.findMany({ where: { id: { in: [own.id, village.id, raw.id, keep.id] } }, orderBy: { id: "asc" } });
    for (let i = 0; i < afterRows.length; i += 1) {
      // Everything but the category (and the automatic updatedAt stamp) is identical:
      // price, type, flags, sku, name, stock flags…
      const { categoryId: _b, updatedAt: _ub, ...restBefore } = beforeRows[i];
      const { categoryId: _a, updatedAt: _ua, ...restAfter } = afterRows[i];
      expect(restAfter).toEqual(restBefore);
    }
    expect(afterRows.find((p) => p.id === keep.id)!.categoryId).toBe(beforeRows.find((p) => p.id === keep.id)!.categoryId);
    expect(afterRows.find((p) => p.id === village.id)!.consignmentSupplierId).toBe(supplier.id);
    expect(await categoryLabelOf(afterRows.find((p) => p.id === own.id)!.categoryId)).toBe("Торты › Торты");
    expect(await categoryLabelOf(afterRows.find((p) => p.id === raw.id)!.categoryId)).toBe("Кондитерское сырьё › Орехи");

    const stored = await prisma.classificationBatch.findUniqueOrThrow({ where: { id: batch.id }, include: { lines: true } });
    expect(stored.lines).toHaveLength(3);
    expect(stored.createdCategoryIds.length).toBe(batch.categoriesCreated);
    expect(stored.lines.find((l) => l.productId === own.id)).toMatchObject({ afterLabel: "Торты › Торты", beforeCategoryId: null });

    const audits = await prisma.auditLog.findMany({ where: { organizationId: org.organizationId, action: "product.update", reason: { contains: batch.id } } });
    expect(audits).toHaveLength(3);
    expect(audits[0].before).toHaveProperty("categoryId");
    const batchAudit = await prisma.auditLog.findFirst({ where: { organizationId: org.organizationId, action: "classification.apply", entityId: batch.id } });
    expect(batchAudit).not.toBeNull();
  });

  it("is idempotent: applied rows come back UNCHANGED and a second apply has nothing to do", async () => {
    const p = await product(FIN);
    const rows = [row(p.sku, "Хлеб", "Хлеб")];
    await apply(rows);
    const again = await preview(rows);
    expect(again.rows[0].status).toBe("UNCHANGED");
    expect(again.summary).toMatchObject({ toMove: 0, categoriesToCreate: 0, subcategoriesToCreate: 0 });
    await expect(classification.apply(org.user, { rows, fingerprint: again.fingerprint } as never)).rejects.toThrow(/Нечего применять/);
  });

  it("does not touch sales, stock, cash, the category snapshot or cost of anything", async () => {
    const p = await product(FIN, { categoryId: (await cat("Старая-1", FIN)).id });
    await prisma.stockLevel.create({ data: { organizationId: org.organizationId, locationId: org.storeId, productId: p.id, quantity: 20, minQuantity: 0 } });
    const sale = await services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items: [{ productId: p.id, quantity: 2, unitPrice: 100 }] });
    const state = async () => ({
      sales: await prisma.sale.findMany({ where: { organizationId: org.organizationId }, orderBy: { id: "asc" } }),
      items: await prisma.saleItem.findMany({ where: { sale: { organizationId: org.organizationId } }, orderBy: { id: "asc" } }),
      stock: await prisma.stockLevel.findMany({ where: { organizationId: org.organizationId }, orderBy: { id: "asc" } }),
      moves: await prisma.stockMovement.findMany({ where: { organizationId: org.organizationId }, orderBy: { id: "asc" } }),
      cash: await prisma.cashMovement.findMany({ where: { organizationId: org.organizationId }, orderBy: { id: "asc" } }),
      accounts: await prisma.cashAccount.findMany({ where: { organizationId: org.organizationId }, orderBy: { id: "asc" } }),
      journal: await prisma.journalEntry.count({ where: { organizationId: org.organizationId } }),
    });
    const before = await state();
    const batch = await apply([row(p.sku, "Пироги", "Сладкие пироги")]);
    expect(await state()).toEqual(before);
    const item = await prisma.saleItem.findFirstOrThrow({ where: { saleId: sale.id } });
    expect(item.categoryIdSnapshot).not.toBeNull(); // the sale still remembers where the product WAS
    await classification.revert(org.user, batch.id, {});
    expect(await state()).toEqual(before);
  });

  it("lists active promotions whose category would lose products", async () => {
    const tort = await cat("Торты-акция", FIN);
    const p = await product(FIN, { categoryId: tort.id });
    await promotions.create(org.user, {
      name: "Акция на торты",
      locationId: org.storeId,
      startAt: new Date(Date.now() - 60_000).toISOString(),
      endAt: new Date(Date.now() + 3_600_000).toISOString(),
      rules: [{ categoryId: tort.id, discountPercent: 20 }],
    });
    const res = await preview([row(p.sku, "Пироги", "Сладкие пироги")]);
    expect(res.promotions).toEqual([expect.objectContaining({ promotionName: "Акция на торты", categoryName: "Торты-акция", productsLeaving: 1 })]);
    const stay = await preview([row(p.sku, "Торты-акция", "Новая-под")]);
    expect(stay.promotions).toEqual([]);
  });
});

describe("rollback", () => {
  it("restores every product to where it was, including «no category», and marks the batch reverted", async () => {
    const old = await cat("Старая-2", FIN);
    const a = await product(FIN, { categoryId: old.id });
    const b = await product(FIN);
    const batch = await apply([row(a.sku, "Торты", "Торты"), row(b.sku, "Торты", "Торты")]);
    const result = await classification.revert(org.user, batch.id, {});
    expect(result).toMatchObject({ restored: 2, conflicts: [], categoriesRemoved: 0 });
    expect(result.batch).toMatchObject({ status: "REVERTED", productsRestored: 2 });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: a.id } })).categoryId).toBe(old.id);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: b.id } })).categoryId).toBeNull();
    await expect(classification.revert(org.user, batch.id, {})).rejects.toThrow(/уже отменён/);
    expect(await prisma.auditLog.count({ where: { organizationId: org.organizationId, action: "classification.revert", entityId: batch.id } })).toBe(1);
  });

  it("leaves a product that has been changed since as a conflict, and can finish the rest later", async () => {
    const a = await product(FIN);
    const b = await product(FIN);
    const batch = await apply([row(a.sku, "Выпечка", "Круассаны"), row(b.sku, "Выпечка", "Круассаны")]);
    const elsewhere = await cat("Куда-то ещё", FIN);
    await prisma.product.update({ where: { id: b.id }, data: { categoryId: elsewhere.id } });
    const first = await classification.revert(org.user, batch.id, {});
    expect(first.restored).toBe(1);
    expect(first.conflicts).toEqual([expect.objectContaining({ sku: b.sku, reason: expect.stringContaining("Категория изменилась после применения") })]);
    expect(first.batch.status).toBe("PARTIALLY_REVERTED");
    expect((await prisma.product.findUniqueOrThrow({ where: { id: b.id } })).categoryId).toBe(elsewhere.id); // untouched
    // Once the product is back where the batch put it, the rest can be undone.
    const afterId = (await prisma.classificationBatchLine.findFirstOrThrow({ where: { batchId: batch.id, productId: b.id } })).afterCategoryId;
    await prisma.product.update({ where: { id: b.id }, data: { categoryId: afterId } });
    const second = await classification.revert(org.user, batch.id, {});
    expect(second).toMatchObject({ restored: 1, conflicts: [] });
    expect(second.batch.status).toBe("REVERTED");
  });

  it("can also remove the categories the batch created — only the ones that are still empty", async () => {
    const a = await product(FIN);
    const b = await product(FIN);
    const batch = await apply([row(a.sku, "Готовая кулинария", "Сэндвичи"), row(b.sku, "Готовая кулинария", "Салаты")]);
    expect(batch.categoriesCreated).toBe(3); // the category and two subcategories
    // Somebody files another product under «Салаты» after the batch.
    const salad = await prisma.category.findFirstOrThrow({ where: { organizationId: org.organizationId, name: "Салаты" } });
    const later = await product(FIN, { categoryId: salad.id });
    const result = await classification.revert(org.user, batch.id, { removeEmptyCategories: true });
    expect(result.restored).toBe(2);
    expect(result.categoriesRemoved).toBe(1); // «Сэндвичи» only
    expect(await prisma.category.count({ where: { organizationId: org.organizationId, name: "Сэндвичи" } })).toBe(0);
    expect(await prisma.category.count({ where: { organizationId: org.organizationId, name: "Салаты" } })).toBe(1);
    expect(await prisma.category.count({ where: { organizationId: org.organizationId, name: "Готовая кулинария" } })).toBe(1); // still has a child
    expect((await prisma.product.findUniqueOrThrow({ where: { id: later.id } })).categoryId).toBe(salad.id);
  });

  it("reports a deleted previous category as a conflict instead of failing", async () => {
    const old = await cat("Удалим", FIN);
    const p = await product(FIN, { categoryId: old.id });
    const batch = await apply([row(p.sku, "Хлеб", "Белый")]);
    await prisma.category.delete({ where: { id: old.id } });
    const result = await classification.revert(org.user, batch.id, {});
    expect(result.restored).toBe(0);
    expect(result.conflicts[0].reason).toBe("Прежняя категория удалена");
  });
});

describe("isolation, listing and audit", () => {
  it("never sees another organization's products or batches", async () => {
    const theirs = await product(FIN, {}, other.organizationId);
    const res = await preview([row(theirs.sku, "Хлеб")]);
    expect(res.rows[0]).toMatchObject({ status: "REJECT", reason: "Артикул не найден в системе" });

    const mine = await product(FIN);
    const batch = await apply([row(mine.sku, "Торты", "Торты-2")]);
    await expect(classification.revert(other.user, batch.id, {})).rejects.toThrow(/не найден/);
    expect(await classification.listBatches(other.organizationId)).toEqual([]);
    const listed = await classification.listBatches(org.organizationId);
    expect(listed[0]).toMatchObject({ id: batch.id, createdByName: org.user.fullName, status: "APPLIED" });
  });

  it("exercises every audit action of its group", async () => {
    const logged = new Set((await prisma.auditLog.findMany({ where: { organizationId: org.organizationId }, select: { action: true } })).map((a) => a.action));
    expect(AUDIT_ACTION_GROUPS.productClassification.filter((a) => !logged.has(a))).toEqual([]);
  });
});

describe("history freeze (migration 20261004110000)", () => {
  const freezeSql = readFileSync(join(__dirname, "../../prisma/migrations/20261004110000_freeze_sale_item_categories/migration.sql"), "utf8");

  it("stamps legacy sale lines with their category so a later move does not rewrite sales history", async () => {
    const old = await cat("История-старая", FIN);
    const p = await product(FIN, { categoryId: old.id });
    await prisma.stockLevel.create({ data: { organizationId: org.organizationId, locationId: org.storeId, productId: p.id, quantity: 20, minQuantity: 0 } });
    const sale = await services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items: [{ productId: p.id, quantity: 3, unitPrice: 100 }] });
    // Make it a legacy line: a sale from before snapshots existed.
    await prisma.saleItem.updateMany({ where: { saleId: sale.id }, data: { categoryIdSnapshot: null } });

    const before = await prisma.saleItem.findMany({ where: { saleId: sale.id }, select: { id: true, quantity: true, unitPrice: true, subtotal: true } });
    await prisma.$executeRawUnsafe(freezeSql);
    await prisma.$executeRawUnsafe(freezeSql); // safe to run twice
    const item = await prisma.saleItem.findFirstOrThrow({ where: { saleId: sale.id } });
    expect(item.categoryIdSnapshot).toBe(old.id);
    expect(await prisma.saleItem.findMany({ where: { saleId: sale.id }, select: { id: true, quantity: true, unitPrice: true, subtotal: true } })).toEqual(before);

    await apply([row(p.sku, "Пироги", "Сладкие пироги")]);
    const from = new Date(Date.now() - 3_600_000);
    const to = new Date(Date.now() + 3_600_000);
    const qty = async (categoryId: string) => (await services.sales.demandAnalysis(org.user, from, to, { categoryId })).summary.quantity;
    expect(await qty(old.id)).toBe(3); // the sale stays where it was sold
    const pies = await prisma.category.findFirstOrThrow({ where: { organizationId: org.organizationId, name: "Пироги", parentId: null } });
    expect(await qty(pies.id)).toBe(0);
  });

  it("leaves lines that already have a snapshot, and products with no category, alone", async () => {
    const keep = await cat("История-сохранить", FIN);
    const other2 = await cat("История-другая", FIN);
    const p = await product(FIN, { categoryId: other2.id });
    const bare = await product(FIN);
    await prisma.stockLevel.createMany({ data: [p, bare].map((x) => ({ organizationId: org.organizationId, locationId: org.storeId, productId: x.id, quantity: 20, minQuantity: 0 })) });
    const s1 = await services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items: [{ productId: p.id, quantity: 1, unitPrice: 100 }] });
    const s2 = await services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items: [{ productId: bare.id, quantity: 1, unitPrice: 100 }] });
    await prisma.saleItem.updateMany({ where: { saleId: s1.id }, data: { categoryIdSnapshot: keep.id } });
    await prisma.saleItem.updateMany({ where: { saleId: s2.id }, data: { categoryIdSnapshot: null } });
    await prisma.$executeRawUnsafe(freezeSql);
    expect((await prisma.saleItem.findFirstOrThrow({ where: { saleId: s1.id } })).categoryIdSnapshot).toBe(keep.id);
    expect((await prisma.saleItem.findFirstOrThrow({ where: { saleId: s2.id } })).categoryIdSnapshot).toBeNull();
  });

  it("the promotions report groups discounted lines by the category they were sold in", async () => {
    const tort = await cat("Акция-история", FIN);
    const p = await product(FIN, { categoryId: tort.id });
    await prisma.stockLevel.create({ data: { organizationId: org.organizationId, locationId: org.storeId, productId: p.id, quantity: 20, minQuantity: 0 } });
    const promo = await promotions.create(org.user, {
      name: "Акция история",
      locationId: org.storeId,
      startAt: new Date(Date.now() - 60_000).toISOString(),
      endAt: new Date(Date.now() + 3_600_000).toISOString(),
      rules: [{ categoryId: tort.id, discountPercent: 10 }],
    });
    const sale = await services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items: [{ productId: p.id, quantity: 1, unitPrice: 100 }] });
    await prisma.saleItem.updateMany({ where: { saleId: sale.id }, data: { promotionId: promo.id, fullUnitPrice: 100, unitPrice: 90, categoryIdSnapshot: tort.id } });
    await apply([row(p.sku, "Пироги", "Сладкие пироги")]);
    const report = await promotions.report(org.user, promo.id, new Date(Date.now() - 3_600_000), new Date(Date.now() + 3_600_000));
    expect(report.discountByCategory.map((c) => c.categoryName)).toEqual(["Акция-история"]);
  });
});
