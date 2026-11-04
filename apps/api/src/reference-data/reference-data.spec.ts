import { ProductType, Role } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { ProductsService } from "../products/products.service";
import { CustomersService } from "../customers/customers.service";
import { SuppliersService } from "../suppliers/suppliers.service";
import { AUDIT_ACTION_GROUPS } from "../audit/audit";
import { ReferenceDataService } from "./reference-data.service";

// Directories loaded from the Excel template and written back out: preview
// writes nothing, apply goes through each module's own create/update, the same
// file loaded twice changes nothing more. Own throwaway organization.

const prisma = new PrismaService();
const service = new ReferenceDataService(prisma, new ProductsService(prisma), new CustomersService(prisma), new SuppliersService(prisma));
let org: IsolatedOrg;
let flourCategoryId: string;

beforeAll(async () => {
  await prisma.$connect();
  org = await createIsolatedOrg(prisma, "refdata");
  const id = org.organizationId;
  const top = await prisma.category.create({ data: { organizationId: id, name: "Бакалея", type: ProductType.RAW_MATERIAL } });
  flourCategoryId = (await prisma.category.create({ data: { organizationId: id, name: "Мука", type: ProductType.RAW_MATERIAL, parentId: top.id } })).id;
  await prisma.product.create({ data: { organizationId: id, name: "Сахар", sku: "RD-1", unit: "KG", type: ProductType.RAW_MATERIAL, price: 300 } });
  await prisma.customer.create({ data: { organizationId: id, name: "Мерей", bin: "123456789012" } });
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

const productGrid = [
  ["Номенклатура"],
  ["Артикул", "Наименование", "Тип", "Категория", "Ед. изм.", "Цена, ₸", "Штрихкод", "Мин. остаток", "Лишняя"],
  ["RD-1", "Сахар", "", "", "", "320", "", "5", "x"],
  ["", "Мука в/с", "Сырьё", "Бакалея › Мука", "кг", "450,50", "", "", ""],
  ["", "Батон", "Готовая продукция", "", "шт", 250, "4870001", "", ""],
  ["", "Пирожок", "Пицца", "", "шт", "", "", "", ""],
  ["", "Пончик", "Готовая продукция", "Бакалея › Мука", "шт", "", "", "", ""],
  ["", "", "", "", "", "", "", "", ""],
];

describe("reference data from Excel", () => {
  it("previews products without writing anything", async () => {
    const before = await prisma.product.count({ where: { organizationId: org.organizationId } });
    const preview = await service.preview(org.user, "products", productGrid);
    expect(await prisma.product.count({ where: { organizationId: org.organizationId } })).toBe(before);
    expect(preview.ignoredHeaders).toEqual(["Лишняя"]);
    expect(preview.counts).toEqual({ CREATE: 2, UPDATE: 1, UNCHANGED: 0, ERROR: 2 });
    const [sugar, flour, , pie, donut] = preview.rows;
    expect(sugar).toMatchObject({ row: 3, action: "UPDATE", key: "RD-1" });
    expect(sugar.changes).toEqual([
      { field: "Цена, ₸", before: "300", after: "320" },
      { field: "Мин. остаток", before: "0", after: "5" },
    ]);
    expect(flour.changes).toContainEqual({ field: "Категория", before: null, after: "Бакалея › Мука" });
    expect(pie.error).toMatch(/Непонятный тип/);
    expect(donut.error).toMatch(/не для типа/);
  });

  it("applies the good rows, and the same file again changes nothing", async () => {
    const result = await service.apply(org.user, "products", productGrid);
    expect(result).toMatchObject({ created: 2, updated: 1, unchanged: 0 });
    expect(result.failed.map((r) => r.row)).toEqual([6, 7]);
    const flour = await prisma.product.findFirstOrThrow({ where: { organizationId: org.organizationId, name: "Мука в/с" } });
    expect(flour).toMatchObject({ categoryId: flourCategoryId, unit: "KG" });
    expect(flour.price.toNumber()).toBe(450.5);
    expect(flour.sku).toMatch(/^ING-/);
    const sugar = await prisma.product.findFirstOrThrow({ where: { organizationId: org.organizationId, sku: "RD-1" } });
    expect(sugar.price.toNumber()).toBe(320);

    const again = await service.preview(org.user, "products", productGrid);
    expect(again.counts).toMatchObject({ CREATE: 0, UPDATE: 0, UNCHANGED: 3 });
  });

  it("round-trips the export: the exported sheet loads back unchanged", async () => {
    const out = await service.export(org.user, "products");
    expect(out.headers[0]).toBe("Артикул");
    const back = await service.preview(org.user, "products", [out.headers, ...out.rows]);
    expect(back.counts).toMatchObject({ CREATE: 0, UPDATE: 0, ERROR: 0 });
  });

  it("matches customers by БИН, else by name, and keeps leading zeros of an ИИН typed as a number", async () => {
    const phoneOnly = await service.preview(org.user, "customers", [["Наименование", "Телефон"], ["Столовая", 77019998877]]);
    expect(phoneOnly.rows[0].changes).toContainEqual({ field: "Телефон", before: null, after: "+77019998877" });
    const grid = [
      ["Наименование", "БИН/ИИН", "Телефон", "Отсрочка, дней", "Кредитный лимит, ₸", "Email"],
      ["ТОО Мерей", "1234 5678 9012", "+77010000000", "7", "", ""],
      ["ИП Асель", 12345678901, "", "", "100000", ""],
      ["Кафе", "", "", "400", "", ""],
      ["Столовая", 123, 77019998877, "", "", ""],
      ["Ресторан", "", "", "", "", "не-почта"],
    ];
    const preview = await service.preview(org.user, "customers", grid);
    expect(preview.rows.map((r) => r.action)).toEqual(["UPDATE", "CREATE", "ERROR", "ERROR", "ERROR"]);
    expect(preview.rows[3].error).toMatch(/12 цифр/);
    expect(preview.rows[0].changes.map((c) => c.field)).toEqual(["Наименование", "Телефон", "Отсрочка, дней"]);
    expect(preview.rows[1].key).toBe("012345678901");

    await service.apply(org.user, "customers", grid);
    const merey = await prisma.customer.findFirstOrThrow({ where: { organizationId: org.organizationId, bin: "123456789012" } });
    expect(merey).toMatchObject({ name: "ТОО Мерей", phone: "+77010000000", paymentTermDays: 7 });
    const asel = await prisma.customer.findFirstOrThrow({ where: { organizationId: org.organizationId, bin: "012345678901" } });
    expect(asel.creditLimit?.toNumber()).toBe(100000);
  });

  it("loads suppliers, and refuses a directory the role may not edit", async () => {
    const result = await service.apply(org.user, "suppliers", [["Наименование", "БИН/ИИН"], ["Мельница", "111122223333"]]);
    expect(result.created).toBe(1);
    const cashier = { ...org.user, role: Role.CASHIER };
    await expect(service.preview(cashier, "products", productGrid)).rejects.toThrow(/Недостаточно прав/);
    await expect(service.preview(org.user, "suppliers", [["Что-то"], ["x"]])).rejects.toThrow(/заголовков/);

    const logged = new Set((await prisma.auditLog.findMany({ where: { organizationId: org.organizationId } })).map((e) => e.action));
    expect(AUDIT_ACTION_GROUPS.referenceImport.filter((a) => !logged.has(a))).toEqual([]);
  });
});
