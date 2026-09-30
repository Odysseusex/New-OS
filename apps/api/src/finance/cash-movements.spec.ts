import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { CashMovementsService } from "./cash-movements.service";
import { checkLedgerConsistency } from "./integrity/ledger-consistency";

// Cash deposit / withdrawal: the movement row and the account balance must
// commit together or not at all, and two withdrawals racing past the balance
// check must not overdraw the account. Business semantics are unchanged.

const prisma = new PrismaService();
let org: IsolatedOrg;
let accountId: string;

const balance = async () =>
  (await prisma.cashAccount.findUniqueOrThrow({ where: { id: accountId } })).currentBalance.toNumber();
const movements = (type: string) => prisma.cashMovement.count({ where: { accountId, type: type as never } });

beforeAll(async () => {
  await prisma.$connect();
  org = await createIsolatedOrg(prisma, "cash");
  accountId = org.cashAccountId;
});

afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

afterEach(() => jest.restoreAllMocks());

// Lets the real write happen, then fails — as a crash between the movement
// and the balance update, or right after both, would.
function failAfterRealWrite(service: CashMovementsService) {
  const real = CashMovementsService.prototype.recordMovement;
  return jest.spyOn(service, "recordMovement").mockImplementationOnce(async function (this: unknown, tx, params) {
    await real.call(service, tx, params);
    throw new Error("simulated failure after the movement was written");
  });
}

describe("cash deposit and withdrawal", () => {
  it("deposit: adds the amount and writes one CASH_DEPOSIT movement (unchanged semantics)", async () => {
    const service = new CashMovementsService(prisma);
    await service.deposit(org.user, { accountId, amount: 500, reason: "Пополнение" });
    expect(await balance()).toBe(500);
    expect(await movements("CASH_DEPOSIT")).toBe(1);
  });

  it("deposit is transactional: a failure after the movement leaves neither row nor balance change", async () => {
    const service = new CashMovementsService(prisma);
    const before = { balance: await balance(), rows: await movements("CASH_DEPOSIT") };
    failAfterRealWrite(service);

    await expect(service.deposit(org.user, { accountId, amount: 300 })).rejects.toThrow("simulated failure");
    expect(await balance()).toBe(before.balance);
    expect(await movements("CASH_DEPOSIT")).toBe(before.rows);
  });

  it("withdraw is transactional: a failure after the movement leaves neither row nor balance change", async () => {
    const service = new CashMovementsService(prisma);
    const before = { balance: await balance(), rows: await movements("CASH_WITHDRAWAL") };
    failAfterRealWrite(service);

    await expect(service.withdraw(org.user, { accountId, amount: 100 })).rejects.toThrow("simulated failure");
    expect(await balance()).toBe(before.balance);
    expect(await movements("CASH_WITHDRAWAL")).toBe(before.rows);
  });

  it("withdraw: refuses more than the balance with the same message as before", async () => {
    const service = new CashMovementsService(prisma);
    await expect(service.withdraw(org.user, { accountId, amount: 1_000_000 })).rejects.toThrow(
      "Недостаточно денег на счёте для снятия",
    );
    await service.withdraw(org.user, { accountId, amount: 200, reason: "Снятие" });
    expect(await balance()).toBe(300);
  });

  it("two simultaneous withdrawals of 200 from 300: exactly one succeeds, the account never goes negative", async () => {
    const service = new CashMovementsService(prisma);
    const rowsBefore = await movements("CASH_WITHDRAWAL");
    const results = await Promise.allSettled([
      service.withdraw(org.user, { accountId, amount: 200 }),
      service.withdraw(org.user, { accountId, amount: 200 }),
    ]);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");

    expect(rejected).toHaveLength(1);
    expect((rejected[0].reason as Error).message).toBe("Недостаточно денег на счёте для снятия");
    expect(await balance()).toBe(100);
    expect(await movements("CASH_WITHDRAWAL")).toBe(rowsBefore + 1);
  });

  it("the cash ledger still explains the balance after all of it", async () => {
    const report = await checkLedgerConsistency(prisma, org.organizationId);
    expect(report.cash.drifts).toEqual([]);
    expect(report.cash.negativeBalances).toEqual([]);
  });
});
