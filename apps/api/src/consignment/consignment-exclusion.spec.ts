import { PaymentMethod, ProductType, SystemAccountKey as K, Unit } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { glBalance, startLedger } from "../../test/support/ledger-fixture";
import { buildServices } from "../../test/support/services";
import { LedgerService } from "../ledger/ledger.service";
import { LedgerDiagnosticsService } from "../ledger/ledger-diagnostics.service";
import { LedgerReportsService } from "../ledger/ledger-reports.service";
import { BalanceService } from "../finance/balance/balance.service";

// Goods sold «под реализацию» are collected for their owner. They must be in no
// revenue, cost, margin or sales figure — while the money, the stock and the
// debt to the owner stay exactly right — and the general ledger must agree.

const prisma = new PrismaService();
const services = buildServices(prisma);
const ledger = new LedgerService(prisma);
const originalFiscal = process.env.FISCALIZATION_ENABLED;

let org: IsolatedOrg;
let breadId: string;
let villageId: string;
let supplierId: string;
let firstSaleId: string;

const range = () => ({ from: new Date(Date.now() - 3600_000), to: new Date(Date.now() + 3600_000) });
const owed = () => services.finance.getConsignmentOwed(org.organizationId);

beforeAll(async () => {
  await prisma.$connect();
  delete process.env.FISCALIZATION_ENABLED;
  org = await createIsolatedOrg(prisma, "consign-exclusion");
  const id = org.organizationId;
  supplierId = (await prisma.supplier.create({ data: { organizationId: id, name: "Деревня" } })).id;
  breadId = (await prisma.product.create({ data: { organizationId: id, name: "Хлеб", sku: "X-1", type: ProductType.FINISHED_GOOD, price: 500, unit: Unit.PCS } })).id;
  villageId = (await prisma.product.create({
    data: { organizationId: id, name: "Сыр деревенский", sku: "X-2", type: ProductType.FINISHED_GOOD, price: 900, unit: Unit.PCS, consignmentSupplierId: supplierId, consignmentPrice: 600 },
  })).id;
  for (const productId of [breadId, villageId]) {
    await prisma.stockLevel.create({ data: { organizationId: id, locationId: org.storeId, productId, quantity: 50, minQuantity: 0 } });
  }
  await startLedger(ledger, org);
});

afterAll(async () => {
  if (originalFiscal !== undefined) process.env.FISCALIZATION_ENABLED = originalFiscal;
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

describe("goods sold «под реализацию» are not our revenue", () => {
  it("a mixed basket records how much of it was the owner's", async () => {
    const sale = await services.sales.create(org.user, {
      locationId: org.storeId,
      paymentMethod: PaymentMethod.CASH,
      items: [{ productId: breadId, quantity: 2, unitPrice: 500 }, { productId: villageId, quantity: 3, unitPrice: 900 }],
    });
    firstSaleId = sale.id;
    const row = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect(row.totalAmount.toNumber()).toBe(3700); // the buyer paid for everything
    expect(row.consignmentAmount.toNumber()).toBe(2700); // 3 × 900 of it is the village's
    expect(await owed()).toBe(2700); // all of it is owed to them
  });

  it("the P&L shows only our bread: no village revenue, cost or product row", async () => {
    const { from, to } = range();
    const pnl = await services.finance.getProfitAndLoss(org.organizationId, from, to);
    expect(pnl.netRevenue).toBe(1000);
    expect(pnl.byProduct.map((p) => p.productName)).toEqual(["Хлеб"]);
  });

  it("sales reports count our revenue only, and the till still counts all the money taken", async () => {
    const { from, to } = range();
    const report = await services.sales.report(org.user, from, to);
    expect(report.totalRevenue).toBe(1000);
    expect(report.byProduct.map((p) => p.productName)).toEqual(["Хлеб"]);
    const summary = await services.sales.summary(org.user);
    expect(summary.todayRevenue).toBe(1000);
    expect(summary.todayTakings.find((t) => t.method === PaymentMethod.CASH)?.amount).toBe(3700);
    const dynamics = await services.sales.dynamics(org.user, from, to);
    expect(dynamics.totalRevenue).toBe(1000);
    const profit = await services.sales.productProfitability(org.user, from, to);
    expect(profit.rows.map((r) => r.productName)).toEqual(["Хлеб"]);
  });

  it("a basket of only the village's goods is not one of our sales at all", async () => {
    await services.sales.create(org.user, {
      locationId: org.storeId,
      paymentMethod: PaymentMethod.CASH,
      items: [{ productId: villageId, quantity: 1, unitPrice: 900 }],
    });
    const { from, to } = range();
    const summary = await services.sales.summary(org.user);
    expect(summary.todaySalesCount).toBe(1);
    expect((await services.sales.report(org.user, from, to)).totalCount).toBe(1);
    expect(await owed()).toBe(3600);
    expect((await services.finance.getProfitAndLoss(org.organizationId, from, to)).netRevenue).toBe(1000);
  });

  it("returning the village's goods cancels what is owed, and touches no revenue of ours", async () => {
    await services.returns.create(org.user, firstSaleId, { items: [{ productId: villageId, quantity: 1 }] });
    const ret = await prisma.saleReturn.findFirstOrThrow({ where: { saleId: firstSaleId } });
    expect(ret.consignmentAmount.toNumber()).toBe(900);
    expect(await owed()).toBe(2700);
    const { from, to } = range();
    const pnl = await services.finance.getProfitAndLoss(org.organizationId, from, to);
    expect(pnl.returnsTotal).toBe(0);
    expect(pnl.netRevenue).toBe(1000);
  });

  it("the general ledger agrees: revenue is only ours, the owner's money sits in the payable", async () => {
    expect(await glBalance(ledger, org, K.SALES_REVENUE)).toBe(1000);
    expect(await glBalance(ledger, org, K.CONSIGNMENT_PAYABLES)).toBe(await owed());
    const reports = new LedgerReportsService(prisma, services.finance);
    const diagnostics = new LedgerDiagnosticsService(prisma, services.finance, new BalanceService(prisma, services.finance), reports, ledger);
    const result = await diagnostics.run(org.organizationId);
    expect(result.checks.filter((c) => String(c.status) === "FAIL")).toEqual([]);
  });

  it("the supplier alone makes a product «под реализацию» — no price of theirs is needed", async () => {
    const id = org.organizationId;
    const bare = await prisma.product.create({
      data: { organizationId: id, name: "Без цены поставщика", sku: "X-3", type: ProductType.FINISHED_GOOD, price: 300, unit: Unit.PCS, consignmentSupplierId: supplierId },
    });
    await prisma.stockLevel.create({ data: { organizationId: id, locationId: org.storeId, productId: bare.id, quantity: 5, minQuantity: 0 } });
    const sale = await services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items: [{ productId: bare.id, quantity: 1, unitPrice: 300 }] });
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).consignmentAmount.toNumber()).toBe(300);
  });
});
