import { JwtService } from "@nestjs/jwt";
import { PaymentMethod, Role } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { AUDIT_ACTION_GROUPS } from "../audit/audit";
import { UsersService } from "../users/users.service";
import { TillShiftsService } from "../till-shifts/till-shifts.service";
import { AuthService } from "./auth.service";
import { resetPinThrottle } from "./till-pin";

// The till's PIN and the senior cashier (ТЗ §5.4): a PIN per employee, «сменить
// кассира» by PIN, and a cashier's discount / return / line removal approved by a
// senior cashier's PIN. Own throwaway organization.

const prisma = new PrismaService();
const services = buildServices(prisma);
const users = new UsersService(prisma);
const auth = new AuthService(prisma, new JwtService({ secret: process.env.JWT_SECRET ?? "dev-secret-change-me", signOptions: { expiresIn: "8h" } }));
const shifts = new TillShiftsService(prisma, services.cash);
let org: IsolatedOrg;
let breadId: string;
let cashier: IsolatedOrg["user"];
let senior: IsolatedOrg["user"];

const person = async (role: Role, name: string, locationId: string | null) => {
  const u = await prisma.user.create({
    data: { organizationId: org.organizationId, fullName: name, email: `${role}-${Math.random()}@iso.test`, passwordHash: "x", role, locationId },
  });
  return { ...org.user, id: u.id, fullName: name, role, locationId };
};

beforeAll(async () => {
  await prisma.$connect();
  resetPinThrottle();
  org = await createIsolatedOrg(prisma, "till-pin");
  breadId = (await prisma.product.create({ data: { organizationId: org.organizationId, name: "Батон", sku: "TP-1", unit: "PCS", type: "FINISHED_GOOD", price: 1000 } })).id;
  await services.inventory.receive(org.user, { locationId: org.storeId, productId: breadId, quantity: 20 } as never);
  cashier = await person(Role.CASHIER, "Кассир Дана", org.storeId);
  senior = await person(Role.SENIOR_CASHIER, "Старший Ерлан", org.storeId);
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

const sell = (who: IsolatedOrg["user"], extra: object = {}) =>
  services.sales.create(who, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items: [{ productId: breadId, quantity: 2, unitPrice: 1000 }], ...extra } as never);

describe("till PIN and senior cashier", () => {
  it("sets a PIN only as a digest, unique in the organization", async () => {
    const dto = await users.setPin(org.user, cashier.id, "1234");
    expect(dto.hasPin).toBe(true);
    await users.setPin(org.user, senior.id, "9876");
    await expect(users.setPin(org.user, senior.id, "1234")).rejects.toThrow(/занят/);
    await expect(users.setPin(org.user, senior.id, "12")).rejects.toThrow(/4 до 6 цифр/);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: cashier.id } });
    expect(row.pinDigest).not.toContain("1234");
  });

  it("switches the till to another cashier by PIN; a wrong PIN is refused", async () => {
    const login = await auth.pinLogin(senior, "1234");
    expect(login.user).toMatchObject({ id: cashier.id, role: Role.CASHIER });
    await expect(auth.pinLogin(senior, "0000")).rejects.toThrow(/Неверный PIN/);
  });

  it("a cashier's discount needs the senior cashier's PIN; the senior gives it directly", async () => {
    await expect(sell(cashier, { manualDiscount: { percent: 10 } })).rejects.toThrow(/старшего кассира/);
    // The cashier's own PIN does not approve.
    await expect(auth.tillApproval(cashier, "1234", "DISCOUNT")).rejects.toThrow(/не у старшего кассира/);

    const { approvalToken, approverName } = await auth.tillApproval(cashier, "9876", "DISCOUNT");
    expect(approverName).toBe("Старший Ерлан");
    // An approval for something else, or a login token, does not do.
    const wrong = await auth.tillApproval(cashier, "9876", "RETURN");
    await expect(sell(cashier, { manualDiscount: { percent: 10 }, approvalToken: wrong.approvalToken })).rejects.toThrow(/не подходит/);

    const sale = await sell(cashier, { manualDiscount: { percent: 10 }, approvalToken });
    expect(sale.totalAmount).toBe(1800);
    expect(sale).toMatchObject({ manualDiscountAmount: 200, discountApprovedByName: "Старший Ерлан" });
    const line = await prisma.saleItem.findFirstOrThrow({ where: { saleId: sale.id } });
    expect(line.fullUnitPrice?.toNumber()).toBe(1000);
    expect(line.unitPrice.toNumber()).toBe(900);
    expect(line.manualDiscount?.toNumber()).toBe(200);

    const own = await sell(senior, { manualDiscount: { amount: 500 } });
    expect(own).toMatchObject({ totalAmount: 1500, discountApprovedByName: "Старший Ерлан" });
    await expect(sell(senior, { manualDiscount: { amount: 100 }, loyaltyPointsToRedeem: 10 })).rejects.toThrow(/не совмещается/);

    // The P&L sees it as a discount: net revenue = 3 300 of 4 000 at list price.
    const pnl = await services.finance.getProfitAndLoss(org.organizationId, new Date(Date.now() - 600_000), new Date());
    expect(pnl).toMatchObject({ grossRevenue: 4000, discountsTotal: 700, netRevenue: 3300 });
  });

  it("a cashier's return goes through with the senior cashier's PIN and records who approved", async () => {
    const sale = await sell(cashier);
    await expect(services.returns.create(cashier, sale.id, { items: [{ productId: breadId, quantity: 1 }], reason: "Брак" })).rejects.toThrow(/старшего кассира/);
    const { approvalToken } = await auth.tillApproval(cashier, "9876", "RETURN");
    const ret = await services.returns.create(cashier, sale.id, { items: [{ productId: breadId, quantity: 1 }], reason: "Брак", approvalToken } as never);
    const row = await prisma.saleReturn.findUniqueOrThrow({ where: { id: ret.id } });
    expect(row.approvedByName).toBe("Старший Ерлан");
  });

  it("logs an approved line removal, and the switch is audited", async () => {
    await shifts.setLineRemovalApproval(org.user, true);
    expect((await shifts.state(cashier, undefined)).lineRemovalApproval).toBe(true);
    await auth.tillApproval(cashier, "9876", "LINE_REMOVAL", org.storeId, "Батон × 1");
    const logged = new Set((await prisma.auditLog.findMany({ where: { organizationId: org.organizationId } })).map((e) => e.action));
    expect(AUDIT_ACTION_GROUPS.tillApprovals.filter((a) => !logged.has(a))).toEqual([]);
  });
});
