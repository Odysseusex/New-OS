import { PaymentMethod, Role } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { CashMovementsService } from "../finance/cash-movements.service";
import { FiscalService } from "../fiscal/fiscal.service";
import { FiscalSettings } from "../fiscal/fiscal.settings";
import { FakeFiscalProvider } from "../fiscal/fake-fiscal.provider";
import { SalesService } from "../sales/sales.service";
import { SaleReturnsService } from "../sales/sale-returns.service";
import { ConsignmentService } from "./consignment.service";
import { AuthenticatedUser } from "../auth/auth.types";

// What we owe the owner of goods we sell on consignment is money, so this
// runs against the real database like the other money specs. Shares the demo
// org with them — see the maxWorkers note in sales-fiscal.spec.ts.
const prisma = new PrismaService();

const ORG = "demo-org";
let user: AuthenticatedUser;
let locationId: string;
let productId: string;
let supplierId: string;
const createdSaleIds: string[] = [];

function services() {
  const fiscal = new FiscalService(prisma, new FakeFiscalProvider(), new FiscalSettings());
  const cash = new CashMovementsService(prisma);
  return {
    sales: new SalesService(prisma, cash, fiscal, new FiscalSettings()),
    returns: new SaleReturnsService(prisma, cash, fiscal, new FiscalSettings()),
    consignment: new ConsignmentService(prisma, cash),
  };
}

const balanceOf = async () => {
  const rows = await services().consignment.balances(ORG);
  return rows.find((r) => r.supplierId === supplierId) ?? null;
};

beforeAll(async () => {
  await prisma.$connect();
  delete process.env.FISCALIZATION_ENABLED;

  const location = await prisma.location.findFirst({ where: { organizationId: ORG, lat: { not: null } } });
  const owner = await prisma.user.findFirst({ where: { organizationId: ORG, role: Role.OWNER } });
  if (!location || !owner) throw new Error("Demo data missing — seed the local database first");
  locationId = location.id;
  user = { id: owner.id, organizationId: ORG, role: owner.role, locationId: null } as AuthenticatedUser;

  const supplier = await prisma.supplier.create({
    data: { organizationId: ORG, name: `Деревня тест ${Date.now()}` },
  });
  supplierId = supplier.id;

  // Sells for 500, of which 300 belongs to the village: our cut is 200.
  const product = await prisma.product.create({
    data: {
      organizationId: ORG,
      name: `Деревенский тест ${Date.now()}`,
      sku: `CONSIGN-TEST-${Date.now()}`,
      unit: "PCS",
      type: "FINISHED_GOOD",
      price: 500,
      consignmentSupplierId: supplierId,
      consignmentPrice: 300,
    },
  });
  productId = product.id;
  await prisma.stockLevel.create({
    data: { organizationId: ORG, locationId, productId, quantity: 100, minQuantity: 0 },
  });
});

afterAll(async () => {
  await prisma.cashMovement.deleteMany({ where: { OR: [{ saleId: { in: createdSaleIds } }, { supplierId }] } });
  await prisma.consignmentPayment.deleteMany({ where: { supplierId } });
  await prisma.saleReturnItem.deleteMany({ where: { productId } });
  await prisma.saleReturn.deleteMany({ where: { saleId: { in: createdSaleIds } } });
  await prisma.saleItem.deleteMany({ where: { productId } });
  await prisma.sale.deleteMany({ where: { id: { in: createdSaleIds } } });
  await prisma.stockMovement.deleteMany({ where: { productId } });
  await prisma.stockLevel.deleteMany({ where: { productId } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.supplier.deleteMany({ where: { id: supplierId } });
  await prisma.$disconnect();
});

describe("ConsignmentService", () => {
  it("owes the supplier for what sold, at the price snapshotted on the sale", async () => {
    const { sales } = services();
    const sale = await sales.create(user, {
      locationId,
      paymentMethod: PaymentMethod.CASH,
      items: [{ productId, quantity: 4, unitPrice: 500 }],
    });
    createdSaleIds.push(sale.id);

    const balance = await balanceOf();
    // 4 × 300 owed, not 4 × 500 — the sale price is ours, the cost is theirs.
    expect(balance?.soldAmount).toBe(1200);
    expect(balance?.balance).toBe(1200);
  });

  it("does not change what is owed when the product's price is edited afterwards", async () => {
    // The debt was fixed by the sale. Re-reading today's price would rewrite
    // history every time the village changes what it charges.
    await prisma.product.update({ where: { id: productId }, data: { consignmentPrice: 400 } });
    const balance = await balanceOf();
    expect(balance?.soldAmount).toBe(1200);
    await prisma.product.update({ where: { id: productId }, data: { consignmentPrice: 300 } });
  });

  it("reduces the debt when a buyer brings the goods back", async () => {
    const { returns } = services();
    const saleId = createdSaleIds[0];
    await returns.create(user, saleId, { items: [{ productId, quantity: 1 }] });

    const balance = await balanceOf();
    expect(balance?.returnedAmount).toBe(300);
    expect(balance?.balance).toBe(900);
  });

  it("records a payout, and refuses to pay more than is owed", async () => {
    const { consignment } = services();

    await expect(
      consignment.pay(user, { supplierId, amount: 5000 }),
    ).rejects.toThrow("Больше долга");

    await consignment.pay(user, { supplierId, amount: 400 });
    const balance = await balanceOf();
    expect(balance?.paidAmount).toBe(400);
    expect(balance?.balance).toBe(500);

    // The money really left an account rather than only being noted here.
    const movement = await prisma.cashMovement.findFirst({
      where: { supplierId, type: "SUPPLIER_PAYMENT" },
    });
    expect(movement?.amount.toNumber()).toBe(400);
  });

  it("counts the debt as кредиторская задолженность, not as a surprise expense later", async () => {
    // The owner's dashboard must show this the day the goods sell, not on
    // whatever day someone remembers to pay.
    const { consignment } = services();
    const owed = (await consignment.balances(ORG)).find((r) => r.supplierId === supplierId)?.balance;
    expect(owed).toBe(500);
  });
});
