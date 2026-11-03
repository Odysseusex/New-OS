import { BusinessDirection, CostBehavior, FinanceCategoryKind, PaymentMethod } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { allocate } from "./direction-pnl";

// Прибыль по направлениям (опт / розница / заказы): each direction's own revenue
// and cost of goods, common costs shared by net revenue, and the whole always
// equal to the period's P&L. Own throwaway organization.

const prisma = new PrismaService();
const services = buildServices(prisma);
let org: IsolatedOrg;
let breadId: string;
let customerId: string;
let orderId: string;
let start: Date;

beforeAll(async () => {
  await prisma.$connect();
  org = await createIsolatedOrg(prisma, "directions");
  const { organizationId } = org;
  // Costs 100, sells for 500.
  breadId = (
    await prisma.product.create({ data: { organizationId, name: "Торт", sku: "D-1", unit: "PCS", type: "FINISHED_GOOD", price: 500 } })
  ).id;
  // Bought in at 100 a piece: its cost of goods.
  const supplierId = (await prisma.supplier.create({ data: { organizationId, name: "Кондитерская" } })).id;
  const po = await services.procurement.create(org.user, {
    supplierId, locationId: org.storeId, items: [{ productId: breadId, quantity: 100, unitCost: 100 }],
  } as never);
  await services.procurement.receive(org.user, po.id);
  customerId = (await prisma.customer.create({ data: { organizationId, name: "Магазин «Мерей»" } })).id;
  orderId = (
    await prisma.crmOrder.create({
      data: { organizationId, number: 1, customerName: "Айгуль", title: "Торт на юбилей", dueAt: new Date(Date.now() + 86400_000) },
    })
  ).id;
  start = new Date(Date.now() - 1000);
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

const sell = (quantity: number, extra: object = {}) =>
  services.sales.create(org.user, {
    locationId: org.storeId,
    paymentMethod: PaymentMethod.CASH,
    items: [{ productId: breadId, quantity, unitPrice: 500 }],
    ...extra,
  } as never);

describe("P&L by business direction", () => {
  it("a sale paid for a cake order carries the order; a cancelled order takes no payment", async () => {
    const sale = await sell(2, { crmOrderId: orderId });
    expect(sale.crmOrder).toMatchObject({ id: orderId, number: 1, title: "Торт на юбилей" });
    const open = await services.sales.openCrmOrders(org.user);
    expect(open.map((o) => o.id)).toContain(orderId);

    const cancelled = await prisma.crmOrder.create({
      data: { organizationId: org.organizationId, number: 2, customerName: "Б", title: "Отменён", dueAt: new Date(), stage: "CANCELLED" },
    });
    await expect(sell(1, { crmOrderId: cancelled.id })).rejects.toThrow(/отменён/);
    expect((await services.sales.openCrmOrders(org.user)).map((o) => o.id)).not.toContain(cancelled.id);
  });

  it("splits revenue and cost by direction and common costs by share of revenue, adding up to the P&L", async () => {
    await sell(4, { customerId, amountPaid: 2000 }); // опт: 2 000
    const retail = await sell(4); // розница: 2 000
    await services.returns.create(org.user, retail.id, { items: [{ productId: breadId, quantity: 2 }], reason: "Вернули" }); // −1 000
    const categoryId = (
      await prisma.financeCategory.create({
        data: { organizationId: org.organizationId, name: "Аренда", kind: FinanceCategoryKind.EXPENSE, costBehavior: CostBehavior.FIXED },
      })
    ).id;
    await services.finance.createExpense(org.user, { amount: 1200, categoryId, paidImmediately: true, accountId: org.cashAccountId });

    const to = new Date();
    const pnl = await services.finance.getProfitAndLoss(org.organizationId, start, to);
    const d = await services.finance.getPnlByDirection(org.organizationId, start, to);
    const row = (dir: BusinessDirection) => d.rows.find((r) => r.direction === dir)!;

    // Опт 2 000, розница 1 000 (2 000 − 1 000 returned), заказы 1 000.
    expect(row(BusinessDirection.WHOLESALE)).toMatchObject({ checks: 1, netRevenue: 2000, cogs: 400, grossProfit: 1600 });
    expect(row(BusinessDirection.RETAIL)).toMatchObject({ checks: 1, netRevenue: 1000, cogs: 200, grossProfit: 800 });
    expect(row(BusinessDirection.ORDERS)).toMatchObject({ checks: 1, netRevenue: 1000, cogs: 200, grossProfit: 800 });
    // Rent 1 200 by revenue share 50 / 25 / 25.
    expect(row(BusinessDirection.WHOLESALE).expenses).toBe(600);
    expect(row(BusinessDirection.RETAIL).expenses).toBe(300);
    expect(row(BusinessDirection.ORDERS).revenueSharePercent).toBeCloseTo(25, 6);
    expect(row(BusinessDirection.ORDERS).operatingProfit).toBe(500);

    expect(d.allocated).toBe(true);
    expect(d.total.netRevenue).toBe(pnl.netRevenue);
    for (const key of ["netRevenue", "cogs", "grossProfit", "inventoryLosses", "expenses", "operatingProfit", "netProfit"] as const) {
      const sum = d.rows.reduce((s, r) => s + r[key], 0);
      expect(sum).toBeCloseTo(d.total[key] as number, 2);
    }
    expect(d.total.operatingProfit).toBe(pnl.operatingProfit);
  });

  it("allocation always adds up to the тиын", () => {
    const parts = allocate(100, new Map([[BusinessDirection.WHOLESALE, 1], [BusinessDirection.RETAIL, 1], [BusinessDirection.ORDERS, 1]]));
    expect([...parts.values()].reduce((s, v) => s + v, 0)).toBe(100);
    expect(allocate(50, new Map()).get(BusinessDirection.RETAIL)).toBe(0);
  });
});
