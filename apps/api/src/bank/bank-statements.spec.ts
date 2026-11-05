import { BankLineAction, BankPresetCategory, CashAccountType, PaymentMethod, SystemAccountKey as K } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { glBalance, startLedger } from "../../test/support/ledger-fixture";
import { buildServices } from "../../test/support/services";
import { BalanceService } from "../finance/balance/balance.service";
import { FinancialEventProjector } from "../finance/events/projector";
import { checkEventInvariants } from "../finance/events/invariants";
import { checkLedgerConsistency } from "../finance/integrity/ledger-consistency";
import { LedgerDiagnosticsService } from "../ledger/ledger-diagnostics.service";
import { LedgerReportsService } from "../ledger/ledger-reports.service";
import { LedgerService } from "../ledger/ledger.service";
import { BankStatementsService, purposeKey, settlementDateOf } from "./bank-statements.service";

// Загрузка банковской выписки with the general ledger ON: the day's takings are
// only compared (the till recorded them), commissions become expenses, own
// transfers move money, a supplier's payment settles its orders, a line is
// loaded and posted once, and every subledger agrees. Own throwaway organization.

import { loadDirectionContext } from "../directions/direction-context";

const prisma = new PrismaService();
const services = buildServices(prisma);
const ledger = new LedgerService(prisma);
const reports = new LedgerReportsService(prisma, services.finance);
const balanceService = new BalanceService(prisma, services.finance);
const diagnostics = new LedgerDiagnosticsService(prisma, services.finance, balanceService, reports, ledger);
const projector = new FinancialEventProjector(prisma);
const bank = new BankStatementsService(prisma, services.cash, services.procurement);

let org: IsolatedOrg;
let breadId: string;
let flourId: string;
let supplierId: string;
let depositId: string;

// A statement is always about the past: lines a little over an hour ago.
const base = Date.now() - 90 * 60_000;
const day = (h: number, m = 0) => (h === 0 ? new Date(base - 86_400_000) : h === 23 ? new Date() : new Date(base + m * 60_000));
const dd = (d: Date) => {
  const [y, mo, da] = new Date(d.getTime() + 5 * 3600_000).toISOString().slice(0, 10).split("-");
  return `${da}/${mo}/${y}`;
};

beforeAll(async () => {
  await prisma.$connect();
  org = await createIsolatedOrg(prisma, "bank");
  const { organizationId } = org;
  await prisma.cashAccount.update({ where: { id: org.bankAccountId }, data: { isDefault: true } });
  depositId = (await prisma.cashAccount.create({ data: { organizationId, name: "Депозит", type: CashAccountType.BANK } })).id;
  breadId = (await prisma.product.create({ data: { organizationId, name: "Хлеб", sku: "B-1", unit: "PCS", type: "FINISHED_GOOD", price: 500 } })).id;
  flourId = (await prisma.product.create({ data: { organizationId, name: "Мука", sku: "B-2", unit: "KG", type: "RAW_MATERIAL", price: 100 } })).id;
  supplierId = (await prisma.supplier.create({ data: { organizationId, name: "Евразиан Фудс", bin: "123456789012" } })).id;
  await startLedger(ledger, org, 48);
  await services.procurement.activateCutover(org.user);
  await services.inventory.receive(org.user, { locationId: org.storeId, productId: breadId, quantity: 50 } as never);
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

describe("bank statement import", () => {
  let statementId: string;
  const lines = () => [
    { docNumber: "1", occurredAt: day(15, 0).toISOString(), amount: 1500, counterpartyName: 'АО "KASPI BANK"', counterpartyBin: "971240001315", counterpartyIban: null, knp: "190", purpose: `Продажи с Kaspi.kz за ${dd(new Date())}` },
    { docNumber: "2", occurredAt: day(15, 1).toISOString(), amount: -10.5, counterpartyName: "ТОО Kaspi Pay", counterpartyBin: "200840000951", counterpartyIban: null, knp: "851", purpose: `Оплата за услуги процессинга Без НДС за ${dd(day(15))}` },
    { docNumber: "3", occurredAt: day(15, 2).toISOString(), amount: -100, counterpartyName: "Махмудов", counterpartyBin: null, counterpartyIban: null, knp: "342", purpose: "Перевод собственных средств на карту Kaspi Gold *5236" },
    { docNumber: "4", occurredAt: day(15, 3).toISOString(), amount: -800, counterpartyName: "Евразиан Фудс", counterpartyBin: "123456789012", counterpartyIban: null, knp: "710", purpose: "Оплата за товар" },
    { docNumber: "5", occurredAt: day(15, 4).toISOString(), amount: -480, counterpartyName: 'АО "KASPI BANK"', counterpartyBin: "971240001315", counterpartyIban: null, knp: "190", purpose: "ИП ҚЫДЫР. Оплата с Kaspi QR" },
    { docNumber: "6", occurredAt: day(15, 5).toISOString(), amount: -50, counterpartyName: "Kaspi Deposit", counterpartyBin: null, counterpartyIban: null, knp: "342", purpose: "Пополнение депозита" },
  ];

  it("helpers read the bank's wording", () => {
    expect(settlementDateOf("Продажи с Kaspi.kz за 31/10/2026", new Date())).toBe("2026-10-31");
    expect(purposeKey("ИП ҚЫДЫР. Оплата с Kaspi QR 12/10")).toBe("ип қыдыр оплата с kaspi qr");
  });

  it("loads a statement and suggests a way to post each line", async () => {
    // The till's card takings that day: 3 loaves.
    await services.sales.create(org.user, { locationId: org.storeId, paymentMethod: PaymentMethod.CARD, items: [{ productId: breadId, quantity: 3, unitPrice: 500 }] } as never);
    const po = await services.procurement.create(org.user, { supplierId, locationId: org.storeId, items: [{ productId: flourId, quantity: 10, unitCost: 100 }] } as never);
    await services.procurement.receive(org.user, po.id);

    const dto = await bank.upload(org.user, {
      accountId: org.bankAccountId,
      bankName: "Kaspi",
      iban: "KZ10722S000056212617",
      holderBin: "061107551240",
      periodFrom: day(0).toISOString(),
      periodTo: day(23).toISOString(),
      openingBalance: 0,
      closingBalance: 59.5,
      fileName: "выписка.xlsx",
      lines: lines(),
    });
    statementId = dto.id;
    const by = (doc: string) => dto.lines.find((l) => l.docNumber === doc)!;
    expect(by("1").suggestion).toMatchObject({ action: BankLineAction.SALES_SETTLEMENT });
    expect(by("2").suggestion).toMatchObject({ action: BankLineAction.CATEGORY, presetCategory: BankPresetCategory.BANK_FEE });
    expect(by("3").suggestion).toMatchObject({ action: BankLineAction.CATEGORY, presetCategory: BankPresetCategory.OWNER_WITHDRAWAL });
    expect(by("4").suggestion).toMatchObject({ action: BankLineAction.SUPPLIER_PAYMENT, supplierId });
    expect(by("5").suggestion).toBeNull();
    // The day's takings: bank 1 500 vs till 1 500.
    expect(dto.settlement).toEqual([{ date: settlementDateOf(by("1").purpose, new Date(by("1").occurredAt)), bankAmount: 1500, systemAmount: 1500, difference: 0 }]);

    // The same file again: nothing is loaded twice.
    const again = await bank.upload(org.user, {
      accountId: org.bankAccountId, bankName: "Kaspi", iban: null, holderBin: null,
      periodFrom: day(0).toISOString(), periodTo: day(23).toISOString(), openingBalance: null, closingBalance: null, fileName: null, lines: lines(),
    });
    expect(again.duplicatesSkipped).toBe(6);
    expect(again.lines).toHaveLength(0);
    await bank.remove(org.user, again.id);
  });

  it("posts each line into the ordinary ledgers, dated by the bank, and only once", async () => {
    const dto = await bank.get(org.user, statementId);
    const by = (doc: string) => dto.lines.find((l) => l.docNumber === doc)!;
    const otherCategory = await prisma.financeCategory.create({
      data: { organizationId: org.organizationId, name: "Хозтовары", kind: "EXPENSE", pnlTreatment: "OPERATING_EXPENSE", cashActivity: "OPERATING", balanceTreatment: "NONE" },
    });
    const bankBefore = (await prisma.cashAccount.findUniqueOrThrow({ where: { id: org.bankAccountId } })).currentBalance.toNumber();
    const { system } = await loadDirectionContext(prisma, org.organizationId);
    const result = await bank.post(org.user, statementId, [
      { lineId: by("1").id, action: BankLineAction.SALES_SETTLEMENT },
      { lineId: by("2").id, action: BankLineAction.CATEGORY, presetCategory: BankPresetCategory.BANK_FEE },
      { lineId: by("3").id, action: BankLineAction.CATEGORY, presetCategory: BankPresetCategory.OWNER_WITHDRAWAL },
      { lineId: by("4").id, action: BankLineAction.SUPPLIER_PAYMENT, supplierId },
      { lineId: by("5").id, action: BankLineAction.CATEGORY, categoryId: otherCategory.id, locationId: org.storeId, directionId: system.RETAIL, remember: true },
      { lineId: by("6").id, action: BankLineAction.TRANSFER, targetAccountId: depositId },
    ]);
    expect(result.failed).toEqual([]);
    expect(result.posted).toBe(6);
    const bankAfter = (await prisma.cashAccount.findUniqueOrThrow({ where: { id: org.bankAccountId } })).currentBalance.toNumber();
    // Takings were already there; −10.5 −100 −800 −480 −50 now.
    expect(bankAfter).toBeCloseTo(bankBefore - 1440.5, 2);
    expect((await prisma.cashAccount.findUniqueOrThrow({ where: { id: depositId } })).currentBalance.toNumber()).toBe(50);
    const order = (await services.procurement.findAll(org.user)).find((o) => o.supplierId === supplierId)!;
    expect(order).toMatchObject({ amountPaid: 800, balanceDue: 200 });
    const fee = await prisma.expense.findFirstOrThrow({ where: { organizationId: org.organizationId, amount: 10.5 } });
    expect(fee.incurredOn.toISOString()).toBe(by("2").occurredAt);
    // Movements are dated by the bank, not by the click.
    const movement = await prisma.cashMovement.findFirstOrThrow({ where: { expenseId: fee.id } });
    expect(movement.occurredAt.toISOString()).toBe(by("2").occurredAt);
    // ТЗ §6.2: the point and direction chosen on the line are the expense's.
    const household = await prisma.expense.findFirstOrThrow({ where: { organizationId: org.organizationId, amount: 480 } });
    expect(household).toMatchObject({ locationId: org.storeId, directionId: system.RETAIL });
    expect(fee).toMatchObject({ locationId: null, directionId: null });
    // The system's balance at the statement's end equals the bank's.
    expect(result.statement.systemClosingBalance).toBeCloseTo(59.5, 2);

    // Posting again changes nothing.
    const twice = await bank.post(org.user, statementId, [{ lineId: by("2").id, action: BankLineAction.IGNORE }]);
    expect(twice.posted).toBe(0);
    expect(twice.failed[0].message).toMatch(/уже проведена/);

    // A remembered rule suggests the same next time.
    const next = await bank.upload(org.user, {
      accountId: org.bankAccountId, bankName: "Kaspi", iban: null, holderBin: null,
      periodFrom: day(0).toISOString(), periodTo: day(23).toISOString(), openingBalance: null, closingBalance: null, fileName: null,
      lines: [{ ...lines()[4], docNumber: "7", amount: -300 }],
    });
    expect(next.lines[0].suggestion).toMatchObject({ action: BankLineAction.CATEGORY, categoryId: otherCategory.id, source: "RULE" });
    await bank.remove(org.user, next.id);
  });

  it("refuses to pay a supplier more than is owed", async () => {
    const dto = await bank.upload(org.user, {
      accountId: org.bankAccountId, bankName: "Kaspi", iban: null, holderBin: null,
      periodFrom: day(0).toISOString(), periodTo: day(23).toISOString(), openingBalance: null, closingBalance: null, fileName: null,
      lines: [{ ...lines()[3], docNumber: "8", amount: -5000 }],
    });
    const r = await bank.post(org.user, dto.id, [{ lineId: dto.lines[0].id, action: BankLineAction.SUPPLIER_PAYMENT, supplierId }]);
    expect(r.failed[0].message).toMatch(/больше долга/);
    expect((await bank.get(org.user, dto.id)).lines[0].status).toBe("NEW");
    await bank.remove(org.user, dto.id);
  });

  it("suggests an article by a keyword in the purpose, and the keyword list can be kept", async () => {
    const rent = await prisma.financeCategory.create({
      data: { organizationId: org.organizationId, name: "Аренда", kind: "EXPENSE", pnlTreatment: "OPERATING_EXPENSE", cashActivity: "OPERATING", balanceTreatment: "NONE" },
    });
    await expect(bank.addKeywordRule(org.user, { keyword: "аренда", direction: 1, categoryId: rent.id })).rejects.toThrow(/статью дохода/);
    const list = await bank.addKeywordRule(org.user, { keyword: "Аренда", direction: -1, categoryId: rent.id });
    expect(list).toEqual([expect.objectContaining({ keyword: "Аренда", direction: -1, categoryName: "Аренда" })]);
    const dto = await bank.upload(org.user, {
      accountId: org.bankAccountId, bankName: "Halyk", iban: null, holderBin: null,
      periodFrom: day(0).toISOString(), periodTo: day(23).toISOString(), openingBalance: null, closingBalance: null, fileName: null,
      lines: [{ docNumber: "auto:k1", occurredAt: day(15, 6).toISOString(), amount: -40, counterpartyName: "ИП Арендодатель", counterpartyBin: "111111111111", counterpartyIban: null, knp: null, purpose: "Оплата за АРЕНДУ помещения за октябрь" }],
    });
    // «аренду» contains «аренд…» only by the stem; the rule is «аренда», so a different form does not match…
    expect(dto.lines[0].suggestion).toBeNull();
    await bank.addKeywordRule(org.user, { keyword: "аренд", direction: -1, categoryId: rent.id });
    const again = await bank.get(org.user, dto.id);
    expect(again.lines[0].suggestion).toMatchObject({ action: BankLineAction.CATEGORY, categoryId: rent.id, source: "KEYWORD" });
    const r = await bank.post(org.user, dto.id, [{ lineId: dto.lines[0].id, action: BankLineAction.CATEGORY, categoryId: rent.id }]);
    expect(r.posted).toBe(1);
    const rules = await bank.keywordRules(org.user);
    for (const rule of rules) await bank.removeKeywordRule(org.user, rule.id);
    expect(await bank.keywordRules(org.user)).toEqual([]);
  });

  it("a wholesale customer's payment found by БИН pays their sales oldest first, the rest is an advance", async () => {
    const customer = await prisma.customer.create({ data: { organizationId: org.organizationId, name: "ТОО Мерей", bin: "999988887777" } });
    const sale = await services.sales.create(org.user, {
      locationId: org.storeId, customerId: customer.id, amountPaid: 0, paymentMethod: PaymentMethod.TRANSFER,
      items: [{ productId: breadId, quantity: 2, unitPrice: 500 }],
    } as never);
    const dto = await bank.upload(org.user, {
      accountId: org.bankAccountId, bankName: "Halyk", iban: null, holderBin: null,
      periodFrom: day(0).toISOString(), periodTo: day(23).toISOString(), openingBalance: null, closingBalance: null, fileName: null,
      lines: [{ docNumber: "auto:c1", occurredAt: new Date(Date.now() - 60_000).toISOString(), amount: 1500, counterpartyName: "ТОО Мерей", counterpartyBin: "999988887777", counterpartyIban: null, knp: null, purpose: "Оплата за хлеб" }],
    });
    expect(dto.lines[0].suggestion).toMatchObject({ action: BankLineAction.CUSTOMER_PAYMENT, customerId: customer.id, source: "COUNTERPARTY" });
    const r = await bank.post(org.user, dto.id, [{ lineId: dto.lines[0].id, action: BankLineAction.CUSTOMER_PAYMENT, customerId: customer.id }]);
    expect(r.failed).toEqual([]);
    expect(r.statement.lines[0].resultNote).toMatch(/погашено продаж: 1, аванс 500/);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).amountPaid.toNumber()).toBe(1000);
    // An outflow cannot be a customer's payment.
    const out = await bank.upload(org.user, {
      accountId: org.bankAccountId, bankName: "Halyk", iban: null, holderBin: null,
      periodFrom: day(0).toISOString(), periodTo: day(23).toISOString(), openingBalance: null, closingBalance: null, fileName: null,
      lines: [{ docNumber: "auto:c2", occurredAt: day(15, 8).toISOString(), amount: -5, counterpartyName: "ТОО Мерей", counterpartyBin: "999988887777", counterpartyIban: null, knp: null, purpose: "?" }],
    });
    const bad = await bank.post(org.user, out.id, [{ lineId: out.lines[0].id, action: BankLineAction.CUSTOMER_PAYMENT, customerId: customer.id }]);
    expect(bad.failed[0].message).toMatch(/поступление/);
    await bank.remove(org.user, out.id);
  });

  it("keeps a bank's column mapping", async () => {
    await bank.saveProfile(org.user, { bankName: "Halyk", mapping: { date: "Дата", inflow: "Приход", outflow: "Расход", purpose: "Назначение" } });
    expect(await bank.profiles(org.user)).toEqual([{ bankName: "Halyk", mapping: { date: "Дата", inflow: "Приход", outflow: "Расход", purpose: "Назначение" } }]);
    await expect(bank.saveProfile(org.user, { bankName: "X", mapping: { date: "Дата" } })).rejects.toThrow(/суммы/);
  });

  it("the books, the events and the ledgers all agree", async () => {
    const events = await projector.project(org.organizationId);
    expect(checkEventInvariants(events).violations).toEqual([]);
    const report = await diagnostics.run(org.organizationId);
    expect(report.checks.filter((c) => c.status !== "PASS")).toEqual([]);
    const consistency = await checkLedgerConsistency(prisma, org.organizationId);
    expect(consistency.cash.drifts).toEqual([]);
    expect(await glBalance(ledger, org, K.SUPPLIER_PAYABLES)).toBe(200);
  });
});
