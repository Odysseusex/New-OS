import { readFileSync } from "fs";
import { join } from "path";
import {
  AUDIT_ACTION_GROUPS,
} from "../audit/audit";
import {
  PaymentMethod,
  ProductType,
  STANDARD_CATEGORY_CATALOG,
  Unit,
  buildCategoryTree,
  categoryAcceptsType,
  categoryIdsWithDescendants,
  resolveCategoryRule,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { CategoriesService } from "./categories.service";
import { ProductsService } from "../products/products.service";
import { RecipesService } from "../recipes/recipes.service";
import { PromotionsService } from "../promotions/promotions.service";

// Product classification: TYPE → Category → Subcategory → Product.
//
// Everything here runs against throwaway organizations, so it also proves the
// hierarchy is organization-scoped. The migration's one data-moving statement
// (typing existing categories) is exercised inside a transaction that is rolled
// back, so no other organization's rows are ever changed by the test.

const prisma = new PrismaService();
const services = buildServices(prisma);
const categories = new CategoriesService(prisma);
const products = new ProductsService(prisma);
const recipes = new RecipesService(prisma);
const promotions = new PromotionsService(prisma);
const originalFiscal = process.env.FISCALIZATION_ENABLED;

let org: IsolatedOrg;
let other: IsolatedOrg;

const RAW = ProductType.RAW_MATERIAL;
const PACK = ProductType.PACKAGING;
const FIN = ProductType.FINISHED_GOOD;

let nameCounter = 0;
const uniq = (base: string) => `${base} ${++nameCounter}`;

const top = (type: ProductType, name = uniq("Кат")) => categories.create(org.organizationId, { name, type });
const sub = (parentId: string, name = uniq("Под")) => categories.create(org.organizationId, { name, parentId });
const product = (type: ProductType, categoryId?: string, extra: object = {}) =>
  products.create(org.organizationId, { name: uniq("Товар"), type, unit: Unit.PCS, price: 100, categoryId, ...extra } as never);

beforeAll(async () => {
  await prisma.$connect();
  delete process.env.FISCALIZATION_ENABLED;
  org = await createIsolatedOrg(prisma, "hierarchy");
  other = await createIsolatedOrg(prisma, "hierarchy-other");
});

afterAll(async () => {
  if (originalFiscal !== undefined) process.env.FISCALIZATION_ENABLED = originalFiscal;
  const leftovers = [...(await destroyOrg(prisma, org.organizationId)), ...(await destroyOrg(prisma, other.organizationId))];
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

describe("1. parent → child", () => {
  it("a subcategory belongs to its parent, takes its type, and the parent counts everything below", async () => {
    const parent = await top(RAW, "Бакалея");
    const child = await sub(parent.id, "Мука");
    expect(child.parentId).toBe(parent.id);
    expect(child.type).toBe(RAW);
    expect(parent.parentId).toBeNull();

    await product(RAW, child.id);
    await product(RAW, parent.id);
    const list = await categories.findAllForOrganization(org.organizationId);
    const p = list.find((c) => c.id === parent.id)!;
    const c = list.find((x) => x.id === child.id)!;
    expect(p.productCount).toBe(1); // its own
    expect(p.totalProductCount).toBe(2); // and the subcategory's
    expect(c.productCount).toBe(1);
  });

  it("a sibling name is unique, but the same name can sit under different parents", async () => {
    const a = await top(RAW);
    const b = await top(RAW);
    await sub(a.id, "Другое");
    await expect(sub(a.id, "Другое")).rejects.toThrow(/уже существует/);
    await expect(sub(b.id, "Другое")).resolves.toMatchObject({ name: "Другое", parentId: b.id });
  });

  it("top-level names stay unique across the organization, whatever the type", async () => {
    const name = uniq("Одно");
    await top(RAW, name);
    await expect(top(FIN, name)).rejects.toThrow(/уже существует/);
  });
});

describe("2. organization isolation", () => {
  it("another organization's category cannot be a parent, a filter, or a product's category", async () => {
    const mine = await top(FIN);
    const theirs = await categories.create(other.organizationId, { name: uniq("Чужая"), type: FIN });
    await expect(categories.create(org.organizationId, { name: uniq("X"), parentId: theirs.id })).rejects.toThrow(/не найдена/);
    await expect(categories.idsWithDescendants(org.organizationId, theirs.id)).rejects.toThrow(/не найдена/);
    await expect(product(FIN, theirs.id)).rejects.toThrow(/не найдена/);
    const list = await categories.findAllForOrganization(org.organizationId);
    expect(list.some((c) => c.id === theirs.id)).toBe(false);
    expect(list.some((c) => c.id === mine.id)).toBe(true);
  });
});

describe("3. no circular hierarchy", () => {
  it("a category cannot go under itself or under its own subcategory", async () => {
    const a = await top(FIN);
    const b = await sub(a.id);
    await expect(categories.update(org.organizationId, a.id, { name: a.name, parentId: a.id })).rejects.toThrow(/саму себя/);
    await expect(categories.update(org.organizationId, a.id, { name: a.name, parentId: b.id })).rejects.toThrow(/в её же подкатегорию/);
  });
});

describe("4. depth is two levels", () => {
  it("a subcategory cannot have children, and a category with children cannot become a subcategory", async () => {
    const a = await top(RAW);
    const b = await sub(a.id);
    await expect(sub(b.id)).rejects.toThrow(/два уровня/);

    const c = await top(RAW);
    await expect(categories.update(org.organizationId, a.id, { name: a.name, parentId: c.id })).rejects.toThrow(/есть подкатегории/);
    // …but an empty top-level category can be moved under another, and back out.
    const d = await top(RAW);
    const moved = await categories.update(org.organizationId, d.id, { name: d.name, parentId: c.id });
    expect(moved.parentId).toBe(c.id);
    const back = await categories.update(org.organizationId, d.id, { name: d.name, parentId: null });
    expect(back.parentId).toBeNull();
  });
});

describe("5. category type safety", () => {
  it("a top-level category needs a type; a subcategory takes its parent's and cannot contradict it", async () => {
    await expect(categories.create(org.organizationId, { name: uniq("Без типа") })).rejects.toThrow(/тип/);
    const parent = await top(PACK);
    await expect(categories.create(org.organizationId, { name: uniq("Не тот"), parentId: parent.id, type: RAW })).rejects.toThrow(/того же типа/);
  });

  it("a typed category's type cannot be changed, and it cannot move under another type's category", async () => {
    const raw = await top(RAW);
    const pack = await top(PACK);
    await expect(categories.update(org.organizationId, raw.id, { name: raw.name, type: PACK })).rejects.toThrow(/изменить нельзя/);
    await expect(categories.update(org.organizationId, raw.id, { name: raw.name, parentId: pack.id })).rejects.toThrow(/не совпадают/);
  });
});

describe("6. product type ↔ category type", () => {
  it("rejects every invalid pair and accepts the valid ones", async () => {
    const raw = await top(RAW);
    const pack = await top(PACK);
    const fin = await top(FIN);
    await expect(product(RAW, pack.id)).rejects.toThrow(/Выберите категорию того же типа/);
    await expect(product(FIN, raw.id)).rejects.toThrow(/Выберите категорию того же типа/);
    await expect(product(PACK, fin.id)).rejects.toThrow(/Выберите категорию того же типа/);
    await expect(product(RAW, raw.id)).resolves.toMatchObject({ type: RAW });
    await expect(product(PACK, pack.id)).resolves.toMatchObject({ type: PACK });
    await expect(product(FIN, fin.id)).resolves.toMatchObject({ type: FIN });
  });

  it("changing a product's type is judged against its category, and a rename never re-judges it", async () => {
    const raw = await top(RAW);
    const p = await product(RAW, raw.id);
    await expect(products.update(org.organizationId, p.id, { type: FIN } as never, null)).rejects.toThrow(/Выберите категорию того же типа/);
    // Changing both at once is fine.
    const fin = await top(FIN);
    await expect(products.update(org.organizationId, p.id, { type: FIN, categoryId: fin.id } as never, null)).resolves.toMatchObject({ type: FIN });
    // A product whose category no longer fits (set behind the API's back) can still be renamed.
    await prisma.product.update({ where: { id: p.id }, data: { categoryId: raw.id } });
    await expect(products.update(org.organizationId, p.id, { name: uniq("Новое имя") } as never, null)).resolves.toBeDefined();
  });

  it("an archived category cannot be newly chosen", async () => {
    const c = await top(FIN);
    await categories.archive(org.organizationId, c.id);
    await expect(product(FIN, c.id)).rejects.toThrow(/в архиве/);
  });

  it("a product shows where it sits as «Категория › Подкатегория»", async () => {
    const parent = await top(RAW, uniq("Молочка"));
    const child = await sub(parent.id, "Масло");
    const p = await product(RAW, child.id);
    expect(p.categoryName).toBe(`${parent.name} › Масло`);
  });
});

describe("7. existing (legacy) data keeps working", () => {
  it("an untyped legacy category is open to every type, and only gets a type if what it holds agrees", async () => {
    const legacy = await prisma.category.create({ data: { organizationId: org.organizationId, name: uniq("Старая") } });
    expect(legacy.type).toBeNull();
    expect(categoryAcceptsType(null, RAW) && categoryAcceptsType(null, PACK) && categoryAcceptsType(null, FIN)).toBe(true);
    const a = await product(FIN, legacy.id);
    await expect(products.update(org.organizationId, a.id, { price: 150 } as never, null)).resolves.toMatchObject({ price: 150 });
    await product(RAW, legacy.id); // mixed on purpose

    await expect(categories.update(org.organizationId, legacy.id, { name: legacy.name, type: FIN })).rejects.toThrow(/другого типа/);
    const empty = await prisma.category.create({ data: { organizationId: org.organizationId, name: uniq("Пустая") } });
    const typed = await categories.update(org.organizationId, empty.id, { name: empty.name, type: PACK });
    expect(typed.type).toBe(PACK);
    // An untyped category cannot parent a subcategory until it has a type.
    await expect(sub(legacy.id)).rejects.toThrow(/Сначала задайте тип/);
  });

  it("an existing recipe still works, and packaging can never be an ingredient", async () => {
    const flour = await product(RAW);
    const loaf = await product(FIN);
    const box = await product(PACK);
    const recipe = await recipes.create(org.user, { productId: loaf.id, yieldQuantity: 10, items: [{ ingredientProductId: flour.id, quantity: 2 }] } as never);
    expect(recipe.items).toHaveLength(1);
    const loaf2 = await product(FIN);
    await expect(
      recipes.create(org.user, { productId: loaf2.id, yieldQuantity: 10, items: [{ ingredientProductId: box.id, quantity: 1 }] } as never),
    ).rejects.toThrow(/только сырьё/);
    await expect(recipes.create(org.user, { productId: box.id, yieldQuantity: 1, items: [{ ingredientProductId: flour.id, quantity: 1 }] } as never)).rejects.toThrow(/только для готовой продукции/);
  });
});

describe("8. packaging is a real stock item", () => {
  it("is generated a PKG- code, can be received and written off, and is not sold at the till", async () => {
    const pack = await top(PACK, uniq("Коробки"));
    const box = await products.create(org.organizationId, { name: uniq("Коробка"), type: PACK, unit: Unit.PCS, price: 40, categoryId: pack.id } as never);
    expect(box.sku).toMatch(/^PKG-/);
    await services.inventory.receive(org.user, { locationId: org.storeId, productId: box.id, quantity: 100 });
    await services.inventory.writeOff(org.user, { locationId: org.storeId, productId: box.id, quantity: 5, reason: "Брак", writeOffReason: "DAMAGED" as never });
    const level = await prisma.stockLevel.findFirstOrThrow({ where: { locationId: org.storeId, productId: box.id } });
    expect(level.quantity.toNumber()).toBe(95);
    // Not a till item: the price-list screen (finished goods only) never lists it.
    const prices = await products.locationPrices(org.organizationId, org.storeId);
    expect(prices.some((r) => r.productId === box.id)).toBe(false);
  });
});

describe("9–10. sales, stock and the filter on a parent", () => {
  it("a sale records the category the product had, and a parent filter includes its subcategories", async () => {
    const bread = await top(FIN, uniq("Хлеб"));
    const loaves = await sub(bread.id, "Батон");
    const rolls = await sub(bread.id, "Булочки");
    const other1 = await top(FIN, uniq("Торты"));
    const a = await product(FIN, loaves.id);
    const b = await product(FIN, rolls.id);
    const c = await product(FIN, other1.id);
    for (const p of [a, b, c]) {
      await prisma.stockLevel.create({ data: { organizationId: org.organizationId, locationId: org.storeId, productId: p.id, quantity: 50, minQuantity: 0 } });
    }
    const sale = await services.sales.create(org.user, {
      locationId: org.storeId,
      paymentMethod: PaymentMethod.CASH,
      items: [
        { productId: a.id, quantity: 1, unitPrice: 100 },
        { productId: b.id, quantity: 2, unitPrice: 100 },
        { productId: c.id, quantity: 4, unitPrice: 100 },
      ],
    });
    const lines = await prisma.saleItem.findMany({ where: { saleId: sale.id } });
    expect(lines.find((l) => l.productId === a.id)!.categoryIdSnapshot).toBe(loaves.id);
    expect(lines.find((l) => l.productId === c.id)!.categoryIdSnapshot).toBe(other1.id);

    const from = new Date(Date.now() - 3600_000);
    const to = new Date(Date.now() + 3600_000);
    const qty = async (categoryId: string) => (await services.sales.demandAnalysis(org.user, from, to, { categoryId })).summary.quantity;
    expect(await qty(bread.id)).toBe(3); // the parent: Батон 1 + Булочки 2
    expect(await qty(loaves.id)).toBe(1); // a subcategory: only itself
    expect(await qty(other1.id)).toBe(4);

    // Re-filing a product afterwards does not move that sale between categories…
    await products.update(org.organizationId, b.id, { categoryId: other1.id } as never, null);
    expect(await qty(bread.id)).toBe(3);
    expect(await qty(other1.id)).toBe(4);
    // …but a LEGACY line (no snapshot) follows the product's current category.
    await prisma.saleItem.updateMany({ where: { saleId: sale.id, productId: b.id }, data: { categoryIdSnapshot: null } });
    expect(await qty(bread.id)).toBe(1);
    expect(await qty(other1.id)).toBe(6);

    // Existing stock movements are intact: one SALE movement per line.
    const moves = await prisma.stockMovement.count({ where: { saleId: sale.id } });
    expect(moves).toBe(3);
  });

  it("the shared helpers read the tree the same way", () => {
    const list = [
      { id: "p", parentId: null }, { id: "c1", parentId: "p" }, { id: "c2", parentId: "p" }, { id: "x", parentId: null },
    ];
    expect(categoryIdsWithDescendants(list, "p").sort()).toEqual(["c1", "c2", "p"]);
    expect(categoryIdsWithDescendants(list, "c1")).toEqual(["c1"]);
    const rules = new Map([["p", 20], ["c2", 50]]);
    const parentOf = (id: string) => list.find((c) => c.id === id)?.parentId;
    expect(resolveCategoryRule(rules, "c1", parentOf)).toBe(20); // covered by the parent's rule
    expect(resolveCategoryRule(rules, "c2", parentOf)).toBe(50); // its own rule wins
    expect(resolveCategoryRule(rules, "x", parentOf)).toBeUndefined();
    expect(resolveCategoryRule(rules, null, parentOf)).toBeUndefined();
  });
});

describe("11. inventory: a stocktake of a parent counts its subcategories", () => {
  it("includes products in the subcategories", async () => {
    const parent = await top(RAW, uniq("Бакалея"));
    const child = await sub(parent.id, "Сахар");
    const unrelated = await top(RAW, uniq("Яйца"));
    const inChild = await product(RAW, child.id);
    const inUnrelated = await product(RAW, unrelated.id);
    const st = await services.stocktake.create(org.user, { locationId: org.storeId, categoryId: parent.id } as never);
    const ids = st.lines.map((l) => l.productId);
    expect(ids).toContain(inChild.id);
    expect(ids).not.toContain(inUnrelated.id);
    expect(st.lines.find((l) => l.productId === inChild.id)!.categoryName).toBe(`${parent.name} › Сахар`);
    await services.stocktake.cancel(org.user, st.id, "Тест");
  });
});

describe("12. coupons: a rule on a parent covers its subcategories", () => {
  it("discounts a product in a subcategory, and a rule on the subcategory itself wins", async () => {
    const parent = await top(FIN, uniq("Выпечка"));
    const child = await sub(parent.id, "Круассаны");
    const p = await product(FIN, child.id);
    await prisma.stockLevel.create({ data: { organizationId: org.organizationId, locationId: org.storeId, productId: p.id, quantity: 50, minQuantity: 0 } });
    const run = async (rules: { categoryId: string; discountPercent: number }[]) => {
      const promo = await promotions.create(org.user, {
        name: uniq("Акция"),
        locationId: org.storeId,
        startAt: new Date(Date.now() - 60_000).toISOString(),
        endAt: new Date(Date.now() + 3_600_000).toISOString(),
        rules,
      });
      const { codes } = await promotions.generateCoupons(org.user, promo.id, 1);
      const sale = await services.sales.create(org.user, {
        locationId: org.storeId,
        paymentMethod: PaymentMethod.CASH,
        couponCode: codes[0],
        items: [{ productId: p.id, quantity: 1, unitPrice: 100 }],
      } as never);
      return Number(sale.totalAmount);
    };
    expect(await run([{ categoryId: parent.id, discountPercent: 20 }])).toBe(80);
    expect(await run([{ categoryId: parent.id, discountPercent: 20 }, { categoryId: child.id, discountPercent: 50 }])).toBe(50);
  });
});

describe("13. archive and delete", () => {
  it("archiving a category archives its subcategories; a subcategory cannot be restored under an archived parent", async () => {
    const parent = await top(FIN);
    const child = await sub(parent.id);
    await categories.archive(org.organizationId, parent.id);
    const hidden = await categories.findAllForOrganization(org.organizationId);
    expect(hidden.some((c) => c.id === parent.id || c.id === child.id)).toBe(false);
    const all = await categories.findAllForOrganization(org.organizationId, true);
    expect(all.find((c) => c.id === child.id)!.isActive).toBe(false);
    await expect(categories.restore(org.organizationId, child.id)).rejects.toThrow(/Сначала восстановите/);
    await categories.restore(org.organizationId, parent.id);
    // Restoring the parent does not silently bring the subcategory back.
    expect((await categories.findAllForOrganization(org.organizationId, true)).find((c) => c.id === child.id)!.isActive).toBe(false);
    await expect(categories.restore(org.organizationId, child.id)).resolves.toMatchObject({ isActive: true });
  });

  it("cannot delete a category with products, with subcategories, or used by a promotion", async () => {
    const withProducts = await top(FIN);
    await product(FIN, withProducts.id);
    await expect(categories.remove(org.organizationId, withProducts.id)).rejects.toThrow(/есть товары/);

    const withChild = await top(FIN);
    const child = await sub(withChild.id);
    await expect(categories.remove(org.organizationId, withChild.id)).rejects.toThrow(/есть подкатегории/);

    const inPromo = await top(FIN);
    await promotions.create(org.user, {
      name: uniq("Акция"),
      locationId: org.storeId,
      startAt: new Date().toISOString(),
      endAt: new Date(Date.now() + 3_600_000).toISOString(),
      rules: [{ categoryId: inPromo.id, discountPercent: 10 }],
    });
    await expect(categories.remove(org.organizationId, inPromo.id)).rejects.toThrow(/правилах акций/);

    // An empty leaf, and then its now-empty parent, can go.
    await expect(categories.remove(org.organizationId, child.id)).resolves.toEqual({ deleted: true });
    await expect(categories.remove(org.organizationId, withChild.id)).resolves.toEqual({ deleted: true });
  });
});

describe("14. the standard catalogue", () => {
  it("previews without writing, applies once, and is idempotent", async () => {
    const before = await prisma.category.count({ where: { organizationId: org.organizationId } });
    const preview = await categories.previewStandardCatalog(org.organizationId);
    expect(preview.applied).toBe(false);
    expect(await prisma.category.count({ where: { organizationId: org.organizationId } })).toBe(before);
    const sky = STANDARD_CATEGORY_CATALOG.length;
    const subs = STANDARD_CATEGORY_CATALOG.reduce((n, c) => n + c.subcategories.length, 0);
    expect(preview.categoriesCreated + preview.branches.filter((b) => b.categoryStatus !== "created").length).toBe(sky);
    expect(preview.subcategoriesCreated).toBeLessThanOrEqual(subs);
  });

  it("adds the catalogue under its types, keeps existing categories, and skips a clashing branch", async () => {
    const isolated = await createIsolatedOrg(prisma, "catalogue");
    try {
      const orgId = isolated.organizationId;
      // «Хлеб» already exists and is finished goods → reused. «Бакалея» exists with no type → left alone.
      const bread = await prisma.category.create({ data: { organizationId: orgId, name: "Хлеб", type: FIN } });
      const legacyGrocery = await prisma.category.create({ data: { organizationId: orgId, name: "Бакалея" } });
      const legacyProduct = await prisma.product.create({ data: { organizationId: orgId, name: "Мука", sku: "L-1", unit: "KG", type: RAW, price: 100, categoryId: legacyGrocery.id } });

      const result = await categories.applyStandardCatalog(orgId, isolated.user.id);
      expect(result.applied).toBe(true);
      expect(result.branches.find((b) => b.category === "Хлеб")!.categoryStatus).toBe("reused");
      expect(result.branches.find((b) => b.category === "Бакалея")!.categoryStatus).toBe("skipped");

      const tops = await prisma.category.findMany({ where: { organizationId: orgId, parentId: null } });
      const byName = new Map(tops.map((c) => [c.name, c]));
      // Existing rows are exactly as they were.
      expect(byName.get("Хлеб")!.id).toBe(bread.id);
      expect(byName.get("Бакалея")).toMatchObject({ id: legacyGrocery.id, type: null });
      expect(await prisma.product.findUniqueOrThrow({ where: { id: legacyProduct.id } })).toMatchObject({ categoryId: legacyGrocery.id });
      expect(await prisma.category.count({ where: { organizationId: orgId, parentId: legacyGrocery.id } })).toBe(0);
      // New branches carry their type, and their subcategories inherit it.
      const milk = byName.get("Молочная продукция")!;
      expect(milk.type).toBe(RAW);
      const butter = await prisma.category.findFirst({ where: { organizationId: orgId, parentId: milk.id, name: "Масло сливочное" } });
      expect(butter?.type).toBe(RAW);
      expect(byName.get("Коробки")!.type).toBe(PACK);
      expect((await prisma.category.findFirst({ where: { organizationId: orgId, parentId: bread.id, name: "Батон" } }))?.type).toBe(FIN);
      // Names repeated under several parents («Другое») are fine.
      expect(await prisma.category.count({ where: { organizationId: orgId, name: "Другое" } })).toBeGreaterThan(5);

      // Idempotent: nothing more to add, nothing duplicated.
      const total = await prisma.category.count({ where: { organizationId: orgId } });
      const again = await categories.applyStandardCatalog(orgId, isolated.user.id);
      expect(again.categoriesCreated + again.subcategoriesCreated).toBe(0);
      expect(await prisma.category.count({ where: { organizationId: orgId } })).toBe(total);

      // Audited, and the group of audit actions is exercised.
      const logged = new Set((await prisma.auditLog.findMany({ where: { organizationId: orgId }, select: { action: true } })).map((a) => a.action));
      expect(AUDIT_ACTION_GROUPS.catalog.filter((a) => !logged.has(a))).toEqual([]);

      // And the tree reads back as Type → Category → Subcategory.
      const tree = buildCategoryTree(await categories.findAllForOrganization(orgId), [RAW, PACK, FIN]);
      expect(tree.map((g) => g.type)).toEqual([RAW, PACK, FIN, null]);
      const grocery = tree.find((g) => g.type === null)!.nodes[0];
      expect(grocery.category.id).toBe(legacyGrocery.id);
    } finally {
      await destroyOrg(prisma, isolated.organizationId);
    }
  });
});

describe("15. the migration's typing of existing categories", () => {
  // The one statement that touches existing rows, read straight from the
  // migration file and run inside a transaction that is always rolled back.
  const sql = readFileSync(join(__dirname, "../../prisma/migrations/20261003090100_category_hierarchy/migration.sql"), "utf8");
  const statement = sql.slice(sql.indexOf("-- [deterministic-typing]")).split(";")[0].replace("-- [deterministic-typing]", "").trim();

  it("types a category from the products it holds, never from its name, and moves nothing", async () => {
    const stamp = Date.now();
    const id = (s: string) => `mig-${stamp}-${s}`;
    class Rollback extends Error {}
    await expect(
      prisma.$transaction(async (tx) => {
        const orgId = org.organizationId;
        const mk = (key: string, name: string) => tx.category.create({ data: { id: id(key), organizationId: orgId, name } });
        await mk("fin", "Хлеб");        // only finished goods
        await mk("raw", "Мука");        // only raw materials
        await mk("mixed", "Разное");    // both
        await mk("empty", "Пустая");    // nothing
        await mk("named", "Упаковка");  // a packaging-sounding NAME, but holds finished goods
        const add = (key: string, cat: string, type: "RAW_MATERIAL" | "FINISHED_GOOD") =>
          tx.product.create({ data: { id: id(key), organizationId: orgId, name: key, sku: id(key), unit: "PCS", type, price: 1, categoryId: id(cat) } });
        await add("p1", "fin", "FINISHED_GOOD");
        await add("p2", "raw", "RAW_MATERIAL");
        await add("p3", "mixed", "FINISHED_GOOD");
        await add("p4", "mixed", "RAW_MATERIAL");
        await add("p5", "named", "FINISHED_GOOD");
        const before = await tx.product.findMany({ where: { id: { startsWith: `mig-${stamp}` } }, select: { id: true, categoryId: true, type: true }, orderBy: { id: "asc" } });

        await tx.$executeRawUnsafe(statement);

        const typeOf = async (key: string) => (await tx.category.findUniqueOrThrow({ where: { id: id(key) } })).type;
        expect(await typeOf("fin")).toBe(FIN);
        expect(await typeOf("raw")).toBe(RAW);
        expect(await typeOf("mixed")).toBeNull();
        expect(await typeOf("empty")).toBeNull();
        expect(await typeOf("named")).toBe(FIN); // by what it holds, not by its name
        const after = await tx.product.findMany({ where: { id: { startsWith: `mig-${stamp}` } }, select: { id: true, categoryId: true, type: true }, orderBy: { id: "asc" } });
        expect(after).toEqual(before); // every product keeps its category and its type
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
    expect(await prisma.category.count({ where: { id: { startsWith: `mig-${stamp}` } } })).toBe(0);
  });
});

describe("tree shape for the screens", () => {
  it("every type is a group even when empty; legacy appears only when present; a hidden parent does not hide its children", () => {
    const mk = (id: string, type: ProductType | null, parentId: string | null = null) =>
      ({ id, name: id, type, parentId, sortOrder: null, isActive: true, productCount: 0, totalProductCount: 0 });
    const tree = buildCategoryTree([mk("a", RAW), mk("b", RAW, "a"), mk("orphan", RAW, "gone")], [RAW, PACK, FIN]);
    expect(tree.map((g) => g.type)).toEqual([RAW, PACK, FIN]);
    expect(tree[0].nodes.map((n) => n.category.id)).toEqual(["a", "orphan"]);
    expect(tree[0].nodes[0].children.map((c) => c.id)).toEqual(["b"]);
  });
});
