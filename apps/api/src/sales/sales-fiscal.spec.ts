import { FiscalReceiptStatus } from "@prisma/client";
import { PaymentMethod, Role } from "@bakery-os/shared";
import { PrismaService } from "../prisma/prisma.service";
import { CashMovementsService } from "../finance/cash-movements.service";
import { FiscalService } from "../fiscal/fiscal.service";
import { FiscalSettings } from "../fiscal/fiscal.settings";
import { FakeFiscalProvider } from "../fiscal/fake-fiscal.provider";
import { FiscalProvider, FiscalSaleOutcome, FiscalSaleRequest } from "../fiscal/fiscal-provider";
import { SalesService } from "./sales.service";
import { AuthenticatedUser } from "../auth/auth.types";

// The point of these tests is a single promise: with fiscalisation on, NOTHING
// is written unless the receipt is registered. Stock and cash are checked
// before and after every attempt, against the real database — the whole risk
// lives in the interaction between the network call and the transaction, which
// a mocked Prisma would hide rather than expose.
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
}

function buildService(provider: FiscalProvider): SalesService {
  return new SalesService(
    prisma,
    new CashMovementsService(prisma),
    new FiscalService(prisma, provider),
    new FiscalSettings(),
  );
}

async function stockOf(): Promise<number> {
  const level = await prisma.stockLevel.findUnique({
    where: { locationId_productId: { locationId, productId } },
  });
  return level?.quantity.toNumber() ?? 0;
}

async function cashMovementCount(): Promise<number> {
  return prisma.cashMovement.count({ where: { organizationId: ORG } });
}

async function stockMovementCount(): Promise<number> {
  return prisma.stockMovement.count({ where: { organizationId: ORG, productId } });
}

beforeAll(async () => {
  await prisma.$connect();

  // A location with coordinates: without them the receipt cannot be built at
  // all, and this suite is about what happens after that point.
  const location = await prisma.location.findFirst({ where: { organizationId: ORG, lat: { not: null } } });
  const owner = await prisma.user.findFirst({ where: { organizationId: ORG, role: Role.OWNER } });
  if (!location || !owner) throw new Error("Demo data missing — seed the local database first");
  locationId = location.id;
  user = { id: owner.id, organizationId: ORG, role: owner.role, locationId: null } as AuthenticatedUser;

  const product = await prisma.product.create({
    data: {
      organizationId: ORG,
      name: `Фискальный тест ${Date.now()}`,
      sku: `SALE-FISCAL-${Date.now()}`,
      unit: "PCS",
      type: "FINISHED_GOOD",
      price: 590,
      ntin: "0200000000001",
    },
  });
  productId = product.id;

  await prisma.stockLevel.create({ data: { organizationId: ORG, locationId, productId, quantity: 100, minQuantity: 0 } });
});

beforeEach(async () => {
  await prisma.stockLevel.update({
    where: { locationId_productId: { locationId, productId } },
    data: { quantity: 100 },
  });
});

afterAll(async () => {
  delete process.env.FISCALIZATION_ENABLED;
  await prisma.fiscalReceipt.deleteMany({ where: { organizationId: ORG, saleId: { in: createdSaleIds } } });
  await prisma.fiscalReceipt.deleteMany({ where: { organizationId: ORG, saleId: null } });
  await prisma.cashMovement.deleteMany({ where: { saleId: { in: createdSaleIds } } });
  await prisma.stockMovement.deleteMany({ where: { productId } });
  await prisma.saleItem.deleteMany({ where: { saleId: { in: createdSaleIds } } });
  await prisma.sale.deleteMany({ where: { id: { in: createdSaleIds } } });
  await prisma.stockLevel.deleteMany({ where: { productId } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.$disconnect();
});

const cart = () => ({
  locationId,
  paymentMethod: PaymentMethod.CASH,
  items: [{ productId, quantity: 2, unitPrice: 590 }],
});

describe("SalesService.create with fiscalisation OFF", () => {
  beforeEach(() => {
    delete process.env.FISCALIZATION_ENABLED;
  });

  it("sells exactly as before and never touches the fiscal operator", async () => {
    const provider = new ScriptedProvider();
    const service = buildService(provider);

    const sale = await service.create(user, cart());
    createdSaleIds.push(sale.id);

    expect(provider.seen).toHaveLength(0);
    expect(await stockOf()).toBe(98);
    expect(await prisma.fiscalReceipt.findUnique({ where: { saleId: sale.id } })).toBeNull();
  });

  it("stays off when the flag is set to anything other than the exact string 'true'", async () => {
    // A half-set flag ("1", "yes", "TRUE") must not silently start requiring
    // receipts — it fails safe, towards the behaviour that already works.
    process.env.FISCALIZATION_ENABLED = "1";
    const provider = new ScriptedProvider();
    const sale = await buildService(provider).create(user, cart());
    createdSaleIds.push(sale.id);

    expect(provider.seen).toHaveLength(0);
  });
});

describe("SalesService.create with fiscalisation ON", () => {
  beforeEach(() => {
    process.env.FISCALIZATION_ENABLED = "true";
  });

  it("punches the receipt, then records the sale, and links the two", async () => {
    const service = buildService(new FakeFiscalProvider());

    const sale = await service.create(user, cart());
    createdSaleIds.push(sale.id);

    const receipt = await prisma.fiscalReceipt.findUnique({ where: { saleId: sale.id } });
    expect(receipt?.status).toBe(FiscalReceiptStatus.REGISTERED);
    expect(receipt?.ticketNumber).toBeTruthy();
    expect(await stockOf()).toBe(98);
  });

  it("sends the operator the same lines and total the customer is charged", async () => {
    const provider = new ScriptedProvider();
    provider.outcome = {
      kind: "ok",
      result: {
        providerTicketId: "1",
        ticketNumber: "42",
        offlineTicketNumber: null,
        isOffline: false,
        qrCode: null,
        kgdKkmId: null,
        shiftNumber: 1,
        raw: {},
      },
    };
    const sale = await buildService(provider).create(user, cart());
    createdSaleIds.push(sale.id);

    expect(provider.seen).toHaveLength(1);
    const sent = provider.seen[0];
    expect(sent.total).toBe(1180);
    expect(sent.lines).toHaveLength(1);
    expect(sent.lines[0].quantity).toBe(2);
    expect(sent.lines[0].total).toBe(1180);
    expect(sent.lines[0].ntin).toBe("0200000000001");
    expect(sent.payments[0].type).toBe("CASH");
  });

  it("writes nothing at all when the operator rejects the receipt", async () => {
    const provider = new ScriptedProvider();
    provider.outcome = { kind: "rejected", code: "PROTOCOL_ERROR", message: "Неверный формат" };
    const service = buildService(provider);

    const before = { stock: await stockOf(), cash: await cashMovementCount(), moves: await stockMovementCount() };
    await expect(service.create(user, cart())).rejects.toThrow("Чек не пробит");

    expect(await stockOf()).toBe(before.stock);
    expect(await cashMovementCount()).toBe(before.cash);
    expect(await stockMovementCount()).toBe(before.moves);
    expect(await prisma.sale.count({ where: { organizationId: ORG, locationId, items: { some: { productId } } } })).toBe(
      createdSaleIds.length,
    );
  });

  it("writes nothing, and warns against retrying, when the answer never arrives", async () => {
    // The dangerous case: a receipt may or may not exist. Ringing the cart up
    // again could punch a second one, so the message must not read as a
    // routine "try again".
    const provider = new ScriptedProvider();
    provider.outcome = { kind: "unknown", message: "Соединение прервано" };
    const service = buildService(provider);

    const before = { stock: await stockOf(), cash: await cashMovementCount() };
    await expect(service.create(user, cart())).rejects.toThrow("Не пробивайте заново");

    expect(await stockOf()).toBe(before.stock);
    expect(await cashMovementCount()).toBe(before.cash);
  });

  it("refuses before calling the operator when a product has no ИКПУ", async () => {
    const noNtin = await prisma.product.create({
      data: {
        organizationId: ORG,
        name: "Без ИКПУ",
        sku: `SALE-NO-NTIN-${Date.now()}`,
        unit: "PCS",
        type: "FINISHED_GOOD",
        price: 100,
      },
    });
    await prisma.stockLevel.create({ data: { organizationId: ORG, locationId, productId: noNtin.id, quantity: 10, minQuantity: 0 } });

    const provider = new ScriptedProvider();
    const service = buildService(provider);
    const stagedBefore = await prisma.fiscalReceipt.count({ where: { organizationId: ORG } });

    await expect(
      service.create(user, {
        locationId,
        paymentMethod: PaymentMethod.CASH,
        items: [{ productId: noNtin.id, quantity: 1, unitPrice: 100 }],
      }),
    ).rejects.toThrow("Не заполнен код ИКПУ");

    expect(provider.seen).toHaveLength(0);
    // Nothing was even staged: no receipt row, so nothing to reconcile later.
    expect(await prisma.fiscalReceipt.count({ where: { organizationId: ORG } })).toBe(stagedBefore);

    await prisma.stockLevel.deleteMany({ where: { productId: noNtin.id } });
    await prisma.product.deleteMany({ where: { id: noNtin.id } });
  });

  it("refuses to punch a receipt for goods that are not in stock", async () => {
    // A fiscal receipt is a legal document; it must not be issued for a sale
    // the stock check is about to reject a moment later.
    const provider = new ScriptedProvider();
    const service = buildService(provider);

    await expect(
      service.create(user, {
        locationId,
        paymentMethod: PaymentMethod.CASH,
        items: [{ productId, quantity: 100000, unitPrice: 590 }],
      }),
    ).rejects.toThrow("Недостаточно товара");

    expect(provider.seen).toHaveLength(0);
  });
});
