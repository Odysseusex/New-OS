import { Prisma } from "@prisma/client";
import { AUDIT_ACTION_GROUPS } from "../audit/audit";
import {
  AccountingEventStatus,
  JournalEntryKind,
  LedgerAccountType,
  NormalBalance,
  PaymentMethod,
  ProductType,
  SYSTEM_ACCOUNT_KEYS,
  SystemAccountKey,
  Unit,
} from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { accountId, countEntries, glBalance, startLedger } from "../../test/support/ledger-fixture";
import { buildServices } from "../../test/support/services";
import { LedgerService } from "./ledger.service";
import { postLedgerSources } from "./event-posting";
import { postJournalEntry } from "./journal-core";
import { LedgerRejectedError } from "./journal-math";

// The engine against a real database: the double-entry rules, immutability,
// reversal, periods, isolation, atomicity and concurrency.

const prisma = new PrismaService();
const services = buildServices(prisma);
const ledger = new LedgerService(prisma);
const originalFiscal = process.env.FISCALIZATION_ENABLED;
const D = (v: number | string) => new Prisma.Decimal(v);

let org: IsolatedOrg;
let other: IsolatedOrg;
let breadId: string;
let cashAcc: string;
let equityAcc: string;
let revenueAcc: string;

beforeAll(async () => {
  await prisma.$connect();
  delete process.env.FISCALIZATION_ENABLED;
  org = await createIsolatedOrg(prisma, "ledger-engine");
  other = await createIsolatedOrg(prisma, "ledger-other");
  const flour = await prisma.product.create({
    data: { organizationId: org.organizationId, name: "Мука", sku: "L-ING", unit: Unit.KG, type: ProductType.RAW_MATERIAL, price: 100 },
  });
  const bread = await prisma.product.create({
    data: { organizationId: org.organizationId, name: "Хлеб", sku: "L-PRD", unit: Unit.PCS, type: ProductType.FINISHED_GOOD, price: 500 },
  });
  breadId = bread.id;
  await prisma.recipe.create({
    data: { organizationId: org.organizationId, productId: bread.id, yieldQuantity: 4, items: { create: [{ ingredientProductId: flour.id, quantity: 2 }] } },
  });
  await services.inventory.receive(org.user, { locationId: org.storeId, productId: bread.id, quantity: 50 });
});

afterAll(async () => {
  if (originalFiscal === undefined) delete process.env.FISCALIZATION_ENABLED;
  else process.env.FISCALIZATION_ENABLED = originalFiscal;
  const leftovers = [...(await destroyOrg(prisma, org.organizationId)), ...(await destroyOrg(prisma, other.organizationId))];
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

const sellBread = (quantity = 1, paymentMethod: PaymentMethod = PaymentMethod.CASH) =>
  services.sales.create(org.user, { locationId: org.storeId, paymentMethod, items: [{ productId: breadId, quantity, unitPrice: 500 }] } as never);

describe("off by default", () => {
  it("posts nothing and reads nothing while the ledger is off: every flow behaves as before", async () => {
    await sellBread();
    expect(await countEntries(prisma, org)).toBe(0);
    expect(await prisma.accountingEvent.count({ where: { organizationId: org.organizationId } })).toBe(0);
    const status = await ledger.getStatus(org.organizationId);
    expect(status.enabled).toBe(false);
    expect(status.systemAccountsReady).toBe(false);
  });

  it("refuses to start before the system accounts exist, and once it has started cannot start again", async () => {
    await expect(ledger.enable(org.user, { startsAt: new Date().toISOString() })).rejects.toThrow(/системные счета/);
    const created = await ledger.initializeSystemAccounts(org.user);
    expect(created.created).toHaveLength(SYSTEM_ACCOUNT_KEYS.length);
    // Idempotent: asking again creates nothing new.
    expect((await ledger.initializeSystemAccounts(org.user)).created).toEqual([]);
    await expect(ledger.enable(org.user, { startsAt: new Date(Date.now() + 5 * 86400_000).toISOString() })).rejects.toThrow(/будущем/);
    const status = await ledger.enable(org.user, { startsAt: new Date(Date.now() - 3600_000).toISOString() });
    expect(status.enabled).toBe(true);
    await expect(ledger.enable(org.user, { startsAt: new Date().toISOString() })).rejects.toThrow(/уже запущена/);
    cashAcc = await accountId(ledger, org, SystemAccountKey.CASH_ON_HAND);
    equityAcc = await accountId(ledger, org, SystemAccountKey.OPENING_EQUITY);
    revenueAcc = await accountId(ledger, org, SystemAccountKey.SALES_REVENUE);
  });
});

describe("A–C: every entry balances, and the books refuse anything else", () => {
  it("A. a balanced manual entry is posted, numbered and traceable to its author", async () => {
    const entry = await ledger.postManual(org.user, {
      entryDate: new Date().toISOString(),
      description: "Взнос собственника",
      lines: [
        { accountId: cashAcc, debit: 1000 },
        { accountId, credit: 1000 } as never,
      ].map((l, i) => (i === 1 ? { accountId: equityAcc, credit: 1000 } : l)),
    });
    expect(entry.totalDebit).toBe(1000);
    expect(entry.totalCredit).toBe(1000);
    expect(entry.kind).toBe(JournalEntryKind.MANUAL);
    expect(entry.number).toBeGreaterThan(0);
    expect(entry.postedByName).toBe("Тест Владелец");
  });

  it("B. an unbalanced entry is rejected before anything is written", async () => {
    const before = await countEntries(prisma, org);
    await expect(
      ledger.postManual(org.user, {
        entryDate: new Date().toISOString(),
        description: "Кривая",
        lines: [{ accountId: cashAcc, debit: 1000 }, { accountId: equityAcc, credit: 999.99 }],
      }),
    ).rejects.toThrow(/не сбалансирована/);
    expect(await countEntries(prisma, org)).toBe(before);
  });

  it("B. …and the database itself refuses an unbalanced entry from a client that bypasses the service", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        const period = await tx.financialPeriod.findFirstOrThrow({ where: { organizationId: org.organizationId } });
        const entry = await tx.journalEntry.create({
          data: { organizationId: org.organizationId, number: 9001, accountingPeriodId: period.id, entryDate: new Date(), description: "обход", createdById: org.user.id, postedById: org.user.id },
        });
        await tx.journalLine.createMany({
          data: [
            { organizationId: org.organizationId, journalEntryId: entry.id, lineNo: 1, accountId: cashAcc, debit: 10, credit: 0, amount: 10 },
            { organizationId: org.organizationId, journalEntryId: entry.id, lineNo: 2, accountId: equityAcc, debit: 0, credit: 9, amount: 9 },
          ],
        });
      }),
    ).rejects.toThrow(/не сбалансирована/);
    expect(await prisma.journalEntry.count({ where: { organizationId: org.organizationId, number: 9001 } })).toBe(0);
  });

  it("C. negative, two-sided and zero lines are rejected — by the service and by the database", async () => {
    const post = (lines: { accountId: string; debit?: number; credit?: number }[]) =>
      ledger.postManual(org.user, { entryDate: new Date().toISOString(), description: "x", lines });
    await expect(post([{ accountId: cashAcc, debit: -5 }, { accountId: equityAcc, credit: -5 }])).rejects.toThrow(/отрицательная/);
    await expect(post([{ accountId: cashAcc, debit: 5, credit: 5 }, { accountId: equityAcc, credit: 10 }])).rejects.toThrow(/одновременно/);
    await expect(post([{ accountId: cashAcc }, { accountId: equityAcc }])).rejects.toThrow(/нулевая/);
    await expect(post([{ accountId: cashAcc, debit: 1 }])).rejects.toThrow(/не менее двух/);

    const period = await prisma.financialPeriod.findFirstOrThrow({ where: { organizationId: org.organizationId } });
    const entry = await prisma.journalEntry.findFirstOrThrow({ where: { organizationId: org.organizationId } });
    for (const [debit, credit] of [[-5, 0], [5, 5], [0, 0]]) {
      await expect(
        prisma.journalLine.create({
          data: { organizationId: org.organizationId, journalEntryId: entry.id, lineNo: 99, accountId: cashAcc, debit, credit, amount: debit + credit },
        }),
      ).rejects.toThrow(/check constraint/);
    }
    expect(period).toBeTruthy();
  });

  it("X. amounts are exact: 0.10 + 0.20 balances 0.30, three decimals are refused, big sums keep their cents", async () => {
    const e1 = await ledger.postManual(org.user, {
      entryDate: new Date().toISOString(),
      description: "Копейки",
      lines: [{ accountId: cashAcc, debit: 0.1 }, { accountId: cashAcc, debit: 0.2 }, { accountId: equityAcc, credit: 0.3 }],
    });
    expect(e1.totalDebit).toBe(0.3);
    await expect(
      ledger.postManual(org.user, { entryDate: new Date().toISOString(), description: "x", lines: [{ accountId: cashAcc, debit: 10.005 }, { accountId: equityAcc, credit: 10.005 }] }),
    ).rejects.toThrow(/двух знаков/);
    const big = await ledger.postManual(org.user, {
      entryDate: new Date().toISOString(),
      description: "Крупная сумма",
      lines: [{ accountId: cashAcc, debit: 123456789012.34 }, { accountId: equityAcc, credit: 123456789012.34 }],
    });
    expect(big.totalCredit).toBe(123456789012.34);
    // Reverse the big one so later balance checks are not distorted.
    await ledger.reverse(org.user, big.id, "Тестовая крупная сумма");
  });
});

describe("D–F: no duplicates, reversal instead of edit, posted rows are immutable", () => {
  let entryId: string;

  it("D. posting the same source twice, even concurrently, makes one entry per event", async () => {
    const sale = await sellBread(2);
    const base = await countEntries(prisma, org, { accountingEvent: { sourceId: sale.id } });
    expect(base).toBe(2); // the sale and its cost
    const run = () =>
      prisma.$transaction((tx) => postLedgerSources(tx, { organizationId: org.organizationId, actorId: org.user.id, scope: { saleIds: [sale.id] }, immediate: true }));
    const results = await Promise.all([run(), run(), run(), run(), run()]);
    expect(results.every((r) => r.posted === 0 && r.alreadyDone === 2)).toBe(true);
    expect(await countEntries(prisma, org, { accountingEvent: { sourceId: sale.id } })).toBe(2);
    const duplicates = await prisma.accountingEvent.groupBy({ by: ["eventKey"], where: { organizationId: org.organizationId }, _count: true, having: { eventKey: { _count: { gt: 1 } } } });
    expect(duplicates).toEqual([]);
  });

  it("W. a catch-up run posts each pending event once, however many run at the same time", async () => {
    // Detach the sale's own events to simulate operations the hooks never saw.
    const sale = await sellBread(1);
    const keys = [`sale:${sale.id}`, `sale:${sale.id}:cost`];
    const entries = await prisma.journalEntry.findMany({ where: { organizationId: org.organizationId, accountingEvent: { eventKey: { in: keys } } }, select: { id: true } });
    expect(entries).toHaveLength(2);
    // (Rows are immutable, so the catch-up is exercised on events that really are pending:
    // a brand new operation with the ledger's hook bypassed.)
    const sale2 = await prisma.$transaction(async (tx) => {
      const created = await tx.sale.create({
        data: {
          organizationId: org.organizationId,
          locationId: org.storeId,
          totalAmount: 500,
          amountPaid: 500,
          paymentMethod: "CASH",
          createdById: org.user.id,
          items: { create: [{ productId: breadId, quantity: 1, unitPrice: 500, subtotal: 500, unitCost: 50, costBasis: "RECIPE_CURRENT" }] },
        },
      });
      return created;
    });
    const results = await Promise.all([ledger.postPending(org.user), ledger.postPending(org.user), ledger.postPending(org.user)]);
    expect(results.reduce((s, r) => s + r.posted, 0)).toBeGreaterThanOrEqual(2);
    expect(await countEntries(prisma, org, { accountingEvent: { sourceId: sale2.id } })).toBe(2);
  });

  it("E. a reversal is the exact opposite, new, linked, and can happen only once", async () => {
    const original = await ledger.postManual(org.user, {
      entryDate: new Date().toISOString(),
      description: "К сторно",
      lines: [{ accountId: cashAcc, debit: 700 }, { accountId: revenueAcc, credit: 700 }],
    });
    entryId = original.id;
    const reversal = await ledger.reverse(org.user, original.id, "Ошибочная проводка");
    expect(reversal.kind).toBe(JournalEntryKind.REVERSAL);
    expect(reversal.reversalOfEntryId).toBe(original.id);
    expect(reversal.reversalReason).toBe("Ошибочная проводка");
    const swapped = reversal.lines.map((l) => ({ a: l.accountId, d: l.credit, c: l.debit }));
    expect(swapped).toEqual(original.lines.map((l) => ({ a: l.accountId, d: l.debit, c: l.credit })));
    const reread = await ledger.getEntry(org.organizationId, original.id);
    expect(reread.reversedByEntryId).toBe(reversal.id);
    // The original is untouched.
    expect(reread.lines.map((l) => [l.debit, l.credit])).toEqual(original.lines.map((l) => [l.debit, l.credit]));
    await expect(ledger.reverse(org.user, original.id, "ещё раз")).rejects.toThrow(/уже сторнирована/);
    await expect(ledger.reverse(org.user, reversal.id, "сторно сторно")).rejects.toThrow(/не сторнируют/);
    await expect(ledger.reverse(org.user, original.id, "  ")).rejects.toThrow(/причину/);
  });

  it("E. concurrent reversals of one entry produce exactly one", async () => {
    const e = await ledger.postManual(org.user, {
      entryDate: new Date().toISOString(),
      description: "Гонка",
      lines: [{ accountId: cashAcc, debit: 11 }, { accountId: revenueAcc, credit: 11 }],
    });
    const outcomes = await Promise.allSettled([1, 2, 3, 4].map((n) => ledger.reverse(org.user, e.id, `попытка ${n}`)));
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.journalEntry.count({ where: { reversalOfEntryId: e.id } })).toBe(1);
  });

  it("F. a posted entry and its lines cannot be changed — the database refuses, whatever the client", async () => {
    await expect(prisma.journalEntry.update({ where: { id: entryId }, data: { description: "подделка" } })).rejects.toThrow(/не изменяется/);
    await expect(prisma.journalLine.updateMany({ where: { journalEntryId: entryId }, data: { debit: 1, amount: 1 } })).rejects.toThrow(/не изменяется/);
    await expect(prisma.$executeRaw`UPDATE "journal_entries" SET "entryDate" = NOW() WHERE "id" = ${entryId}`).rejects.toThrow(/не изменяется/);
    const e = await ledger.getEntry(org.organizationId, entryId);
    expect(e.description).toBe("К сторно");
  });

  it("an entry that a reversal has cancelled still shows in the book with its mirror: net zero", async () => {
    const book = await ledger.getAccountLedger(org.organizationId, revenueAcc, {});
    const mine = book.rows.filter((r) => r.description.includes("К сторно"));
    expect(mine.length).toBe(2);
    expect(mine.reduce((s, r) => s + r.credit - r.debit, 0)).toBe(0);
  });
});

describe("G: periods", () => {
  it("a closed period refuses a manual entry; the business operation still succeeds and the event waits, visibly", async () => {
    const now = new Date();
    const period = await prisma.financialPeriod.findFirstOrThrow({
      where: { organizationId: org.organizationId, year: now.getFullYear(), month: now.getMonth() + 1 },
    });
    await prisma.financialPeriod.update({ where: { id: period.id }, data: { status: "CLOSED", closedAt: new Date() } });
    try {
      await expect(
        ledger.postManual(org.user, { entryDate: now.toISOString(), description: "в закрытый", lines: [{ accountId: cashAcc, debit: 1 }, { accountId: revenueAcc, credit: 1 }] }),
      ).rejects.toThrow(/закрыт/);
      const sale = await sellBread(1);
      expect(sale.id).toBeTruthy();
      const waiting = await prisma.accountingEvent.findMany({ where: { organizationId: org.organizationId, sourceId: sale.id } });
      expect(waiting.length).toBeGreaterThan(0);
      expect(waiting.every((e) => e.status === AccountingEventStatus.NOT_POSTED && e.statusReason === "PERIOD_CLOSED")).toBe(true);
    } finally {
      await prisma.financialPeriod.update({ where: { id: period.id }, data: { status: "OPEN" } });
    }
    // Reopened: the same events can now be posted by the catch-up.
    const result = await ledger.postPending(org.user);
    expect(result.posted).toBeGreaterThan(0);
  });
});

describe("chart of accounts", () => {
  it("creates, nests and edits accounts under the rules", async () => {
    const parent = await ledger.createAccount(org.user, { code: "1000", name: "Оборотные активы", type: LedgerAccountType.ASSET });
    expect(parent.normalBalance).toBe(NormalBalance.DEBIT);
    const child = await ledger.createAccount(org.user, { code: "1010", name: "Касса №2", type: LedgerAccountType.ASSET, parentId: parent.id });
    await expect(ledger.createAccount(org.user, { code: "1010", name: "Дубль", type: LedgerAccountType.ASSET })).rejects.toThrow(/уже есть/);
    await expect(ledger.createAccount(org.user, { code: "2000", name: "Не тот тип", type: LedgerAccountType.LIABILITY, parentId: parent.id })).rejects.toThrow(/того же типа/);
    await expect(ledger.updateAccount(org.user, parent.id, { parentId: child.id })).rejects.toThrow(/самого себя/);
    const contra = await ledger.createAccount(org.user, { code: "1099", name: "Резерв", type: LedgerAccountType.ASSET, normalBalance: NormalBalance.CREDIT });
    expect(contra.normalBalance).toBe(NormalBalance.CREDIT);
    const renamed = await ledger.updateAccount(org.user, child.id, { name: "Касса №2 (склад)", code: "1011" });
    expect(renamed.code).toBe("1011");
    // A system account can be renamed, never retyped or switched off.
    const bank = await ledger.listAccounts(org.organizationId).then((a) => a.find((x) => x.systemAccountKey === SystemAccountKey.BANK)!);
    expect((await ledger.updateAccount(org.user, bank.id, { name: "Расчётный счёт" })).name).toBe("Расчётный счёт");
    await expect(ledger.updateAccount(org.user, bank.id, { type: LedgerAccountType.LIABILITY })).rejects.toThrow(/системного счёта/);
    await expect(ledger.updateAccount(org.user, bank.id, { isActive: false })).rejects.toThrow(/Системный счёт/);
  });

  it("an account with postings keeps its type; an inactive account takes no postings", async () => {
    await expect(ledger.updateAccount(org.user, cashAcc, { type: LedgerAccountType.REVENUE })).rejects.toThrow();
    const spare = await ledger.createAccount(org.user, { code: "7777", name: "Запасной", type: LedgerAccountType.OPERATING_EXPENSE });
    await ledger.updateAccount(org.user, spare.id, { isActive: false });
    await expect(
      ledger.postManual(org.user, { entryDate: new Date().toISOString(), description: "в отключённый", lines: [{ accountId: spare.id, debit: 5 }, { accountId: cashAcc, credit: 5 }] }),
    ).rejects.toThrow(/отключён/);
  });
});

describe("opening balance (D3): explicit, reviewed, once", () => {
  it("proposes nothing when no opening position was declared, and posts only what a person submits", async () => {
    const proposal = await ledger.proposeOpening(org.organizationId);
    expect(proposal.lines).toEqual([]);
    expect(proposal.notes.join(" ")).toMatch(/не заявлено/);
    await expect(
      ledger.postOpening(org.user, { lines: [{ systemAccountKey: SystemAccountKey.INVENTORY, amount: 2500 }, { systemAccountKey: SystemAccountKey.OPENING_EQUITY, amount: 2400 }] }),
    ).rejects.toThrow(/не сбалансирована/);
    const opening = await ledger.postOpening(org.user, {
      lines: [{ systemAccountKey: SystemAccountKey.INVENTORY, amount: 2500 }, { systemAccountKey: SystemAccountKey.OPENING_EQUITY, amount: 2500 }],
    });
    expect(opening.kind).toBe(JournalEntryKind.OPENING_BALANCE);
    await expect(
      ledger.postOpening(org.user, { lines: [{ systemAccountKey: SystemAccountKey.INVENTORY, amount: 1 }, { systemAccountKey: SystemAccountKey.OPENING_EQUITY, amount: 1 }] }),
    ).rejects.toThrow(/уже проведён/);
    expect((await ledger.getStatus(org.organizationId)).openingEntryPosted).toBe(true);
  });
});

describe("U: organizations never see each other", () => {
  it("accounts, entries, balances and the trial balance of one organization are invisible to another", async () => {
    await startLedger(ledger, other);
    const otherCash = await accountId(ledger, other, SystemAccountKey.CASH_ON_HAND);
    const otherEquity = await accountId(ledger, other, SystemAccountKey.OPENING_EQUITY);
    const theirs = await ledger.postManual(other.user, {
      entryDate: new Date().toISOString(),
      description: "Чужая",
      lines: [{ accountId: otherCash, debit: 42 }, { accountId: otherEquity, credit: 42 }],
    });

    expect((await ledger.listAccounts(org.organizationId)).some((a) => a.id === otherCash)).toBe(false);
    expect((await ledger.listEntries(org.organizationId, {})).some((e) => e.id === theirs.id)).toBe(false);
    await expect(ledger.getEntry(org.organizationId, theirs.id)).rejects.toThrow(/не найдена/);
    await expect(ledger.getAccountLedger(org.organizationId, otherCash, {})).rejects.toThrow(/не найден/);
    await expect(ledger.reverse(org.user, theirs.id, "чужую")).rejects.toThrow(/не найдена/);
    await expect(ledger.updateAccount(org.user, otherCash, { name: "взлом" })).rejects.toThrow(/не найден/);
    // Posting INTO another organization's account is refused.
    await expect(
      ledger.postManual(org.user, { entryDate: new Date().toISOString(), description: "в чужой счёт", lines: [{ accountId: otherCash, debit: 1 }, { accountId: cashAcc, credit: 1 }] }),
    ).rejects.toThrow(/не найден в этой организации/);
    // Each trial balance is its own and balances on its own.
    const tbOther = await ledger.getTrialBalance(other.organizationId, {});
    expect(tbOther.rows.map((r) => r.accountId).sort()).toEqual([otherCash, otherEquity].sort());
    const tbMine = await ledger.getTrialBalance(org.organizationId, {});
    expect(tbMine.rows.some((r) => r.accountId === otherCash)).toBe(false);
    expect(tbMine.totals.balanced && tbOther.totals.balanced).toBe(true);
  });
});

describe("V: atomicity — an operation and its entries commit or roll back together", () => {
  it("a failure after posting leaves no entry, no event and no gap in the numbering", async () => {
    const sale = await sellBread(1);
    const lastBefore = (await prisma.journalEntry.aggregate({ where: { organizationId: org.organizationId }, _max: { number: true } }))._max.number!;
    const eventsBefore = await prisma.accountingEvent.count({ where: { organizationId: org.organizationId } });
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.journalEntry.deleteMany({ where: { id: "none" } });
        await postJournalEntry(tx, {
          organizationId: org.organizationId,
          entryDate: new Date(),
          description: "откатится",
          kind: "MANUAL",
          actorId: org.user.id,
          lines: [
            { accountId: cashAcc, debit: D(5), credit: D(0) },
            { accountId: revenueAcc, debit: D(0), credit: D(5) },
          ],
        });
        throw new Error("сбой после проводки");
      }),
    ).rejects.toThrow(/сбой после проводки/);
    expect((await prisma.journalEntry.aggregate({ where: { organizationId: org.organizationId }, _max: { number: true } }))._max.number).toBe(lastBefore);
    expect(await prisma.accountingEvent.count({ where: { organizationId: org.organizationId } })).toBe(eventsBefore);
    // The next entry takes the very next number: nothing was burned.
    const next = await ledger.postManual(org.user, { entryDate: new Date().toISOString(), description: "после отката", lines: [{ accountId: cashAcc, debit: 1 }, { accountId: revenueAcc, credit: 1 }] });
    expect(next.number).toBe(lastBefore + 1);
    expect(sale.id).toBeTruthy();
  });

  it("when the sale itself fails (not enough stock), nothing of it reaches the ledger", async () => {
    const before = await countEntries(prisma, org);
    await expect(sellBread(10_000)).rejects.toThrow();
    expect(await countEntries(prisma, org)).toBe(before);
  });
});

describe("the trial balance and the books after all of the above", () => {
  it("H. balances to the cent, and every entry balances on its own", async () => {
    const tb = await ledger.getTrialBalance(org.organizationId, {});
    expect(tb.totals.balanced).toBe(true);
    expect(tb.totals.difference).toBe(0);
    expect(tb.totals.closingDebit).toBe(tb.totals.closingCredit);
    const lopsided = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "journalEntryId" AS id FROM "journal_lines" WHERE "organizationId" = ${org.organizationId}
      GROUP BY "journalEntryId" HAVING SUM("debit") <> SUM("credit")`;
    expect(lopsided).toEqual([]);
  });

  it("the general ledger of an account keeps a correct running balance", async () => {
    const book = await ledger.getAccountLedger(org.organizationId, cashAcc, {});
    let running = 0;
    for (const row of book.rows) {
      running = Math.round((running + row.debit - row.credit) * 100) / 100;
      expect(row.runningBalance).toBe(running);
    }
    expect(book.closingBalance).toBe(running);
    expect(book.closingBalance).toBe(await glBalance(ledger, org, SystemAccountKey.CASH_ON_HAND));
    // A window carries the opening balance of everything before it.
    const cut = book.rows[Math.floor(book.rows.length / 2)].date;
    const window = await ledger.getAccountLedger(org.organizationId, cashAcc, { from: cut });
    expect(window.openingBalance + window.periodDebit - window.periodCredit).toBeCloseTo(book.closingBalance, 2);
  });
});

describe("audit: deliberate human actions are logged with who and what", () => {
  it("covers every action of the ledger group", async () => {
    const logged = new Set((await prisma.auditLog.findMany({ where: { organizationId: org.organizationId } })).map((e) => e.action));
    // postPending is exercised above; the others come from setup, accounts, entries and reversal.
    const missing = AUDIT_ACTION_GROUPS.ledger.filter((a) => !logged.has(a));
    expect(missing).toEqual([]);
    const reverse = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: org.organizationId, action: "ledger.entry.reverse" } });
    expect(reverse.actorId).toBe(org.user.id);
    expect(reverse.reason).toBeTruthy();
    expect(reverse.after).toMatchObject({ reversalNumber: expect.any(Number) });
  });
});

describe("a ledger error is a LedgerRejectedError with a code", () => {
  it("is distinguishable from a fault", async () => {
    await expect(postJournalEntry(prisma as never, { organizationId: org.organizationId, entryDate: new Date(), description: "x", kind: "MANUAL", actorId: org.user.id, lines: [] })).rejects.toBeInstanceOf(LedgerRejectedError);
  });
});
