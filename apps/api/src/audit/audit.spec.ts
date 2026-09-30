import { CostBehavior, FinanceCategoryKind, NegativeStockPolicy, Role, Unit } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import * as audit from "./audit";
import { AuditController } from "./audit.controller";
import { ProductsService } from "../products/products.service";
import { UsersService } from "../users/users.service";
import { FinanceCategoriesService } from "../finance/finance-categories.service";
import { CashAccountsService } from "../finance/cash-accounts.service";
import { FinanceSetupService } from "../finance/finance-setup.service";
import { AccountingPolicyService } from "../finance/accounting-policy.service";

// The audit log: every wired mutation writes exactly one entry, in the SAME
// transaction as the change — so a failure on either side leaves neither.

const prisma = new PrismaService();
const services = buildServices(prisma);
const products = new ProductsService(prisma);
const users = new UsersService(prisma);
const categories = new FinanceCategoriesService(prisma);
const accounts = new CashAccountsService(prisma);
const setup = new FinanceSetupService(prisma, services.finance);
const policy = new AccountingPolicyService(prisma);

let org: IsolatedOrg;
let productId: string;
let supplierId: string;

const entries = (where: object = {}) =>
  prisma.auditLog.findMany({ where: { organizationId: org.organizationId, ...where }, orderBy: { createdAt: "asc" } });

beforeAll(async () => {
  await prisma.$connect();
  org = await createIsolatedOrg(prisma, "audit");
  productId = (
    await prisma.product.create({
      data: { organizationId: org.organizationId, name: "Хлеб", sku: "A-1", unit: Unit.PCS, type: "FINISHED_GOOD", price: 500 },
    })
  ).id;
  supplierId = (await prisma.supplier.create({ data: { organizationId: org.organizationId, name: "Поставщик" } })).id;
});

afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

afterEach(() => jest.restoreAllMocks());

describe("audit log", () => {
  it("records a product price change with actor, before and after", async () => {
    await products.update(org.organizationId, productId, { price: 550 }, org.user.id);
    const [entry] = await entries({ action: "product.update", entityId: productId });
    expect(entry.actorId).toBe(org.user.id);
    expect(entry.entityType).toBe("Product");
    // Decimals are stored exactly as strings, never as rounded floats.
    expect(entry.before).toMatchObject({ price: "500", name: "Хлеб" });
    expect(entry.after).toMatchObject({ price: "550" });
  });

  it("ROLLBACK: if the audit write fails, the change itself is rolled back", async () => {
    jest.spyOn(audit, "recordAudit").mockRejectedValueOnce(new Error("audit write failed"));
    const countBefore = (await entries()).length;

    await expect(products.update(org.organizationId, productId, { price: 999 }, org.user.id)).rejects.toThrow(
      "audit write failed",
    );
    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.price.toNumber()).toBe(550);
    expect((await entries()).length).toBe(countBefore);
  });

  it("ROLLBACK: if the transaction fails after the audit entry was written, the entry is rolled back too", async () => {
    const real = jest.requireActual<typeof audit>("./audit").recordAudit;
    jest.spyOn(audit, "recordAudit").mockImplementationOnce(async (tx, entry) => {
      await real(tx, entry);
      throw new Error("failure after the audit row was inserted");
    });
    const countBefore = (await entries()).length;

    await expect(products.update(org.organizationId, productId, { price: 777 }, org.user.id)).rejects.toThrow(
      "failure after the audit row",
    );
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).price.toNumber()).toBe(550);
    expect((await entries()).length).toBe(countBefore);
  });

  it("ROLLBACK on a document: a failed audit leaves the purchase order PLACED and the stock untouched", async () => {
    const po = await services.procurement.create(org.user, {
      supplierId,
      locationId: org.storeId,
      items: [{ productId, quantity: 5, unitCost: 100 }],
    });
    jest.spyOn(audit, "recordAudit").mockRejectedValueOnce(new Error("audit write failed"));

    await expect(services.procurement.receive(org.user, po.id)).rejects.toThrow("audit write failed");
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe("PLACED");
    expect(await prisma.stockMovement.count({ where: { purchaseOrderId: po.id } })).toBe(0);

    await services.procurement.receive(org.user, po.id);
    expect(await entries({ action: "purchaseOrder.receive", entityId: po.id })).toHaveLength(1);
  });

  it("never stores a password hash — only the fact that the password changed", async () => {
    const created = await users.create(org.user, {
      fullName: "Кассир Тест",
      email: `cashier-${Date.now()}@iso.test`,
      password: "secret-1",
      role: Role.CASHIER,
      locationId: org.storeId,
    });
    await users.update(org.user, created.id, { role: Role.STORE_MANAGER, password: "secret-2" });

    const logged = await entries({ entityId: created.id });
    expect(logged.map((e) => e.action)).toEqual(["user.create", "user.update"]);
    const text = JSON.stringify(logged);
    expect(text).not.toMatch(/passwordHash|secret-|\$2[aby]\$/);
    expect(logged[1].before).toMatchObject({ role: "CASHIER" });
    expect(logged[1].after).toMatchObject({ role: "STORE_MANAGER", passwordChanged: true });
  });

  it("every wired mutation writes exactly one entry with its action", async () => {
    const actor = org.user.id;
    const orgId = org.organizationId;

    const category = await categories.create(orgId, { name: "Аренда", kind: FinanceCategoryKind.EXPENSE }, actor);
    await categories.update(orgId, category.id, { name: "Аренда помещения" }, actor);
    await categories.setCostBehavior(orgId, category.id, CostBehavior.FIXED, actor);
    await categories.archive(orgId, category.id, actor);
    await categories.restore(orgId, category.id, actor);
    const spare = await categories.create(orgId, { name: "Разное", kind: FinanceCategoryKind.EXPENSE }, actor);
    await categories.remove(orgId, spare.id, actor);

    const account = await accounts.create(org.user, { name: "Второй банк", type: "BANK" as never });
    await accounts.update(orgId, account.id, { name: "Второй банк (новый)" }, actor);
    await accounts.setDefault(org.user, account.id);
    await accounts.archive(orgId, org.cashAccountId, actor);
    await accounts.restore(orgId, org.cashAccountId, actor);

    await products.setLocationPrice(orgId, org.storeId, productId, 600, actor);
    await products.clearLocationPrice(orgId, org.storeId, productId, actor);
    const unused = await prisma.product.create({
      data: { organizationId: orgId, name: "Лишний", sku: "A-2", unit: Unit.PCS, type: "FINISHED_GOOD", price: 1 },
    });
    await products.remove(orgId, unused.id, actor);

    const draft = await services.finance.createExpense(org.user, { amount: 100, paidImmediately: false });
    await services.finance.confirmExpense(orgId, draft.id, actor);
    const toCancel = await services.finance.createExpense(org.user, { amount: 50, paidImmediately: false });
    await services.finance.cancelExpense(orgId, toCancel.id, actor);

    const cancelledPo = await services.procurement.create(org.user, {
      supplierId,
      locationId: org.storeId,
      items: [{ productId, quantity: 1, unitCost: 10 }],
    });
    await services.procurement.cancel(org.user, cancelledPo.id);

    const invoice = await services.invoices.create(org.user, {
      supplierId,
      locationId: org.storeId,
      number: "N-1",
      items: [{ productId, quantity: 1, unitCost: 10 }],
    });
    await services.invoices.confirm(org.user, invoice.id);
    const draftInvoice = await services.invoices.create(org.user, {
      supplierId,
      locationId: org.storeId,
      number: "N-2",
      items: [{ productId, quantity: 1, unitCost: 10 }],
    });
    await services.invoices.cancel(org.user, draftInvoice.id);

    const recipe = await prisma.recipe.create({ data: { organizationId: orgId, productId, yieldQuantity: 1 } });
    const b1 = await services.production.create(org.user, { locationId: org.storeId, recipeId: recipe.id, plannedQuantity: 1 });
    await services.production.cancel(org.user, b1.id, {});
    const b2 = await services.production.create(org.user, { locationId: org.storeId, recipeId: recipe.id, plannedQuantity: 1 });
    await services.production.remove(org.user, b2.id);

    await setup.reconcileInvoices(org.user, { items: [{ invoiceId: invoice.id, amountPaid: 10 }] });
    await setup.complete(org.user);

    const counts = new Map<string, number>();
    for (const e of await entries()) counts.set(e.action, (counts.get(e.action) ?? 0) + 1);
    const expectOnce: audit.AuditAction[] = [
      "financeCategory.update",
      "financeCategory.costBehavior",
      "financeCategory.archive",
      "financeCategory.restore",
      "financeCategory.delete",
      "cashAccount.create",
      "cashAccount.update",
      "cashAccount.setDefault",
      "cashAccount.archive",
      "cashAccount.restore",
      "product.locationPrice.set",
      "product.locationPrice.clear",
      "product.delete",
      "expense.confirm",
      "expense.cancel",
      "purchaseOrder.cancel",
      "invoice.confirm",
      "invoice.cancel",
      "productionBatch.cancel",
      "productionBatch.delete",
      "financeSetup.reconcileInvoices",
      "financeSetup.complete",
    ];
    for (const action of expectOnce) expect([action, counts.get(action)]).toEqual([action, 1]);
    expect(counts.get("financeCategory.create")).toBe(2);
    for (const e of await entries()) expect(e.actorId).toBe(actor);
  });

  it("the read endpoint only shows the caller's own organization", async () => {
    const other = await createIsolatedOrg(prisma, "audit-other");
    try {
      await prisma.auditLog.create({
        data: { organizationId: other.organizationId, action: "product.update", entityType: "Product", entityId: "x" },
      });
      const controller = new AuditController(prisma);
      const mine = await controller.list(org.user, {});
      expect(mine.length).toBeGreaterThan(0);
      expect(mine.every((e) => e.entityId !== "x")).toBe(true);
      const filtered = await controller.list(org.user, { entityType: "Product", entityId: productId });
      expect(filtered.every((e) => e.entityId === productId)).toBe(true);
      expect(filtered[0].actorName).toBe("Тест Владелец");
    } finally {
      expect(await destroyOrg(prisma, other.organizationId)).toEqual([]);
    }
  });
});

describe("accounting policy", () => {
  it("reports current behaviour, not an approved policy, when nothing is approved — and GET creates nothing", async () => {
    const dto = await policy.get(org.organizationId);
    expect(dto.negativeStockPolicy).toEqual({
      value: NegativeStockPolicy.BLOCK,
      source: "CURRENT_BEHAVIOR",
      approvedAt: null,
      approvedByName: null,
    });
    for (const field of ["writeOffPresentation", "depreciationMethod", "capitalizationThreshold"] as const) {
      expect(dto[field]).toMatchObject({ value: null, source: "NOT_CONFIGURED" });
    }
    expect(await prisma.accountingPolicy.count({ where: { organizationId: org.organizationId } })).toBe(0);
  });

  it("an approved value records who approved it, and the change is audited with its reason", async () => {
    const dto = await policy.update(org.user, { capitalizationThreshold: 150000, reason: "Решение собственника" });
    expect(dto.capitalizationThreshold).toMatchObject({ value: 150000, source: "APPROVED", approvedByName: "Тест Владелец" });
    expect(dto.depreciationMethod.source).toBe("NOT_CONFIGURED");

    const [entry] = await entries({ action: "accountingPolicy.update" });
    expect(entry.reason).toBe("Решение собственника");
    expect(entry.before).toEqual({ capitalizationThreshold: null });
    expect(entry.after).toEqual({ capitalizationThreshold: 150000 });
  });

  it("null withdraws an approval; an unchanged value is refused as a no-op", async () => {
    await expect(
      policy.update(org.user, { capitalizationThreshold: 150000, reason: "Повтор" }),
    ).rejects.toThrow("изменений нет");
    const dto = await policy.update(org.user, { capitalizationThreshold: null, reason: "Отзыв" });
    expect(dto.capitalizationThreshold).toMatchObject({ value: null, source: "NOT_CONFIGURED" });
    expect(await entries({ action: "accountingPolicy.update" })).toHaveLength(2);
  });

  it("ROLLBACK: a failed audit write leaves the policy unchanged", async () => {
    jest.spyOn(audit, "recordAudit").mockRejectedValueOnce(new Error("audit write failed"));
    await expect(
      policy.update(org.user, { depreciationMethod: "STRAIGHT_LINE" as never, reason: "Тест" }),
    ).rejects.toThrow("audit write failed");
    expect((await policy.get(org.organizationId)).depreciationMethod.source).toBe("NOT_CONFIGURED");
  });
});

// Runs last: by now the policy tests have exercised accountingPolicy.update.
describe("audit coverage", () => {
  it("covers the remaining actions, so every action in AUDIT_ACTIONS has been exercised", async () => {
    const extra = await users.create(org.user, {
      fullName: "Пекарь Тест",
      email: `baker-${Date.now()}@iso.test`,
      password: "secret-3",
      role: Role.PRODUCTION_STAFF,
      locationId: org.storeId,
    });
    await users.archive(org.user, extra.id);
    await users.restore(org.user, extra.id);
    const doomed = await prisma.product.create({
      data: { organizationId: org.organizationId, name: "Дубль", sku: "A-3", unit: Unit.PCS, type: "FINISHED_GOOD", price: 1 },
    });
    await products.forceRemove(org.organizationId, doomed.id, org.user.id);

    const logged = new Set((await entries()).map((e) => e.action));
    const missing = audit.AUDIT_ACTIONS.filter((a) => !logged.has(a));
    expect(missing).toEqual([]);
  });
});
