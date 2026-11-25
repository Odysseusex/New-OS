import "reflect-metadata";
import { BalanceLine, BalanceStatus, CashAccountType, CashSection, ProductType, Role, SupplierIntakePayment, SystemAccountKey, Unit } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { glBalance, startLedger } from "../../test/support/ledger-fixture";
import { buildServices } from "../../test/support/services";
import { BalanceService } from "./balance/balance.service";
import { CashAccountsService } from "./cash-accounts.service";
import { CashMovementsController } from "./cash-movements.controller";
import { FinanceSetupService } from "./finance-setup.service";
import { FinancialEventProjector } from "./events/projector";
import { checkEventInvariants } from "./events/invariants";
import { PARTNER_FUNDS_LABEL } from "./events/cash-events";
import { LedgerDiagnosticsService } from "../ledger/ledger-diagnostics.service";
import { LedgerReportsService } from "../ledger/ledger-reports.service";
import { LedgerService } from "../ledger/ledger.service";
import { DashboardFinanceService } from "../dashboard/dashboard-finance.service";
import { DebtsService } from "../debts/debts.service";
import { BakerNotesService } from "../baker/baker-notes.service";
import { SupplierIntakesService } from "../baker/supplier-intakes.service";
import { pathAllowedForRole } from "../common/role-scope";
import { ROLES_KEY } from "../common/decorators/roles.decorator";

// «Личные кошельки»: a participant pays a supplier and an expense out of their own pocket, the
// business owes them, and is then paid back by an ordinary transfer. Run in a fresh organization with
// the general ledger ON: the debt is on the balance sheet, never in «Денежные средства»; nothing of
// it is an expense; the balance agrees and the ledger's diagnostics are clean at every step.

const prisma = new PrismaService();
const services = buildServices(prisma);
const accounts = new CashAccountsService(prisma);
const ledger = new LedgerService(prisma);
const reports = new LedgerReportsService(prisma, services.finance);
const balance = new BalanceService(prisma, services.finance);
const diagnostics = new LedgerDiagnosticsService(prisma, services.finance, balance, reports, ledger);
const projector = new FinancialEventProjector(prisma);
const dashboard = new DashboardFinanceService(prisma, services.finance, accounts, new DebtsService(prisma), services.costing);

let org: IsolatedOrg;
let gauharId: string;
let amirId: string;
let flourId: string;
let supplierId: string;
let rentId: string;
let from: Date;

const liability = (sheet: Awaited<ReturnType<BalanceService["getBalanceSheet"]>>, l: BalanceLine) => sheet.liabilities.lines.find((x) => x.line === l);
const asset = (sheet: Awaited<ReturnType<BalanceService["getBalanceSheet"]>>, l: BalanceLine) => sheet.assets.lines.find((x) => x.line === l)?.amount;

// The books agree with themselves: events balance, the sheet balances with nothing in CONTROL, and
// every diagnostic of the general ledger passes.
async function expectCleanBooks() {
  expect(checkEventInvariants(await projector.project(org.organizationId)).violations).toEqual([]);
  const sheet = await balance.getBalanceSheet(org.organizationId);
  expect(sheet.control.lines).toEqual([]);
  expect(sheet.status).toBe(BalanceStatus.BALANCED);
  const diag = await diagnostics.run(org.organizationId);
  expect(diag.checks.filter((c) => c.status !== "PASS")).toEqual([]);
  return sheet;
}

beforeAll(async () => {
  await prisma.$connect();
  org = await createIsolatedOrg(prisma, "personal");
  const id = org.organizationId;
  await prisma.cashAccount.update({ where: { id: org.bankAccountId }, data: { isDefault: true } });
  flourId = (await prisma.product.create({ data: { organizationId: id, name: "Мука", sku: "PA-1", type: ProductType.RAW_MATERIAL, price: 400, unit: Unit.KG } })).id;
  supplierId = (await prisma.supplier.create({ data: { organizationId: id, name: "Поставщик муки" } })).id;
  rentId = (
    await prisma.financeCategory.create({
      data: { organizationId: id, name: "Аренда", kind: "EXPENSE", pnlTreatment: "OPERATING_EXPENSE", cashActivity: "OPERATING", balanceTreatment: "NONE" },
    })
  ).id;
  from = new Date(Date.now() - 60_000);
  await new FinanceSetupService(prisma, services.finance).complete(org.user);
  await startLedger(ledger, org, 1);
  await services.procurement.activateCutover(org.user);
  // The business itself has 100 000 ₸ in the bank (the owner's contribution).
  const contribution = await prisma.financeCategory.create({
    data: { organizationId: id, name: "Взнос собственника", kind: "INCOME", pnlTreatment: "NOT_IN_PNL", cashActivity: "FINANCING", balanceTreatment: "OWNER_CONTRIBUTION" },
  });
  await services.cash.deposit(org.user, { accountId: org.bankAccountId, amount: 100_000, categoryId: contribution.id, reason: "Взнос" } as never);
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

describe("личные средства участника", () => {
  it("a personal account is its own kind: no point, no opening balance, never the default", async () => {
    gauharId = (await accounts.create(org.user, { name: "Гаухар апа (личные)", type: CashAccountType.PERSONAL })).id;
    amirId = (await accounts.create(org.user, { name: "Амир (личные)", type: CashAccountType.PERSONAL })).id;
    await expect(accounts.create(org.user, { name: "Х", type: CashAccountType.PERSONAL, openingBalance: 5 })).rejects.toThrow(/начального остатка/);
    await expect(accounts.create(org.user, { name: "Х", type: CashAccountType.PERSONAL, locationId: org.storeId })).rejects.toThrow(/не привязывается/);
    await expect(accounts.setDefault(org.user, gauharId)).rejects.toThrow(/банковский/);
    expect(await accounts.partnerDebts(org.organizationId)).toEqual([
      { accountId: amirId, name: "Амир", owed: 0 },
      { accountId: gauharId, name: "Гаухар апа", owed: 0 },
    ]);
    await expectCleanBooks();
  });

  it("paying a supplier from it: the business owes the participant, its own money is untouched", async () => {
    const po = await services.procurement.create(org.user, { supplierId, locationId: org.storeId, items: [{ productId: flourId, quantity: 100, unitCost: 500 }] } as never);
    // Received and paid at once out of Гаухар апа's pocket — far more than any account holds.
    await services.procurement.receive(org.user, po.id, { payNow: { accountId: gauharId } } as never);

    const sheet = await expectCleanBooks();
    expect(asset(sheet, BalanceLine.CASH_AND_BANK)).toBe(100_000);
    expect(asset(sheet, BalanceLine.INVENTORY)).toBe(50_000);
    expect(liability(sheet, BalanceLine.SUPPLIER_PAYABLES)?.amount).toBe(0);
    expect(liability(sheet, BalanceLine.PARTNER_PAYABLES)).toMatchObject({ amount: 50_000, label: "Задолженность перед участниками", breakdown: [{ label: "Гаухар апа", amount: 50_000 }] });
    // The breakdown of money lists the business's accounts only.
    expect(sheet.assets.lines.find((l) => l.line === BalanceLine.CASH_AND_BANK)?.breakdown?.map((b) => b.label)).not.toContain("Гаухар апа (личные)");
    expect(await glBalance(ledger, org, SystemAccountKey.PARTNER_PAYABLES)).toBe(50_000);
    expect(await glBalance(ledger, org, SystemAccountKey.BANK)).toBe(100_000);
    expect((await accounts.partnerDebts(org.organizationId)).find((d) => d.accountId === gauharId)?.owed).toBe(50_000);
  });

  it("an expense paid from it is the business's expense once — the payment and the debt are not", async () => {
    await services.finance.createExpense(org.user, { amount: 12_000, categoryId: rentId, accountId: amirId, description: "Аренда за ноябрь" } as never);
    const to = new Date(Date.now() + 60_000);
    const pnl = await services.finance.getProfitAndLoss(org.organizationId, from, to);
    expect(pnl.expensesTotal).toBe(12_000);

    const sheet = await expectCleanBooks();
    expect(asset(sheet, BalanceLine.CASH_AND_BANK)).toBe(100_000);
    expect(liability(sheet, BalanceLine.PARTNER_PAYABLES)).toMatchObject({
      amount: 62_000,
      breakdown: [
        { label: "Гаухар апа", amount: 50_000 },
        { label: "Амир", amount: 12_000 },
      ],
    });
  });

  it("ДДС: the payments stay supplier and expense payments, covered by the participants' money; the closing is the business's accounts", async () => {
    const flow = await services.finance.getCashFlow(org.organizationId, from, new Date(Date.now() + 60_000));
    const section = (s: CashSection) => flow.sections.find((x) => x.section === s)!;
    expect(section(CashSection.OPERATING).lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Оплата поставщику", outflow: 50_000, inflow: 0 }),
        expect.objectContaining({ label: "Аренда", outflow: 12_000, inflow: 0 }),
      ]),
    );
    expect(section(CashSection.FINANCING).lines).toEqual(expect.arrayContaining([expect.objectContaining({ label: PARTNER_FUNDS_LABEL, inflow: 62_000, outflow: 0 })]));
    expect(flow.closingBalance).toBe(100_000);
    expect(flow.reconciliation).toMatchObject({ accountsBalance: 100_000, reconciles: true });
    // The drill-down of the participants' line is that line's own movements.
    const month = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Almaty" }).slice(0, 7);
    const ops = await services.finance.getCashFlowOperations(org.organizationId, CashSection.FINANCING, PARTNER_FUNDS_LABEL, month, month);
    expect(ops.total).toBe(62_000);
  });

  it("paying the participant back is an ordinary transfer: financing, not an expense, and the debt goes to zero", async () => {
    const to = () => new Date(Date.now() + 60_000);
    const before = await services.finance.getProfitAndLoss(org.organizationId, from, to());
    await services.cash.transfer(org.user, { fromAccountId: org.bankAccountId, toAccountId: gauharId, amount: 30_000, reason: "Возврат Гаухар апа" });

    let sheet = await expectCleanBooks();
    expect(asset(sheet, BalanceLine.CASH_AND_BANK)).toBe(70_000);
    expect(liability(sheet, BalanceLine.PARTNER_PAYABLES)?.amount).toBe(32_000);

    await services.cash.transfer(org.user, { fromAccountId: org.bankAccountId, toAccountId: gauharId, amount: 20_000, reason: "Возврат Гаухар апа" });
    await services.cash.transfer(org.user, { fromAccountId: org.bankAccountId, toAccountId: amirId, amount: 12_000, reason: "Возврат Амиру" });

    sheet = await expectCleanBooks();
    expect(asset(sheet, BalanceLine.CASH_AND_BANK)).toBe(38_000);
    expect(liability(sheet, BalanceLine.PARTNER_PAYABLES)?.amount).toBe(0);
    expect(await glBalance(ledger, org, SystemAccountKey.PARTNER_PAYABLES)).toBe(0);
    expect(await accounts.partnerDebts(org.organizationId)).toEqual([
      { accountId: amirId, name: "Амир", owed: 0 },
      { accountId: gauharId, name: "Гаухар апа", owed: 0 },
    ]);

    // Nothing of the repayment reached the P&L.
    const after = await services.finance.getProfitAndLoss(org.organizationId, from, to());
    expect(after.expensesTotal).toBe(before.expensesTotal);
    expect(after.netProfit).toBe(before.netProfit);

    const flow = await services.finance.getCashFlow(org.organizationId, from, to());
    const financing = flow.sections.find((x) => x.section === CashSection.FINANCING)!;
    expect(financing.lines).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Возврат средств участнику", outflow: 62_000, inflow: 0 })]));
    // A repayment is not a transfer between the business's own accounts.
    expect(flow.internalTransfers).toMatchObject({ amount: 0, count: 0 });
    expect(flow.closingBalance).toBe(38_000);
    expect(flow.reconciliation).toMatchObject({ accountsBalance: 38_000, reconciles: true });
  });

  it("a participant paid back more than they spent is shown as owing the business", async () => {
    await services.cash.transfer(org.user, { fromAccountId: org.bankAccountId, toAccountId: amirId, amount: 3_000, reason: "Аванс Амиру" });
    let sheet = await expectCleanBooks();
    expect(liability(sheet, BalanceLine.PARTNER_PAYABLES)).toMatchObject({ amount: -3_000, breakdown: [{ label: "Амир", amount: -3_000 }] });
    const figures = await dashboard.figures(org.organizationId);
    expect(figures.cashTotal).toBe(35_000);
    expect(figures.cashAccounts.map((a) => a.id)).not.toContain(amirId);
    expect(figures.partnerDebts.find((d) => d.accountId === amirId)?.owed).toBe(-3_000);
    // He hands it back: a transfer out of the personal account, however little it holds.
    await services.cash.transfer(org.user, { fromAccountId: amirId, toAccountId: org.bankAccountId, amount: 3_000, reason: "Вернул" });
    sheet = await expectCleanBooks();
    expect(liability(sheet, BalanceLine.PARTNER_PAYABLES)?.amount).toBe(0);
    expect(asset(sheet, BalanceLine.CASH_AND_BANK)).toBe(38_000);
  });

  it("an ordinary account still cannot be overdrawn", async () => {
    await expect(services.cash.transfer(org.user, { fromAccountId: org.cashAccountId, toAccountId: org.bankAccountId, amount: 1_000_000, reason: "x" })).rejects.toThrow(/Недостаточно/);
  });

  it("«Помощник»: reaches the routes, and moves money only to or from a personal account", async () => {
    for (const [method, path] of [
      ["POST", "/finance/movements/transfer"],
      ["POST", "/finance/expenses"],
      ["POST", "/procurement/orders/x/payments"],
      ["GET", "/finance/accounts"],
    ]) {
      expect(pathAllowedForRole(Role.ASSISTANT, path, method)).toBe(true);
    }
    expect(Reflect.getMetadata(ROLES_KEY, CashMovementsController.prototype.transfer)).toContain(Role.ASSISTANT);
    expect(Reflect.getMetadata(ROLES_KEY, CashMovementsController.prototype.adjust)).not.toContain(Role.ASSISTANT);
    expect(Reflect.getMetadata(ROLES_KEY, CashMovementsController.prototype.withdraw)).not.toContain(Role.ASSISTANT);

    const assistant = { ...org.user, role: Role.ASSISTANT };
    await expect(services.cash.transfer(assistant, { fromAccountId: org.bankAccountId, toAccountId: org.cashAccountId, amount: 100, reason: "x" })).rejects.toThrow(/личным счётом участника/);
    // A payment out of the participant's pocket and the transfer that pays them back.
    await services.finance.createExpense(assistant, { amount: 4_000, categoryId: rentId, accountId: gauharId, description: "Коммунальные" } as never);
    await services.cash.transfer(assistant, { fromAccountId: org.bankAccountId, toAccountId: gauharId, amount: 4_000, reason: "Возврат Гаухар апа" });
    const sheet = await expectCleanBooks();
    expect(liability(sheet, BalanceLine.PARTNER_PAYABLES)?.amount).toBe(0);
    expect(asset(sheet, BalanceLine.CASH_AND_BANK)).toBe(34_000);
  });

  it("the bakers' «Как оплатили» offers the participants from the accounts, and the intake carries who paid", async () => {
    await prisma.location.create({ data: { organizationId: org.organizationId, name: "Цех", type: "BAKERY_PRODUCTION", city: "Тест", address: "Тест" } });
    const notes = new BakerNotesService(prisma);
    const catalog = await notes.catalog(org.user);
    expect(catalog.personalAccounts).toEqual([
      { id: amirId, name: "Амир" },
      { id: gauharId, name: "Гаухар апа" },
    ]);
    const intakes = new SupplierIntakesService(prisma);
    await expect(intakes.create(org.user, { locationId: org.storeId, payment: SupplierIntakePayment.PERSONAL })).rejects.toThrow(/чьими деньгами/);
    await expect(intakes.create(org.user, { locationId: org.storeId, payment: SupplierIntakePayment.PERSONAL, paymentAccountId: org.bankAccountId })).rejects.toThrow(/чьими деньгами/);
    const intake = await intakes.create(org.user, { locationId: org.storeId, payment: SupplierIntakePayment.PERSONAL, paymentAccountId: gauharId });
    expect(intake).toMatchObject({ payment: SupplierIntakePayment.PERSONAL, paymentLabel: "Гаухар апа", paymentAccountId: gauharId });
    // Still a draft: nothing was owed to anyone by it.
    expect((await accounts.partnerDebts(org.organizationId)).every((d) => d.owed === 0)).toBe(true);
  });
});

describe("личные средства участника — до запуска финансового учёта", () => {
  let early: IsolatedOrg;
  beforeAll(async () => {
    early = await createIsolatedOrg(prisma, "personal-early");
  });
  afterAll(async () => {
    expect(await destroyOrg(prisma, early.organizationId)).toEqual([]);
  });

  it("a debt to a participant that existed at the launch is part of the opening position", async () => {
    const rent = await prisma.financeCategory.create({
      data: { organizationId: early.organizationId, name: "Аренда", kind: "EXPENSE", pnlTreatment: "OPERATING_EXPENSE", cashActivity: "OPERATING", balanceTreatment: "NONE" },
    });
    const personal = await accounts.create(early.user, { name: "Амир (личные)", type: CashAccountType.PERSONAL });
    await services.finance.createExpense(early.user, { amount: 5_000, categoryId: rent.id, accountId: personal.id } as never);
    await new FinanceSetupService(prisma, services.finance).complete(early.user);

    const sheet = await balance.getBalanceSheet(early.organizationId);
    expect(liability(sheet, BalanceLine.PARTNER_PAYABLES)?.amount).toBe(5_000);
    expect(asset(sheet, BalanceLine.CASH_AND_BANK)).toBe(0);
    expect(sheet.equity.lines.find((l) => l.line === BalanceLine.OPENING_EQUITY)?.amount).toBe(-5_000);
    expect(sheet.control.lines).toEqual([]);
    expect(sheet.status).toBe(BalanceStatus.BALANCED);

    // The ledger's opening entry is proposed with that debt in it.
    const proposal = await ledger.proposeOpening(early.organizationId);
    expect(proposal.lines).toEqual(expect.arrayContaining([expect.objectContaining({ systemAccountKey: SystemAccountKey.PARTNER_PAYABLES, amount: 5_000 })]));
  });
});
