import { CashAccountType, PaymentMethod } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { CashAccountsService } from "./cash-accounts.service";
import { AUDIT_ACTION_GROUPS } from "../audit/audit";

// A point's card / Kaspi takings land in that point's own bank account (BCC for
// one shop, Kaspi Pay for the rest); a refund goes back out of the account the
// money came into. Own throwaway organization.

const prisma = new PrismaService();
const services = buildServices(prisma);
const accounts = new CashAccountsService(prisma);
let org: IsolatedOrg;
let breadId: string;
let bccId: string;

const balance = async (id: string) => (await prisma.cashAccount.findUniqueOrThrow({ where: { id } })).currentBalance.toNumber();
const cardSale = (locationId: string) =>
  services.sales.create(org.user, { locationId, paymentMethod: PaymentMethod.CARD, items: [{ productId: breadId, quantity: 1, unitPrice: 500 }] } as never);

beforeAll(async () => {
  await prisma.$connect();
  org = await createIsolatedOrg(prisma, "non-cash");
  const { organizationId } = org;
  await prisma.cashAccount.update({ where: { id: org.bankAccountId }, data: { isDefault: true } });
  bccId = (await prisma.cashAccount.create({ data: { organizationId, name: "BCC", type: CashAccountType.BANK } })).id;
  breadId = (await prisma.product.create({ data: { organizationId, name: "Хлеб", sku: "NC-1", unit: "PCS", type: "FINISHED_GOOD", price: 500 } })).id;
  for (const locationId of [org.storeId, org.warehouseId]) {
    await services.inventory.receive(org.user, { locationId, productId: breadId, quantity: 10 } as never);
  }
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

describe("a point's own account for card takings", () => {
  it("lands a point's card sale in its own account and the others in the default one", async () => {
    const list = await accounts.setNonCashAccount(org.user, org.storeId, bccId);
    expect(list.find((l) => l.locationId === org.storeId)?.accountId).toBe(bccId);
    const [kaspi0, bcc0] = [await balance(org.bankAccountId), await balance(bccId)];
    const sale = await cardSale(org.storeId);
    await cardSale(org.warehouseId);
    expect(await balance(bccId)).toBe(bcc0 + 500);
    expect(await balance(org.bankAccountId)).toBe(kaspi0 + 500);

    // Switched back later: the refund still leaves the account the money came into.
    await accounts.setNonCashAccount(org.user, org.storeId, null);
    await services.returns.create(org.user, sale.id, { items: [{ productId: breadId, quantity: 1 }], reason: "Вернули" });
    expect(await balance(bccId)).toBe(bcc0);
    expect(await balance(org.bankAccountId)).toBe(kaspi0 + 500);
  });

  it("only a bank account can take card money, and every change is audited", async () => {
    await expect(accounts.setNonCashAccount(org.user, org.storeId, org.cashAccountId)).rejects.toThrow(/банковский/);
    const logged = new Set((await prisma.auditLog.findMany({ where: { organizationId: org.organizationId } })).map((e) => e.action));
    expect(AUDIT_ACTION_GROUPS.nonCashAccounts.filter((a) => !logged.has(a))).toEqual([]);
  });
});
