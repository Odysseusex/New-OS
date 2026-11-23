import { JwtService } from "@nestjs/jwt";
import { PaymentMethod, Role } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { UsersService } from "../users/users.service";
import { TillShiftsService } from "../till-shifts/till-shifts.service";
import { AuthService } from "./auth.service";
import { resetPinThrottle } from "./till-pin";

// The point's shared till login (owner, 23.11.2026): it opens the till, but nothing is sold, returned or
// done to a shift under it — a cashier types her own PIN first, so every check carries a person.

const prisma = new PrismaService();
const services = buildServices(prisma);
const users = new UsersService(prisma);
const auth = new AuthService(prisma, new JwtService({ secret: process.env.JWT_SECRET ?? "dev-secret-change-me", signOptions: { expiresIn: "8h" } }));
const shifts = new TillShiftsService(prisma, services.cash);
let org: IsolatedOrg;
let breadId: string;
let device: IsolatedOrg["user"];
let cashierId: string;

beforeAll(async () => {
  await prisma.$connect();
  resetPinThrottle();
  org = await createIsolatedOrg(prisma, "shared-till");
  breadId = (await prisma.product.create({ data: { organizationId: org.organizationId, name: "Батон", sku: "ST-1", unit: "PCS", type: "FINISHED_GOOD", price: 500 } })).id;
  await services.inventory.receive(org.user, { locationId: org.storeId, productId: breadId, quantity: 20 } as never);
  const point = await prisma.user.create({
    data: { organizationId: org.organizationId, fullName: "Кассир", email: `point-${Math.random()}@iso.test`, passwordHash: "x", role: Role.CASHIER, locationId: org.storeId },
  });
  const marked = await users.update(org.user, point.id, { sharedTill: true });
  expect(marked.sharedTill).toBe(true);
  device = (await auth.validateUserById(point.id))!;
  const dana = await prisma.user.create({
    data: { organizationId: org.organizationId, fullName: "Дана Сейтова", email: `dana-${Math.random()}@iso.test`, passwordHash: "x", role: Role.CASHIER, locationId: org.storeId },
  });
  cashierId = dana.id;
  await users.setPin(org.user, cashierId, "4321");
});
afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  expect(leftovers).toEqual([]);
});

const sell = (who: IsolatedOrg["user"]) =>
  services.sales.create(who, { locationId: org.storeId, paymentMethod: PaymentMethod.CASH, items: [{ productId: breadId, quantity: 1, unitPrice: 500 }] } as never);

describe("shared till login", () => {
  it("cannot sell or open a shift; the same till sells after the cashier's PIN", async () => {
    expect(device.sharedTill).toBe(true);
    await expect(sell(device)).rejects.toThrow(/введите свой PIN/);
    await expect(shifts.open(device, { locationId: org.storeId, openingCash: 0 } as never)).rejects.toThrow(/введите свой PIN/);

    const login = await auth.pinLogin(device, "4321");
    expect(login.user).toMatchObject({ id: cashierId, sharedTill: false });
    const dana = (await auth.validateUserById(cashierId))!;
    const sale = await sell(dana);
    expect(sale.totalAmount).toBe(500);
  });

  it("the mark is dropped when the account stops being a till role", async () => {
    const other = await prisma.user.create({
      data: { organizationId: org.organizationId, fullName: "Склад", email: `st-${Math.random()}@iso.test`, passwordHash: "x", role: Role.CASHIER, locationId: org.storeId },
    });
    await users.update(org.user, other.id, { sharedTill: true });
    const moved = await users.update(org.user, other.id, { role: Role.STORE_MANAGER });
    expect(moved.sharedTill).toBe(false);
  });
});
