import { CashMovementType } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";

// «Корректировка остатка» of a drawer whose books say far more than is in it: the
// shortage booked as «Изъятие собственника» moves the balance to the count and is
// NOT a loss in the P&L. Own throwaway organization.

const prisma = new PrismaService();
const services = buildServices(prisma);
let org: IsolatedOrg;

beforeAll(async () => {
  await prisma.$connect();
  org = await createIsolatedOrg(prisma, "cash-adjust-owner");
  await prisma.cashAccount.update({ where: { id: org.cashAccountId }, data: { currentBalance: 4_357_195 } });
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

it("books an untraceable shortage as the owner's withdrawal, not as an expense", async () => {
  const from = new Date(Date.now() - 60_000);
  const movement = await services.cash.adjust(org.user, {
    accountId: org.cashAccountId,
    actualBalance: 85_000,
    reason: "Пересчёт кассы",
    ownerWithdrawal: true,
  });
  expect(movement).toMatchObject({ type: CashMovementType.ADJUSTMENT, amount: -4_272_195 });
  const account = await prisma.cashAccount.findUniqueOrThrow({ where: { id: org.cashAccountId } });
  expect(account.currentBalance.toNumber()).toBe(85_000);

  const category = await prisma.financeCategory.findFirstOrThrow({ where: { organizationId: org.organizationId, name: "Изъятие собственника" } });
  expect(category).toMatchObject({ kind: "EXPENSE", pnlTreatment: "NOT_IN_PNL", balanceTreatment: "OWNER_WITHDRAWAL" });

  const pnl = await services.finance.getProfitAndLoss(org.organizationId, from, new Date());
  expect(pnl.expensesTotal).toBe(0);
  expect(pnl.otherResult).toBe(0);
  expect(pnl.netProfit).toBe(0);

  // A second one finds the same article instead of creating another.
  await services.cash.adjust(org.user, { accountId: org.cashAccountId, actualBalance: 80_000, reason: "Ещё раз", ownerWithdrawal: true });
  expect(await prisma.financeCategory.count({ where: { organizationId: org.organizationId, name: "Изъятие собственника" } })).toBe(1);
});

it("an overage cannot be called the owner's withdrawal, and without an article nothing is booked", async () => {
  await expect(
    services.cash.adjust(org.user, { accountId: org.cashAccountId, actualBalance: 1_000_000, reason: "x", ownerWithdrawal: true }),
  ).rejects.toThrow("Укажите статью");
  await expect(services.cash.adjust(org.user, { accountId: org.cashAccountId, actualBalance: 1, reason: "x" } as never)).rejects.toThrow("Укажите статью");
});
