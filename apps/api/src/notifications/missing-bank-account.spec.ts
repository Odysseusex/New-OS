import { NotificationSeverity, NotificationType, PaymentMethod, Role } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { createIsolatedOrg, destroyOrg, IsolatedOrg } from "../../test/support/isolated-org";
import { buildServices } from "../../test/support/services";
import { InventoryService } from "../inventory/inventory.service";
import { CustomersService } from "../customers/customers.service";
import { NotificationsService } from "./notifications.service";
import { AuthenticatedUser } from "../auth/auth.types";

// Without an active default BANK account a card sale still goes through (the
// till is never blocked) but its money lands in no account. That must be
// visible to the people who can fix it, live, every day until it is fixed.

const prisma = new PrismaService();
const services = buildServices(prisma);
const notifications = new NotificationsService(prisma, new InventoryService(prisma), new CustomersService(prisma));
const originalFiscal = process.env.FISCALIZATION_ENABLED;
let org: IsolatedOrg;
let productId: string;

const bankAlert = async (user: AuthenticatedUser = org.user) =>
  (await notifications.getNotifications(user)).find((n) => n.type === NotificationType.MISSING_BANK_ACCOUNT);

beforeAll(async () => {
  await prisma.$connect();
  delete process.env.FISCALIZATION_ENABLED;
  org = await createIsolatedOrg(prisma, "bank");
  productId = (
    await prisma.product.create({
      data: { organizationId: org.organizationId, name: "Хлеб", sku: "B-1", unit: "PCS", type: "FINISHED_GOOD", price: 500 },
    })
  ).id;
  await services.inventory.receive(org.user, { locationId: org.storeId, productId, quantity: 10 });
});

afterAll(async () => {
  const leftovers = await destroyOrg(prisma, org.organizationId);
  await prisma.$disconnect();
  if (originalFiscal !== undefined) process.env.FISCALIZATION_ENABLED = originalFiscal;
  expect(leftovers).toEqual([]);
});

describe("missing bank account notification", () => {
  it("is silent while an active default bank account exists", async () => {
    expect(await bankAlert()).toBeUndefined();
  });

  it("warns once the default bank account is gone", async () => {
    await prisma.cashAccount.update({ where: { id: org.bankAccountId }, data: { isDefault: false } });
    const alert = await bankAlert();
    expect(alert).toMatchObject({ severity: NotificationSeverity.WARNING, link: "/finance" });
    expect(alert!.key).toMatch(/^missing-bank-account:.+:\d{4}-\d{2}-\d{2}$/);
  });

  it("a card sale still succeeds (the till is not blocked) but records no money — and the alert turns critical", async () => {
    const sale = await services.sales.create(org.user, {
      locationId: org.storeId,
      paymentMethod: PaymentMethod.CARD,
      items: [{ productId, quantity: 1, unitPrice: 500 }],
    });
    expect(sale.totalAmount).toBe(500);
    expect(await prisma.cashMovement.count({ where: { saleId: sale.id } })).toBe(0);

    const alert = await bankAlert();
    expect(alert).toMatchObject({ severity: NotificationSeverity.CRITICAL });
    expect(alert!.message).toMatch(/: 1$/);
  });

  it("is shown only to organization-wide roles", async () => {
    const cashier = await prisma.user.create({
      data: {
        organizationId: org.organizationId,
        fullName: "Кассир",
        email: `c-${Date.now()}@iso.test`,
        passwordHash: "x",
        role: Role.STORE_MANAGER,
        locationId: org.storeId,
      },
    });
    const storeManager: AuthenticatedUser = {
      ...org.user,
      id: cashier.id,
      role: Role.STORE_MANAGER,
      locationId: org.storeId,
    };
    expect(await bankAlert(storeManager)).toBeUndefined();
  });

  it("dismissing silences it for today only, like every other live alert", async () => {
    const alert = await bankAlert();
    await notifications.dismiss(org.user, alert!.key);
    expect(await bankAlert()).toBeUndefined();
  });

  it("disappears as soon as a default bank account is set again", async () => {
    await prisma.notificationDismissal.deleteMany({ where: { userId: org.user.id } });
    await prisma.cashAccount.update({ where: { id: org.bankAccountId }, data: { isDefault: true } });
    expect(await bankAlert()).toBeUndefined();
  });
});
