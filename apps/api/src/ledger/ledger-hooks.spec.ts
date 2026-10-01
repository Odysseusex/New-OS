import { PaymentMethod, ProductType, Role, SystemAccountKey as K, Unit, LEDGER_MANAGE_ROLES, LEDGER_SETUP_ROLES, LEDGER_VIEW_ROLES, DepreciationMethod } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { glBalance } from "../../test/support/ledger-fixture";
import { buildServices } from "../../test/support/services";
import { FixedAssetsService } from "../fixed-assets/fixed-assets.service";
import { BalanceService } from "../finance/balance/balance.service";
import { monthOf, monthRange } from "../common/reporting-period";
import { LedgerReportsService } from "./ledger-reports.service";
import { LedgerService } from "./ledger.service";

// The remaining posting hooks, each against the subledger it must agree with:
// supplier invoices, transfers, stocktake, fixed assets (acquisition →
// depreciation → disposal), and the refund override.

const prisma = new PrismaService();
const services = buildServices(prisma);
const ledger = new LedgerService(prisma);
const reports = new LedgerReportsService(prisma, services.finance);
const balance = new BalanceService(prisma, services.finance);
const assets = new FixedAssetsService(prisma, services.cash);
const originalFiscal = process.env.FISCALIZATION_ENABLED;
const DAY = 24 * 3600_000;

let org: IsolatedOrg;
let productId: string;
let supplierId: string;

const now = monthOf(new Date());
const M1 = now.month === 1 ? { year: now.year - 1, month: 12 } : { year: now.year, month: now.month - 1 };
const gl = (key: K) => glBalance(ledger, org, key);

beforeAll(async () => {
  await prisma.$connect();
  delete process.env.FISCALIZATION_ENABLED;
  org = await createIsolatedOrg(prisma, "ledger-hooks");
  productId = (await prisma.product.create({ data: { organizationId: org.organizationId, name: "Мука", sku: "H-1", unit: Unit.KG, type: ProductType.RAW_MATERIAL, price: 100 } })).id;
  supplierId = (await prisma.supplier.create({ data: { organizationId: org.organizationId, name: "Поставщик" } })).id;
  // Money in the bank long before the ledger, so payments are possible.
  const opening = await services.cash.recordMovement(prisma, { organizationId: org.organizationId, accountId: org.bankAccountId, type: "OPENING_BALANCE" as never, amount: 1_000_000, createdById: org.user.id });
  await prisma.cashMovement.update({ where: { id: opening.id }, data: { occurredAt: new Date(Date.now() - 200 * DAY) } });
  await ledger.initializeSystemAccounts(org.user);
  await ledger.enable(org.user, { startsAt: monthRange(M1.year, M1.month).start.toISOString() });
});

afterAll(async () => {
  if (originalFiscal !== undefined) process.env.FISCALIZATION_ENABLED = originalFiscal;
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

describe("supplier invoices (the legacy path, still readable and payable)", () => {
  it("M. confirming one raises inventory and the supplier payable; paying it shrinks the payable — and the book matches the documents", async () => {
    const invoice = await prisma.invoice.create({
      data: {
        organizationId: org.organizationId, locationId: org.storeId, supplierId, number: "H-1", status: "DRAFT", totalCost: 1000, createdById: org.user.id,
        items: { create: [{ productId, quantity: 10, unitCost: 100, subtotal: 1000 }] },
      },
    });
    await services.invoices.confirm(org.user, invoice.id);
    expect(await gl(K.INVENTORY)).toBe(1000);
    expect(await gl(K.SUPPLIER_PAYABLES)).toBe(1000);
    await services.invoices.recordPayment(org.user, invoice.id, { accountId: org.bankAccountId, amount: 400 });
    expect(await gl(K.SUPPLIER_PAYABLES)).toBe(600);
    expect(await services.finance.getAccountsPayable(org.organizationId)).toBe(600);
    expect(await balance.inventoryValueAt(org.organizationId, new Date())).toBe(1000);
  });
});

describe("transfers between own accounts", () => {
  it("a transfer is one event over two movements: the first leg alone waits, the pair posts once, nothing is inflated", async () => {
    const before = { till: await gl(K.CASH_ON_HAND), bank: await gl(K.BANK) };
    await services.cash.transfer(org.user, { fromAccountId: org.bankAccountId, toAccountId: org.cashAccountId, amount: 100 });
    const events = await prisma.accountingEvent.findMany({ where: { organizationId: org.organizationId, eventType: "INTERNAL_TRANSFER" } });
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("POSTED");
    expect(await gl(K.CASH_ON_HAND)).toBe(before.till + 100);
    expect(await gl(K.BANK)).toBe(before.bank - 100);
    expect((await gl(K.CASH_ON_HAND)) + (await gl(K.BANK))).toBe(before.till + before.bank);
  });
});

describe("stocktake", () => {
  it("R. an approved count difference is an inventory loss at the cost of that moment", async () => {
    await services.inventory.receive(org.user, { locationId: org.storeId, productId, quantity: 5 }); // stock was 10 from the invoice → 15
    const st = await services.stocktake.create(org.user, { locationId: org.storeId });
    const line = st.lines.find((l) => l.productId === productId)!;
    await services.stocktake.updateLine(org.user, st.id, line.id, { countedQuantity: 13 } as never); // 2 short
    await services.stocktake.submit(org.user, st.id);
    const before = await gl(K.INVENTORY_LOSSES);
    await services.stocktake.approve(org.user, st.id);
    expect(await gl(K.INVENTORY_LOSSES)).toBe(before + 200); // 2 × 100
    const entry = await prisma.journalEntry.findFirstOrThrow({ where: { organizationId: org.organizationId, accountingEvent: { sourceType: "StockMovement", eventType: "INVENTORY_LOSS", metadata: { path: ["description"], equals: "Инвентаризация" } } } });
    expect(entry).toBeTruthy();
  });
});

describe("fixed assets: acquisition, depreciation, disposal — the book follows the register", () => {
  let assetId: string;

  it("a capital purchase is an asset in the book, equal to the register once the asset is registered", async () => {
    const category = await prisma.financeCategory.create({
      data: { organizationId: org.organizationId, name: "Оборудование", kind: "EXPENSE", pnlTreatment: "NOT_IN_PNL", cashActivity: "INVESTING", balanceTreatment: "FIXED_ASSET" },
    });
    const incurredOn = new Date(monthRange(M1.year, M1.month).start.getTime() + 3 * DAY);
    const expense = await services.finance.createExpense(org.user, { amount: 12000, categoryId: category.id, paidImmediately: true, accountId: org.bankAccountId, incurredOn: incurredOn.toISOString() } as never);
    expect(await gl(K.FIXED_ASSETS)).toBe(12000);
    const asset = await assets.register(org.user, { name: "Печь", sourceExpenseId: expense.id });
    assetId = asset.id;
    expect(await balance.fixedAssetsAt(org.organizationId, new Date())).toBe(12000);
  });

  it("D4. nothing is depreciated until the terms are stated — and then the charge is an expense against the asset", async () => {
    const early = await assets.runDepreciation(org.user, M1.year, M1.month);
    expect(early.created).toBe(0);
    expect(early.notConfigured).toBe(1);
    expect(await gl(K.DEPRECIATION_EXPENSE)).toBe(0);
    await assets.setTerms(org.user, assetId, { method: DepreciationMethod.STRAIGHT_LINE, usefulLifeMonths: 12, salvageValue: 0, startYear: M1.year, startMonth: M1.month } as never);
    const run = await assets.runDepreciation(org.user, M1.year, M1.month);
    expect(run.created).toBe(1);
    expect(await gl(K.DEPRECIATION_EXPENSE)).toBe(1000);
    expect(await gl(K.FIXED_ASSETS)).toBe(11000);
    expect(await balance.fixedAssetsAt(org.organizationId, new Date())).toBe(11000);
    // Idempotent: running it again changes nothing.
    await assets.runDepreciation(org.user, M1.year, M1.month);
    expect(await gl(K.DEPRECIATION_EXPENSE)).toBe(1000);
    const pnl = await reports.getPnl(org.organizationId, monthRange(M1.year, M1.month).start, monthRange(M1.year, M1.month).end);
    expect(pnl.depreciation).toBe(1000);
  });

  it("a disposal takes the asset off at book value; the loss against the proceeds is a result line", async () => {
    await assets.dispose(org.user, assetId, { disposedAt: new Date().toISOString(), proceeds: 5000, accountId: org.bankAccountId });
    expect(await gl(K.FIXED_ASSETS)).toBe(0);
    expect(await gl(K.OTHER_EXPENSE)).toBe(6000); // book value 11 000 − proceeds 5 000
    expect(await balance.fixedAssetsAt(org.organizationId, new Date())).toBe(0);
    const tb = await ledger.getTrialBalance(org.organizationId, {});
    expect(tb.totals.balanced).toBe(true);
  });
});

describe("D8: a mixed-tender refund can be explicitly overridden, and cannot be made to lie", () => {
  it("an override must add up and stay within each tender; otherwise the proportional rule applies", async () => {
    const bread = await prisma.product.create({ data: { organizationId: org.organizationId, name: "Хлеб", sku: "H-2", type: ProductType.FINISHED_GOOD, price: 500, unit: Unit.PCS } });
    await services.inventory.receive(org.user, { locationId: org.storeId, productId: bread.id, quantity: 10 });
    const sale = await services.sales.create(org.user, {
      locationId: org.storeId,
      payments: [{ method: PaymentMethod.CASH, amount: 600 }, { method: PaymentMethod.CARD, amount: 400 }],
      items: [{ productId: bread.id, quantity: 2, unitPrice: 500 }],
    } as never);
    // Asking the card to give back more than it took is refused, and nothing is written.
    await expect(
      services.returns.create(org.user, sale.id, { items: [{ productId: bread.id, quantity: 1 }], refundSplit: [{ method: "CARD", amount: 500 }] } as never),
    ).rejects.toThrow(/больше, чем было оплачено/);
    expect(await prisma.saleReturn.count({ where: { saleId: sale.id } })).toBe(0);
    // A valid override (all from cash) is honoured.
    await services.returns.create(org.user, sale.id, { items: [{ productId: bread.id, quantity: 1 }], refundSplit: [{ method: "CASH", amount: 500 }] } as never);
    const refunds = await prisma.cashMovement.findMany({ where: { saleId: sale.id, type: "SALE_REFUND" } });
    expect(refunds.map((r) => [r.accountId, r.amount.toNumber()])).toEqual([[org.cashAccountId, 500]]);
    // Without an override the next refund follows 60 / 40.
    await services.returns.create(org.user, sale.id, { items: [{ productId: bread.id, quantity: 1 }] });
    const all = await prisma.cashMovement.findMany({ where: { saleId: sale.id, type: "SALE_REFUND" }, orderBy: { createdAt: "asc" } });
    expect(all.slice(1).map((r) => [r.accountId, r.amount.toNumber()])).toEqual([[org.cashAccountId, 300], [org.bankAccountId, 200]]);
  });
});

describe("who may do what", () => {
  it("viewing and posting are bookkeeping roles; switching the ledger on is owner/admin only", () => {
    expect(LEDGER_VIEW_ROLES).toEqual([Role.OWNER, Role.ADMIN, Role.ACCOUNTANT]);
    expect(LEDGER_MANAGE_ROLES).toEqual([Role.OWNER, Role.ADMIN, Role.ACCOUNTANT]);
    expect(LEDGER_SETUP_ROLES).toEqual([Role.OWNER, Role.ADMIN]);
    for (const role of [Role.CASHIER, Role.STORE_MANAGER, Role.REGIONAL_MANAGER, Role.HR_MANAGER, Role.WAREHOUSE_STAFF, Role.OPERATOR]) {
      expect(LEDGER_VIEW_ROLES).not.toContain(role);
    }
  });
});
