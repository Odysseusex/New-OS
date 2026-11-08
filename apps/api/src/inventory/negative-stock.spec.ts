import { BalanceStatus, PaymentMethod, ProductType, Unit } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { BalanceService } from "../finance/balance/balance.service";
import { FinanceSetupService } from "../finance/finance-setup.service";

// Starting to work before the first stock count (a new shop and workshop opened the same day):
// with Organization.allowNegativeStock the till and production go below zero; the first count,
// approved as «Начальные остатки», books what was really there as the opening stock — not as a
// gain — but as part of the opening position declared at the finance launch (made on the first
// morning, before any of it), as if the count had been made then.

const prisma = new PrismaService();
const services = buildServices(prisma);
const balance = new BalanceService(prisma, services.finance);
let org: IsolatedOrg;
let flourId: string;
let breadId: string;
let cakeId: string;
let recipeId: string;
let supplierId: string;
const from = new Date(Date.now() - 60_000);

beforeAll(async () => {
  await prisma.$connect();
  org = await createIsolatedOrg(prisma, "negative-stock");
  const id = org.organizationId;
  flourId = (await prisma.product.create({ data: { organizationId: id, name: "Мука", sku: "NS-1", type: ProductType.RAW_MATERIAL, price: 100, unit: Unit.KG } })).id;
  breadId = (await prisma.product.create({ data: { organizationId: id, name: "Хлеб", sku: "NS-2", type: ProductType.FINISHED_GOOD, price: 300, unit: Unit.PCS } })).id;
  cakeId = (await prisma.product.create({ data: { organizationId: id, name: "Пирожное", sku: "NS-3", type: ProductType.FINISHED_GOOD, price: 500, unit: Unit.PCS } })).id;
  await prisma.product.update({ where: { id: cakeId }, data: { averageUnitCost: 200 } });
  recipeId = (await prisma.recipe.create({ data: { organizationId: id, productId: breadId, yieldQuantity: 1, items: { create: [{ ingredientProductId: flourId, quantity: 0.5 }] } } })).id;
  supplierId = (await prisma.supplier.create({ data: { organizationId: id, name: "Мельница" } })).id;
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

const level = async (productId: string) =>
  (await prisma.stockLevel.findUnique({ where: { locationId_productId: { locationId: org.storeId, productId } } }))?.quantity.toNumber() ?? 0;

const bake = async (quantity: number) => {
  const batch = await services.production.create(org.user, { locationId: org.storeId, recipeId, plannedQuantity: quantity });
  await services.production.start(org.user, batch.id);
  return services.production.complete(org.user, batch.id, { actualQuantity: quantity });
};

describe("working before the first stock count", () => {
  it("is refused while the switch is off, as always", async () => {
    await expect(bake(10)).rejects.toThrow(/Недостаточно ингредиента/);
    await expect(
      services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items: [{ productId: cakeId, quantity: 1, unitPrice: 500 }] } as never),
    ).rejects.toThrow(/Недостаточно товара/);
  });

  it("with the switch on, production and the till go below zero and record everything as usual", async () => {
    // The first morning: the finance launch (nothing counted yet), then the switch.
    await new FinanceSetupService(prisma, services.finance).complete(org.user);
    await services.procurement.activateCutover(org.user);
    expect((await services.inventory.setAllowNegativeStock(org.user, true)).allowNegativeStock).toBe(true);
    await bake(10); // 5 kg of flour that the books do not have yet
    expect(await level(flourId)).toBe(-5);
    expect(await level(breadId)).toBe(10);
    const consumed = await prisma.stockMovement.findFirstOrThrow({ where: { productId: flourId, type: "PRODUCTION_CONSUMPTION" } });
    expect(consumed.quantity.toNumber()).toBe(5);
    expect(consumed.unitCost?.toNumber()).toBe(100);
    await services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items: [{ productId: breadId, quantity: 3, unitPrice: 300 }, { productId: cakeId, quantity: 1, unitPrice: 500 }] } as never);
    expect(await level(breadId)).toBe(7);
    expect(await level(cakeId)).toBe(-1);
    // A delivery entered later simply covers part of the minus.
    const po = await services.procurement.create(org.user, { supplierId, locationId: org.storeId, items: [{ productId: flourId, quantity: 10, unitCost: 100 }] } as never);
    await services.procurement.receive(org.user, po.id);
    expect(await level(flourId)).toBe(5);
  });

  it("the first count, approved as the opening, books what was there at the start as the opening stock", async () => {
    const st = await services.stocktake.create(org.user, { locationId: org.storeId } as never);
    const line = (productId: string) => st.lines.find((l) => l.productId === productId)!;
    // Counted: 25 kg of flour (so 20 were there at the start), 6 loaves (one short), 2 cakes (3 at the start).
    await services.stocktake.updateLine(org.user, st.id, line(flourId).id, { countedQuantity: 25 });
    await services.stocktake.updateLine(org.user, st.id, line(breadId).id, { countedQuantity: 6 });
    await services.stocktake.updateLine(org.user, st.id, line(cakeId).id, { countedQuantity: 2 });
    await services.stocktake.submit(org.user, st.id);
    const approved = await services.stocktake.approve(org.user, st.id, { opening: true });
    expect(approved.opening).toBe(true);
    expect(await level(flourId)).toBe(25);
    expect(await level(cakeId)).toBe(2);
    const moves = await prisma.stockMovement.findMany({ where: { stocktakeId: st.id }, orderBy: { productId: "asc" } });
    // A shortage is part of the opening too (a signed receipt), not a loss of these days.
    expect(moves.map((m) => [m.type, m.quantity.toNumber()]).sort()).toEqual([
      ["RECEIPT", -1],
      ["RECEIPT", 20],
      ["RECEIPT", 3],
    ]);
    expect(await level(breadId)).toBe(6);
    // Not a gain or a loss: the P&L shows no inventory result for these days, only the real cost of what was sold.
    const pnl = await services.finance.getProfitAndLoss(org.organizationId, from, new Date(Date.now() + 60_000));
    expect(pnl.inventoryLosses).toBe(0);
    expect(pnl.netRevenue).toBe(1400);
    expect(pnl.cogs).toBe(3 * 50 + 200);
  });

  it("the found stock joins the opening position, so the books are balanced", async () => {
    // 20 kg × 100 + 3 cakes × 200 − 1 loaf × 50, added to what the launch declared (nothing).
    const org1 = await prisma.organization.findUniqueOrThrow({ where: { id: org.organizationId } });
    expect(org1.openingInventoryValue?.toNumber()).toBe(2550);
    const sheet = await balance.getBalanceSheet(org.organizationId);
    expect(sheet.control.lines).toEqual([]);
    expect(sheet.status).toBe(BalanceStatus.BALANCED);
  });

  it("with «непосчитанные = 0», a product nobody found on the shelf leaves the minus at zero", async () => {
    const bunId = (await prisma.product.create({ data: { organizationId: org.organizationId, name: "Булка", sku: "NS-4", type: ProductType.FINISHED_GOOD, price: 200, unit: Unit.PCS, averageUnitCost: 80 } })).id;
    await services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items: [{ productId: bunId, quantity: 2, unitPrice: 200 }] } as never);
    expect(await level(bunId)).toBe(-2);
    const st = await services.stocktake.create(org.user, { locationId: org.storeId } as never);
    // Everything else counted as it stands; the bun is left blank.
    for (const l of st.lines) if (l.productId !== bunId) await services.stocktake.updateLine(org.user, st.id, l.id, { countedQuantity: l.systemQuantity });
    await services.stocktake.submit(org.user, st.id);
    await expect(services.stocktake.approve(org.user, st.id, { uncountedAsZero: true })).rejects.toThrow(/начальных остатков/);
    const approved = await services.stocktake.approve(org.user, st.id, { opening: true, uncountedAsZero: true });
    expect(await level(bunId)).toBe(0);
    expect(approved.lines.find((l) => l.productId === bunId)!.countedQuantity).toBe(0);
    const move = await prisma.stockMovement.findFirstOrThrow({ where: { stocktakeId: st.id } });
    expect([move.productId, move.type, move.quantity.toNumber()]).toEqual([bunId, "RECEIPT", 2]);
    expect(await level(flourId)).toBe(25);
  });

  it("once the switch is off, an «opening» count is refused: the start-up phase is over", async () => {
    await services.inventory.setAllowNegativeStock(org.user, false);
    const st = await services.stocktake.create(org.user, { locationId: org.storeId } as never);
    await services.stocktake.updateLine(org.user, st.id, st.lines.find((l) => l.productId === flourId)!.id, { countedQuantity: 25 });
    await services.stocktake.submit(org.user, st.id);
    await expect(services.stocktake.approve(org.user, st.id, { opening: true })).rejects.toThrow(/Уход в минус/);
    await services.stocktake.cancel(org.user, st.id, "Проверка");
    // Switching it on and off is in the audit log.
    expect(await prisma.auditLog.count({ where: { organizationId: org.organizationId, action: "inventory.allowNegativeStock" } })).toBe(2);
  });
});

// The finance launch may also come LATER (the owner first sorts out banks and statements): the days
// traded before it, their cash included, become part of the opening position.
describe("launching finance after the first days of trading", () => {
  let late: IsolatedOrg;
  let flour: string;
  let bread: string;
  let recipe: string;
  const levelAt = async (productId: string) =>
    (await prisma.stockLevel.findUnique({ where: { locationId_productId: { locationId: late.storeId, productId } } }))?.quantity.toNumber() ?? 0;

  beforeAll(async () => {
    late = await createIsolatedOrg(prisma, "negative-late");
    const id = late.organizationId;
    flour = (await prisma.product.create({ data: { organizationId: id, name: "Мука", sku: "NL-1", type: ProductType.RAW_MATERIAL, price: 100, unit: Unit.KG } })).id;
    bread = (await prisma.product.create({ data: { organizationId: id, name: "Хлеб", sku: "NL-2", type: ProductType.FINISHED_GOOD, price: 300, unit: Unit.PCS } })).id;
    recipe = (await prisma.recipe.create({ data: { organizationId: id, productId: bread, yieldQuantity: 1, items: { create: [{ ingredientProductId: flour, quantity: 0.5 }] } } })).id;
  });
  afterAll(async () => {
    expect(await destroyOrg(prisma, late.organizationId)).toEqual([]);
  });

  it("trades below zero, counts the opening, launches finance afterwards — and the balance agrees", async () => {
    await services.inventory.setAllowNegativeStock(late.user, true);
    const batch = await services.production.create(late.user, { locationId: late.storeId, recipeId: recipe, plannedQuantity: 10 });
    await services.production.start(late.user, batch.id);
    await services.production.complete(late.user, batch.id, { actualQuantity: 10 });
    await services.sales.create(late.user, { locationId: late.storeId, paymentMethod: PaymentMethod.CASH, items: [{ productId: bread, quantity: 3, unitPrice: 300 }] } as never);
    // A wholesale customer takes goods on credit before the launch — some of them not on the books at all.
    const customerId = (await prisma.customer.create({ data: { organizationId: late.organizationId, name: "Оптовик", paymentTermDays: 7 } })).id;
    const cakeL = (await prisma.product.create({ data: { organizationId: late.organizationId, name: "Торт", sku: "NL-3", type: ProductType.FINISHED_GOOD, price: 2000, unit: Unit.PCS } })).id;
    await prisma.product.update({ where: { id: cakeL }, data: { averageUnitCost: 800 } });
    const wholesale = await services.sales.create(late.user, {
      locationId: late.storeId, customerId, amountPaid: 0, paymentMethod: PaymentMethod.TRANSFER,
      items: [{ productId: bread, quantity: 2, unitPrice: 250 }, { productId: cakeL, quantity: 1, unitPrice: 1800 }],
    } as never);
    expect(wholesale.balanceDue).toBe(2300);
    expect(await levelAt(cakeL)).toBe(-1);
    expect(await levelAt(flour)).toBe(-5);

    const st = await services.stocktake.create(late.user, { locationId: late.storeId } as never);
    const line = (productId: string) => st.lines.find((l) => l.productId === productId)!;
    await services.stocktake.updateLine(late.user, st.id, line(flour).id, { countedQuantity: 15 });
    await services.stocktake.updateLine(late.user, st.id, line(bread).id, { countedQuantity: 6 });
    await services.stocktake.submit(late.user, st.id);
    await services.stocktake.approve(late.user, st.id, { opening: true });
    await services.inventory.setAllowNegativeStock(late.user, false);
    expect(await levelAt(flour)).toBe(15);
    expect(await levelAt(bread)).toBe(6);

    // Days later, with the banks sorted out: «Запустить».
    await new FinanceSetupService(prisma, services.finance).complete(late.user);
    // …and pays after the launch.
    await services.sales.recordPayment(late.user, wholesale.id, { amount: 2300, accountId: late.bankAccountId } as never);
    expect(await services.finance.getAccountsReceivable(late.organizationId)).toBe(0);
    const sheet = await balance.getBalanceSheet(late.organizationId);
    expect(sheet.control.lines).toEqual([]);
    expect(sheet.status).toBe(BalanceStatus.BALANCED);
  });
});
