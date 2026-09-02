import { PaymentMethod, Role } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { CashMovementsService } from "../finance/cash-movements.service";
import { FiscalService } from "../fiscal/fiscal.service";
import { FiscalSettings } from "../fiscal/fiscal.settings";
import { FakeFiscalProvider } from "../fiscal/fake-fiscal.provider";
import { FiscalProvider, FiscalSaleOutcome, FiscalSaleRequest } from "../fiscal/fiscal-provider";
import { SalesService } from "./sales.service";
import { SaleReturnsService } from "./sale-returns.service";
import { AuthenticatedUser } from "../auth/auth.types";

// A return moves real money out of the till and real goods back onto the
// shelf, so these run against the real database like the other fiscal specs.
// Shares the demo org with them — see the maxWorkers note in
// sales-fiscal.spec.ts.
const prisma = new PrismaService();

const ORG = "demo-org";
let user: AuthenticatedUser;
let locationId: string;
let productId: string;
const createdSaleIds: string[] = [];

class ScriptedProvider implements FiscalProvider {
  readonly name = "scripted";
  outcome: FiscalSaleOutcome = { kind: "unknown", message: "не задано" };
  readonly seen: FiscalSaleRequest[] = [];
  isConfigured() {
    return true;
  }
  async registerSale(request: FiscalSaleRequest): Promise<FiscalSaleOutcome> {
    this.seen.push(request);
    return this.outcome;
  }
  async registerReturn(request: FiscalSaleRequest): Promise<FiscalSaleOutcome> {
    return this.registerSale(request);
  }
  async getShiftState() {
    return null;
  }
}

function services(provider: FiscalProvider) {
  const fiscal = new FiscalService(prisma, provider, new FiscalSettings());
  const cash = new CashMovementsService(prisma);
  return {
    sales: new SalesService(prisma, cash, fiscal, new FiscalSettings()),
    returns: new SaleReturnsService(prisma, cash, fiscal, new FiscalSettings()),
  };
}

const stockOf = async () =>
  (await prisma.stockLevel.findUnique({ where: { locationId_productId: { locationId, productId } } }))
    ?.quantity.toNumber() ?? 0;

const cart = () => ({
  locationId,
  paymentMethod: PaymentMethod.CASH,
  items: [{ productId, quantity: 3, unitPrice: 500 }],
});

beforeAll(async () => {
  await prisma.$connect();
  const location = await prisma.location.findFirst({ where: { organizationId: ORG, lat: { not: null } } });
  const owner = await prisma.user.findFirst({ where: { organizationId: ORG, role: Role.OWNER } });
  if (!location || !owner) throw new Error("Demo data missing — seed the local database first");
  locationId = location.id;
  user = { id: owner.id, organizationId: ORG, role: owner.role, locationId: null } as AuthenticatedUser;

  const product = await prisma.product.create({
    data: {
      organizationId: ORG,
      name: `Возврат тест ${Date.now()}`,
      sku: `RETURN-TEST-${Date.now()}`,
      unit: "PCS",
      type: "FINISHED_GOOD",
      price: 500,
      ntin: "0200000000001",
    },
  });
  productId = product.id;
  await prisma.stockLevel.create({
    data: { organizationId: ORG, locationId, productId, quantity: 100, minQuantity: 0 },
  });
});

beforeEach(async () => {
  delete process.env.FISCALIZATION_ENABLED;
  await prisma.stockLevel.update({
    where: { locationId_productId: { locationId, productId } },
    data: { quantity: 100 },
  });
});

afterAll(async () => {
  delete process.env.FISCALIZATION_ENABLED;
  const returns = await prisma.saleReturn.findMany({ where: { saleId: { in: createdSaleIds } } });
  const returnIds = returns.map((r) => r.id);
  await prisma.fiscalReceipt.deleteMany({ where: { saleReturnId: { in: returnIds } } });
  await prisma.stockMovement.deleteMany({ where: { productId } });
  await prisma.cashMovement.deleteMany({ where: { saleId: { in: createdSaleIds } } });
  await prisma.saleReturnItem.deleteMany({ where: { saleReturnId: { in: returnIds } } });
  await prisma.saleReturn.deleteMany({ where: { id: { in: returnIds } } });
  await prisma.fiscalReceipt.deleteMany({ where: { saleId: { in: createdSaleIds } } });
  await prisma.saleItem.deleteMany({ where: { saleId: { in: createdSaleIds } } });
  await prisma.sale.deleteMany({ where: { id: { in: createdSaleIds } } });
  await prisma.stockLevel.deleteMany({ where: { productId } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.$disconnect();
});

describe("SaleReturnsService", () => {
  it("gives money back and puts the goods back on the shelf", async () => {
    const { sales, returns } = services(new FakeFiscalProvider());
    const sale = await sales.create(user, cart());
    createdSaleIds.push(sale.id);
    expect(await stockOf()).toBe(97);

    const result = await returns.create(user, sale.id, {
      items: [{ productId, quantity: 1 }],
      reason: "Покупателю не понравился",
    });

    expect(result.totalAmount).toBe(500);
    expect(result.restocked).toBe(true);
    // One of the three loaves came back.
    expect(await stockOf()).toBe(98);

    const refund = await prisma.cashMovement.findFirst({
      where: { saleReturnId: result.id, type: "SALE_REFUND" },
    });
    expect(refund?.amount.toNumber()).toBe(500);

    const movement = await prisma.stockMovement.findFirst({ where: { saleReturnId: result.id } });
    expect(movement?.type).toBe("SALE_RETURN");
  });

  it("writes the goods off instead of restocking when they cannot be resold", async () => {
    // Bread a buyer already carried home does not go back on the shelf, and
    // stock must not claim otherwise.
    const { sales, returns } = services(new FakeFiscalProvider());
    const sale = await sales.create(user, cart());
    createdSaleIds.push(sale.id);
    const before = await stockOf();

    const result = await returns.create(user, sale.id, {
      items: [{ productId, quantity: 1 }],
      restocked: false,
    });

    expect(result.restocked).toBe(false);
    expect(await stockOf()).toBe(before);

    const movement = await prisma.stockMovement.findFirst({ where: { saleReturnId: result.id } });
    expect(movement?.type).toBe("WRITE_OFF");
    expect(movement?.writeOffReason).toBe("OTHER");
  });

  it("refuses to return more than was sold", async () => {
    const { sales, returns } = services(new FakeFiscalProvider());
    const sale = await sales.create(user, cart());
    createdSaleIds.push(sale.id);

    await expect(
      returns.create(user, sale.id, { items: [{ productId, quantity: 5 }] }),
    ).rejects.toThrow("к возврату доступно 3");
  });

  it("counts earlier returns, so the same goods cannot be refunded twice", async () => {
    const { sales, returns } = services(new FakeFiscalProvider());
    const sale = await sales.create(user, cart());
    createdSaleIds.push(sale.id);

    await returns.create(user, sale.id, { items: [{ productId, quantity: 2 }] });

    await expect(
      returns.create(user, sale.id, { items: [{ productId, quantity: 2 }] }),
    ).rejects.toThrow("к возврату доступно 1");
  });

  it("punches a return receipt quoting the original when fiscalisation is on", async () => {
    process.env.FISCALIZATION_ENABLED = "true";
    const { sales, returns } = services(new FakeFiscalProvider());
    const sale = await sales.create(user, cart());
    createdSaleIds.push(sale.id);
    expect(sale.fiscalReceipt?.ticketNumber).toBeTruthy();

    const result = await returns.create(user, sale.id, { items: [{ productId, quantity: 1 }] });

    expect(result.fiscalReceipt?.ticketNumber).toBeTruthy();
    // A separate receipt from the sale's, not the same one reused.
    expect(result.fiscalReceipt?.ticketNumber).not.toBe(sale.fiscalReceipt?.ticketNumber);
  });

  it("sends the operator a return quoting the sale's own receipt", async () => {
    process.env.FISCALIZATION_ENABLED = "true";
    const provider = new ScriptedProvider();
    provider.outcome = {
      kind: "ok",
      result: {
        providerTicketId: "1",
        ticketNumber: "900",
        offlineTicketNumber: null,
        isOffline: false,
        qrCode: null,
        kgdKkmId: null,
        shiftNumber: 1,
        raw: {},
      },
    };
    const { sales, returns } = services(provider);
    const sale = await sales.create(user, cart());
    createdSaleIds.push(sale.id);

    await returns.create(user, sale.id, { items: [{ productId, quantity: 1 }] });

    const sent = provider.seen[provider.seen.length - 1] as FiscalSaleRequest & {
      parent?: { ticketNumber: string; total: number };
    };
    expect(sent.parent?.ticketNumber).toBe("900");
    // The parent block quotes the ORIGINAL sale's total, not the refund's.
    expect(sent.parent?.total).toBe(1500);
    // Nothing is handed over by a buyer being refunded.
    expect(sent.taken).toBe(0);
    expect(sent.total).toBe(500);
  });

  it("writes nothing when the operator refuses the return receipt", async () => {
    process.env.FISCALIZATION_ENABLED = "true";
    const provider = new ScriptedProvider();
    provider.outcome = {
      kind: "ok",
      result: {
        providerTicketId: "1",
        ticketNumber: "901",
        offlineTicketNumber: null,
        isOffline: false,
        qrCode: null,
        kgdKkmId: null,
        shiftNumber: 1,
        raw: {},
      },
    };
    const { sales, returns } = services(provider);
    const sale = await sales.create(user, cart());
    createdSaleIds.push(sale.id);

    const stockBefore = await stockOf();
    const cashBefore = await prisma.cashMovement.count({ where: { organizationId: ORG } });

    provider.outcome = { kind: "rejected", code: "PROTOCOL_ERROR", message: "Неверный формат" };
    await expect(
      returns.create(user, sale.id, { items: [{ productId, quantity: 1 }] }),
    ).rejects.toThrow("Возвратный чек не пробит");

    expect(await stockOf()).toBe(stockBefore);
    expect(await prisma.cashMovement.count({ where: { organizationId: ORG } })).toBe(cashBefore);
    expect(await prisma.saleReturn.count({ where: { saleId: sale.id } })).toBe(0);
  });

  it("refuses a fiscal return for a sale that never had a receipt", async () => {
    // Sold before fiscalisation was switched on: there is no original for the
    // return to quote, and inventing one is not an option.
    const { sales, returns } = services(new FakeFiscalProvider());
    const sale = await sales.create(user, cart());
    createdSaleIds.push(sale.id);

    process.env.FISCALIZATION_ENABLED = "true";
    await expect(
      returns.create(user, sale.id, { items: [{ productId, quantity: 1 }] }),
    ).rejects.toThrow("нет фискального чека");
  });
});
