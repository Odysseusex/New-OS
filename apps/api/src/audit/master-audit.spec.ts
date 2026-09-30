import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { AUDIT_ACTION_GROUPS } from "./audit";
import { SuppliersService } from "../suppliers/suppliers.service";
import { CustomersService } from "../customers/customers.service";
import { CategoriesService } from "../categories/categories.service";
import { LocationsService } from "../locations/locations.service";
import { VehiclesService } from "../vehicles/vehicles.service";
import { EmployeesService } from "../hr/employees.service";
import { RecipesService } from "../recipes/recipes.service";
import { ProductsService } from "../products/products.service";

// Master data: every edit, archive, restore and hard delete leaves an entry —
// and the entry commits or rolls back together with the change.

const prisma = new PrismaService();
const suppliers = new SuppliersService(prisma);
const customers = new CustomersService(prisma);
const categories = new CategoriesService(prisma);
const locations = new LocationsService(prisma);
const vehicles = new VehiclesService(prisma);
const employees = new EmployeesService(prisma);
const recipes = new RecipesService(prisma);
const products = new ProductsService(prisma);

let org: IsolatedOrg;
const actions = async () =>
  new Set((await prisma.auditLog.findMany({ where: { organizationId: org.organizationId } })).map((e) => e.action));

beforeAll(async () => {
  await prisma.$connect();
  org = await createIsolatedOrg(prisma, "master-audit");
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

describe("master data changes are audited", () => {
  it("suppliers: update, archive, restore, delete", async () => {
    const s = await suppliers.create(org.organizationId, { name: "Поставщик" } as never);
    await suppliers.update(org.organizationId, s.id, { name: "Поставщик 2" } as never, org.user.id);
    await suppliers.archive(org.organizationId, s.id, org.user.id);
    await suppliers.restore(org.organizationId, s.id, org.user.id);
    await suppliers.remove(org.organizationId, s.id, org.user.id);
    const log = await prisma.auditLog.findMany({ where: { organizationId: org.organizationId, entityType: "Supplier" }, orderBy: { createdAt: "asc" } });
    expect(log.map((e) => e.action)).toEqual(["supplier.update", "supplier.archive", "supplier.restore", "supplier.delete"]);
    expect(log[0]).toMatchObject({ actorId: org.user.id });
    expect((log[0].before as { name: string }).name).toBe("Поставщик");
    expect((log[0].after as { name: string }).name).toBe("Поставщик 2");
    // A hard delete keeps what was deleted.
    expect((log[3].before as { name: string }).name).toBe("Поставщик 2");
  });

  it("customers, categories, locations, vehicles, employees", async () => {
    const c = await customers.create(org.organizationId, { name: "Клиент" } as never);
    await customers.update(org.organizationId, c.id, { name: "Клиент 2" } as never, org.user.id);
    await customers.archive(org.organizationId, c.id, org.user.id);
    await customers.restore(org.organizationId, c.id, org.user.id);
    await customers.remove(org.organizationId, c.id, org.user.id);

    const cat = await categories.create(org.organizationId, { name: "Выпечка" } as never);
    await categories.update(org.organizationId, cat.id, { name: "Выпечка 2" } as never, org.user.id);
    await categories.archive(org.organizationId, cat.id, org.user.id);
    await categories.restore(org.organizationId, cat.id, org.user.id);
    await categories.remove(org.organizationId, cat.id, org.user.id);

    const loc = await locations.create(org.organizationId, { name: "Точка Б", type: "STORE", city: "Г", address: "А" } as never);
    await locations.update(org.organizationId, loc.id, { name: "Точка Б2" } as never, org.user.id);
    await locations.archive(org.organizationId, loc.id, org.user.id);
    await locations.restore(org.organizationId, loc.id, org.user.id);
    await locations.remove(org.organizationId, loc.id, org.user.id);

    const v = await vehicles.create(org.organizationId, { name: "Газель", plateNumber: "123ABC" } as never);
    await vehicles.update(org.organizationId, v.id, { name: "Газель 2" } as never, org.user.id);
    await vehicles.archive(org.organizationId, v.id, org.user.id);
    await vehicles.restore(org.organizationId, v.id, org.user.id);
    await vehicles.remove(org.organizationId, v.id, org.user.id);

    const e = await employees.create(org.user, { fullName: "Иван", position: "Пекарь" } as never);
    await employees.update(org.user, e.id, { position: "Старший пекарь" } as never);
    await employees.archive(org.user, e.id);
    await employees.restore(org.user, e.id);
    await employees.remove(org.user, e.id);

    const logged = await actions();
    for (const prefix of ["customer", "category", "location", "vehicle", "employee"]) {
      for (const verb of ["update", "archive", "restore", "delete"]) expect(logged.has(`${prefix}.${verb}`)).toBe(true);
    }
  });

  it("recipes: create, update, archive, restore, delete; products: archive, restore", async () => {
    const mk = (name: string, sku: string, type: string) =>
      prisma.product.create({ data: { organizationId: org.organizationId, name, sku, unit: "PCS", type: type as never, price: 100 } });
    const flour = await mk("Мука", "MA-1", "RAW_MATERIAL");
    const bread = await mk("Хлеб", "MA-2", "FINISHED_GOOD");
    const recipe = await recipes.create(org.user, { productId: bread.id, yieldQuantity: 4, items: [{ ingredientProductId: flour.id, quantity: 2 }] } as never);
    await recipes.update(org.user, recipe.id, { yieldQuantity: 5, items: [{ ingredientProductId: flour.id, quantity: 2 }] } as never);
    await recipes.archive(org.organizationId, recipe.id, org.user.id);
    await recipes.restore(org.organizationId, recipe.id, org.user.id);
    await recipes.remove(org.organizationId, recipe.id, org.user.id);
    await products.archive(org.organizationId, bread.id, org.user.id);
    await products.restore(org.organizationId, bread.id, org.user.id);
    const logged = await actions();
    for (const a of ["recipe.create", "recipe.update", "recipe.archive", "recipe.restore", "recipe.delete", "product.archive", "product.restore"]) {
      expect(logged.has(a)).toBe(true);
    }
    const update = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: org.organizationId, action: "recipe.update" } });
    expect((update.before as { yieldQuantity: string }).yieldQuantity).toBe("4");
    expect((update.after as { yieldQuantity: string }).yieldQuantity).toBe("5");
  });

  it("every master-data audit action has been exercised", async () => {
    const logged = await actions();
    expect(AUDIT_ACTION_GROUPS.master.filter((a) => !logged.has(a))).toEqual([]);
  });

  it("ROLLBACK: if the audit entry cannot be written, the hard delete does not happen either", async () => {
    const s = await suppliers.create(org.organizationId, { name: "Останется" } as never);
    // An actor that does not exist violates the audit table's foreign key.
    await expect(suppliers.remove(org.organizationId, s.id, "no-such-user")).rejects.toThrow();
    expect(await prisma.supplier.findUnique({ where: { id: s.id } })).not.toBeNull();
    await expect(suppliers.archive(org.organizationId, s.id, "no-such-user")).rejects.toThrow();
    expect((await prisma.supplier.findUniqueOrThrow({ where: { id: s.id } })).isActive).toBe(true);
  });
});
