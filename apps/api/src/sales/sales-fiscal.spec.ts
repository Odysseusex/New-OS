import { FiscalReceiptStatus } from "@prisma/client";
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

// The point of these tests is a single promise: with fiscalisation on, NOTHING
// is written unless the receipt is registered. Stock and cash are checked
// before and after every attempt, against the real database — the whole risk
// lives in the interaction between the network call and the transaction, which
// a mocked Prisma would hide rather than expose.
//
// This suite and fiscal.service.spec.ts share one real Postgres and one demo
// org, so they cannot run in parallel workers: one suite's cleanup would
// delete rows the other is still using. That is why `maxWorkers: 1` is set in
// the API's jest config — it is a correctness requirement here, not a
// performance preference.
const prisma = new PrismaService();

const ORG = "demo-org";
let user: AuthenticatedUser;
let locationId: string;
let productId: string;
const createdSaleIds: string[] = [];
// Set only by the no-NTIN test below. Cleaned up in the shared afterAll,
// AFTER createdSaleIds' sale/saleItem rows are gone — SaleItem.productId has
// no cascade, so deleting the product first would fail its FK constraint.
let noNtinProductId: string | null = null;
// Same story for the open-price fixture — cleaned up after its sale rows.
let openPriceProductId: string | null = null;
// Sales that do NOT contain the shared fixture product live here instead of
// in createdSaleIds: one test asserts that "sales containing `productId`"
// equals "sales I created", and that only holds while the two lists mean the
// same thing.
const otherSaleIds: string[] = [];

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

function buildService(provider: FiscalProvider): SalesService {
  return new SalesService(
    prisma,
    new CashMovementsService(prisma),
    new FiscalService(prisma, provider, new FiscalSettings()),
    new FiscalSettings(),
  );
}

// Sales plus returns off one shared fiscal/cash pair, for the tests that
// need to sell something and then take it back.
function servicesFor(provider: FiscalProvider) {
  const cash = new CashMovementsService(prisma);
  const fiscal = new FiscalService(prisma, provider, new FiscalSettings());
  return {
    sales: new SalesService(prisma, cash, fiscal, new FiscalSettings()),
    returns: new SaleReturnsService(prisma, cash, fiscal, new FiscalSettings()),
  };
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
  const allSaleIds = [...createdSaleIds, ...otherSaleIds];
  await prisma.fiscalReceipt.deleteMany({ where: { organizationId: ORG, saleId: { in: allSaleIds } } });
  await prisma.fiscalReceipt.deleteMany({ where: { organizationId: ORG, saleId: null } });
  // Returns hold their sale by a foreign key with no cascade, so they have to
  // go first — and their own cash/stock movements before them.
  const returnIds = (
    await prisma.saleReturn.findMany({ where: { saleId: { in: allSaleIds } }, select: { id: true } })
  ).map((r) => r.id);
  await prisma.cashMovement.deleteMany({
    where: { OR: [{ saleId: { in: allSaleIds } }, { saleReturnId: { in: returnIds } }] },
  });
  await prisma.stockMovement.deleteMany({ where: { productId } });
  await prisma.saleReturnItem.deleteMany({ where: { saleReturnId: { in: returnIds } } });
  await prisma.saleReturn.deleteMany({ where: { id: { in: returnIds } } });
  await prisma.saleItem.deleteMany({ where: { saleId: { in: allSaleIds } } });
  await prisma.sale.deleteMany({ where: { id: { in: allSaleIds } } });
  await prisma.stockLevel.deleteMany({ where: { productId } });
  await prisma.product.deleteMany({ where: { id: productId } });
  if (noNtinProductId) {
    await prisma.stockMovement.deleteMany({ where: { productId: noNtinProductId } });
    await prisma.stockLevel.deleteMany({ where: { productId: noNtinProductId } });
    await prisma.product.deleteMany({ where: { id: noNtinProductId } });
  }
  if (openPriceProductId) {
    await prisma.product.deleteMany({ where: { id: openPriceProductId } });
  }
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

  it("records what a markdown gave away, and nets out a return of the same loaf", async () => {
    // Half price on stale bread. The buyer pays 295, and the 295 difference
    // is the number the owner steers production by — it has to survive into
    // the report and come back out again if the loaf is returned.
    const { sales, returns } = servicesFor(new ScriptedProvider());
    const sale = await sales.create(user, {
      locationId,
      paymentMethod: PaymentMethod.CASH,
      items: [{ productId, quantity: 2, unitPrice: 295, fullUnitPrice: 590 }],
    });
    createdSaleIds.push(sale.id);

    expect(sale.totalAmount).toBe(590);
    expect(sale.items[0].fullUnitPrice).toBe(590);

    const from = new Date(Date.now() - 60_000);
    const to = new Date(Date.now() + 60_000);
    const before = await sales.report(user, from, to, locationId);
    const beforeRow = before.byProduct.find((p) => p.productId === productId);
    expect(beforeRow?.markdownQuantity).toBe(2);
    expect(beforeRow?.markdownLoss).toBe(590);

    // Refunded at what was actually paid, not the full price.
    const returned = await returns.create(user, sale.id, { items: [{ productId, quantity: 1 }] });
    expect(returned.totalAmount).toBe(295);
  });

  it("refuses a markdown that did not lower the price", async () => {
    // A negative "loss" would quietly inflate the very figure the owner
    // uses to decide how much to bake.
    await expect(
      buildService(new ScriptedProvider()).create(user, {
        locationId,
        paymentMethod: PaymentMethod.CASH,
        items: [{ productId, quantity: 1, unitPrice: 590, fullUnitPrice: 500 }],
      }),
    ).rejects.toThrow("Цена до скидки должна быть выше");
  });

  it("sells an open-price line with no stock at all, and moves no stock for it", async () => {
    // The till's «Произвольная сумма» row: trackInventory=false, no
    // StockLevel row anywhere, and an amount typed by the cashier rather
    // than read off the product. Before stock tracking was honoured here,
    // this failed with «Недостаточно товара» — which is exactly the sort of
    // thing that stops a till mid-queue.
    const openPrice = await prisma.product.create({
      data: {
        organizationId: ORG,
        name: "Произвольная сумма",
        sku: `OPEN-PRICE-${Date.now()}`,
        unit: "PCS",
        type: "FINISHED_GOOD",
        price: 0,
        trackInventory: false,
        isOpenPrice: true,
      },
    });
    openPriceProductId = openPrice.id;

    const sale = await buildService(new ScriptedProvider()).create(user, {
      locationId,
      paymentMethod: PaymentMethod.CASH,
      items: [{ productId: openPrice.id, quantity: 1, unitPrice: 1250 }],
    });
    otherSaleIds.push(sale.id);

    expect(sale.totalAmount).toBe(1250);
    expect(await prisma.stockMovement.count({ where: { productId: openPrice.id } })).toBe(0);
    expect(await prisma.stockLevel.count({ where: { productId: openPrice.id } })).toBe(0);
  });

  it("splits a mixed payment across two accounts, not one", async () => {
    // The whole point of storing a split: cash belongs in the location's
    // till and card money in the bank account. Recording one movement for
    // the full amount would put it all in whichever account the single
    // method happened to route to, and every figure in Финансы built on
    // that would be wrong.
    const sale = await buildService(new ScriptedProvider()).create(user, {
      locationId,
      paymentMethod: PaymentMethod.MIXED,
      payments: [
        { method: PaymentMethod.CARD, amount: 800 },
        { method: PaymentMethod.CASH, amount: 380 },
      ],
      items: [{ productId, quantity: 2, unitPrice: 590 }],
    });
    createdSaleIds.push(sale.id);

    expect(sale.totalAmount).toBe(1180);
    expect(sale.paymentMethod).toBe(PaymentMethod.MIXED);
    expect(sale.payments).toHaveLength(2);

    const movements = await prisma.cashMovement.findMany({ where: { saleId: sale.id } });
    expect(movements).toHaveLength(2);
    expect(movements.map((m) => m.amount.toNumber()).sort((a, b) => a - b)).toEqual([380, 800]);
    // Two different accounts — the till and the bank — not the same one twice.
    expect(new Set(movements.map((m) => m.accountId)).size).toBe(2);
  });

  it("refuses a split that does not add up to the total", async () => {
    const provider = new ScriptedProvider();
    const service = buildService(provider);
    const before = await cashMovementCount();

    await expect(
      service.create(user, {
        locationId,
        paymentMethod: PaymentMethod.MIXED,
        // 1180 due, 1000 offered.
        payments: [
          { method: PaymentMethod.CARD, amount: 800 },
          { method: PaymentMethod.CASH, amount: 200 },
        ],
        items: [{ productId, quantity: 2, unitPrice: 590 }],
      }),
    ).rejects.toThrow("не совпадает");

    expect(await cashMovementCount()).toBe(before);
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

  it("sells a product with no NTIN — the code is required by law but not enforced by re:Kassa, and there is a fines moratorium until 01.01.2027", async () => {
    const noNtin = await prisma.product.create({
      data: {
        organizationId: ORG,
        name: "Без NTIN",
        sku: `SALE-NO-NTIN-${Date.now()}`,
        unit: "PCS",
        type: "FINISHED_GOOD",
        price: 100,
      },
    });
    await prisma.stockLevel.create({ data: { organizationId: ORG, locationId, productId: noNtin.id, quantity: 10, minQuantity: 0 } });
    // Recorded so the shared afterAll cleans it up once — after, not before,
    // the sale/saleItem rows created below are gone. See the field's comment.
    noNtinProductId = noNtin.id;

    const provider = new ScriptedProvider();
    provider.outcome = {
      kind: "ok",
      result: {
        providerTicketId: "no-ntin-1",
        ticketNumber: "99",
        offlineTicketNumber: null,
        isOffline: false,
        qrCode: null,
        kgdKkmId: null,
        shiftNumber: 1,
        raw: {},
      },
    };
    const service = buildService(provider);

    const sale = await service.create(user, {
      locationId,
      paymentMethod: PaymentMethod.CASH,
      items: [{ productId: noNtin.id, quantity: 1, unitPrice: 100 }],
    });
    otherSaleIds.push(sale.id);

    expect(sale).toBeTruthy();
    expect(provider.seen).toHaveLength(1);
    expect(provider.seen[0].lines[0].ntin).toBe("");
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
