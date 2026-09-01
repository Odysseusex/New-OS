import { FiscalReceiptStatus } from "@prisma/client";
import { FiscalService } from "./fiscal.service";
import { FiscalProvider, FiscalSaleOutcome, FiscalSaleRequest } from "./fiscal-provider";
import { FakeFiscalProvider } from "./fake-fiscal.provider";
import { PrismaService } from "../prisma/prisma.service";

// Runs against the real local database — the claim logic is a conditional
// UPDATE, and mocking Prisma would test the mock rather than the guarantee.
const prisma = new PrismaService();

const ORG = "demo-org";
let saleId: string;
let locationId: string;
let productId: string;
let userId: string;

// A provider whose outcome each test dictates, for the paths the fake can't
// produce on demand (timeouts, rejections).
class ScriptedProvider implements FiscalProvider {
  readonly name = "scripted";
  outcome: FiscalSaleOutcome = { kind: "unknown", message: "no outcome set" };
  readonly seen: FiscalSaleRequest[] = [];
  isConfigured() {
    return true;
  }
  async registerSale(request: FiscalSaleRequest): Promise<FiscalSaleOutcome> {
    this.seen.push(request);
    return this.outcome;
  }
}

beforeAll(async () => {
  await prisma.$connect();

  const location = await prisma.location.findFirst({ where: { organizationId: ORG, lat: { not: null } } });
  const user = await prisma.user.findFirst({ where: { organizationId: ORG } });
  if (!location || !user) throw new Error("Demo data missing — seed the local database first");
  locationId = location.id;
  userId = user.id;

  const product = await prisma.product.create({
    data: {
      organizationId: ORG,
      name: `Тестовый товар ${Date.now()}`,
      sku: `FISCAL-TEST-${Date.now()}`,
      unit: "PCS",
      type: "FINISHED_GOOD",
      price: 590,
      ntin: "0200000000001",
    },
  });
  productId = product.id;
});

beforeEach(async () => {
  const sale = await prisma.sale.create({
    data: {
      organizationId: ORG,
      locationId,
      soldAt: new Date(),
      totalAmount: 1180,
      amountPaid: 1180,
      paymentMethod: "CASH",
      createdById: userId,
      items: { create: [{ productId, quantity: 2, unitPrice: 590, subtotal: 1180 }] },
    },
  });
  saleId = sale.id;
});

afterEach(async () => {
  await prisma.fiscalReceipt.deleteMany({ where: { saleId } });
  await prisma.saleItem.deleteMany({ where: { saleId } });
  await prisma.sale.deleteMany({ where: { id: saleId } });
});

afterAll(async () => {
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.$disconnect();
});

describe("FiscalService", () => {
  it("mints the external id once and reuses it on a second prepare", async () => {
    const service = new FiscalService(prisma, new FakeFiscalProvider());
    const first = await service.prepare(saleId, ORG);
    const second = await service.prepare(saleId, ORG);

    expect(second.id).toBe(first.id);
    expect(second.externalId).toBe(first.externalId);
    expect(first.status).toBe(FiscalReceiptStatus.PENDING);
  });

  it("records a registered receipt with its number and QR", async () => {
    const service = new FiscalService(prisma, new FakeFiscalProvider());
    const prepared = await service.prepare(saleId, ORG);
    const result = await service.attempt(prepared.id);

    expect(result.status).toBe(FiscalReceiptStatus.REGISTERED);
    expect(result.ticketNumber).toBeTruthy();
    expect(result.qrCode).toBeTruthy();
    expect(result.registeredAt).toBeTruthy();
    expect(result.errorMessage).toBeNull();
  });

  it("a timeout becomes UNKNOWN, never FAILED", async () => {
    // The distinction is the whole point: FAILED means "definitely no
    // receipt", UNKNOWN means "we cannot tell" and must not be treated as a
    // clean failure.
    const provider = new ScriptedProvider();
    provider.outcome = { kind: "unknown", message: "Соединение прервано" };
    const service = new FiscalService(prisma, provider);

    const prepared = await service.prepare(saleId, ORG);
    const result = await service.attempt(prepared.id);

    expect(result.status).toBe(FiscalReceiptStatus.UNKNOWN);
    expect(result.errorMessage).toContain("Соединение");
  });

  it("retrying after a timeout reuses the same external id", async () => {
    // If a retry invented a new id, re:Kassa would have no way to recognise
    // it as the same receipt and would punch a second one.
    const provider = new ScriptedProvider();
    provider.outcome = { kind: "unknown", message: "таймаут" };
    const service = new FiscalService(prisma, provider);

    const prepared = await service.prepare(saleId, ORG);
    await service.attempt(prepared.id);
    provider.outcome = {
      kind: "ok",
      result: {
        providerTicketId: "1",
        ticketNumber: "123",
        offlineTicketNumber: null,
        isOffline: false,
        qrCode: "https://example.invalid/1",
        kgdKkmId: null,
        shiftNumber: 1,
        raw: {},
      },
    };
    const retried = await service.attempt(prepared.id);

    expect(provider.seen).toHaveLength(2);
    expect(provider.seen[0].externalId).toBe(provider.seen[1].externalId);
    expect(provider.seen[0].externalId).toBe(prepared.externalId);
    expect(retried.status).toBe(FiscalReceiptStatus.REGISTERED);
    expect(retried.attempts).toBe(2);
  });

  it("treats the provider's own duplicate error as 'already sent', not a failure", async () => {
    // DUPLICATE_EXTERNAL_ID means an earlier attempt reached them. Recording
    // it as FAILED would invite punching the sale again.
    const provider = new ScriptedProvider();
    provider.outcome = { kind: "rejected", code: "DUPLICATE_EXTERNAL_ID", message: "" };
    const service = new FiscalService(prisma, provider);

    const prepared = await service.prepare(saleId, ORG);
    const result = await service.attempt(prepared.id);

    expect(result.status).toBe(FiscalReceiptStatus.UNKNOWN);
    expect(result.status).not.toBe(FiscalReceiptStatus.FAILED);
  });

  it("records a genuine rejection as FAILED with the provider's reason", async () => {
    const provider = new ScriptedProvider();
    provider.outcome = { kind: "rejected", code: "PROTOCOL_ERROR", message: "Неверный формат" };
    const service = new FiscalService(prisma, provider);

    const prepared = await service.prepare(saleId, ORG);
    const result = await service.attempt(prepared.id);

    expect(result.status).toBe(FiscalReceiptStatus.FAILED);
    expect(result.errorCode).toBe("PROTOCOL_ERROR");
    expect(result.errorMessage).toBe("Неверный формат");
  });

  it("refuses a sale whose product has no ИКПУ, before calling the provider", async () => {
    const noNtin = await prisma.product.create({
      data: {
        organizationId: ORG,
        name: "Без ИКПУ",
        sku: `NO-NTIN-${Date.now()}`,
        unit: "PCS",
        type: "FINISHED_GOOD",
        price: 100,
      },
    });
    const sale = await prisma.sale.create({
      data: {
        organizationId: ORG,
        locationId,
        soldAt: new Date(),
        totalAmount: 100,
        amountPaid: 100,
        paymentMethod: "CASH",
        createdById: userId,
        items: { create: [{ productId: noNtin.id, quantity: 1, unitPrice: 100, subtotal: 100 }] },
      },
    });

    const provider = new ScriptedProvider();
    const service = new FiscalService(prisma, provider);
    const prepared = await service.prepare(sale.id, ORG);
    const result = await service.attempt(prepared.id);

    expect(provider.seen).toHaveLength(0);
    expect(result.status).toBe(FiscalReceiptStatus.FAILED);
    expect(result.errorMessage).toContain("Без ИКПУ");

    await prisma.fiscalReceipt.deleteMany({ where: { saleId: sale.id } });
    await prisma.saleItem.deleteMany({ where: { saleId: sale.id } });
    await prisma.sale.deleteMany({ where: { id: sale.id } });
    await prisma.product.deleteMany({ where: { id: noNtin.id } });
  });

  it("lets only one of two simultaneous attempts reach the provider", async () => {
    // Two tabs, or a retry racing a background job: the conditional UPDATE is
    // the only thing standing between that and two receipts.
    const provider = new ScriptedProvider();
    provider.outcome = {
      kind: "ok",
      result: {
        providerTicketId: "1",
        ticketNumber: "555",
        offlineTicketNumber: null,
        isOffline: false,
        qrCode: null,
        kgdKkmId: null,
        shiftNumber: 1,
        raw: {},
      },
    };
    const service = new FiscalService(prisma, provider);
    const prepared = await service.prepare(saleId, ORG);

    await Promise.all([service.attempt(prepared.id), service.attempt(prepared.id)]);

    expect(provider.seen).toHaveLength(1);
  });

  it("does not re-send a receipt that is already registered", async () => {
    const provider = new ScriptedProvider();
    provider.outcome = {
      kind: "ok",
      result: {
        providerTicketId: "1",
        ticketNumber: "777",
        offlineTicketNumber: null,
        isOffline: false,
        qrCode: null,
        kgdKkmId: null,
        shiftNumber: 1,
        raw: {},
      },
    };
    const service = new FiscalService(prisma, provider);
    const prepared = await service.prepare(saleId, ORG);

    await service.attempt(prepared.id);
    const again = await service.attempt(prepared.id);

    expect(provider.seen).toHaveLength(1);
    expect(again.status).toBe(FiscalReceiptStatus.REGISTERED);
  });

  it("lists failed and unresolved receipts as needing attention", async () => {
    const provider = new ScriptedProvider();
    provider.outcome = { kind: "rejected", code: "PROTOCOL_ERROR", message: "плохо" };
    const service = new FiscalService(prisma, provider);

    const prepared = await service.prepare(saleId, ORG);
    await service.attempt(prepared.id);

    const attention = await service.needsAttention(ORG);
    expect(attention.some((r) => r.id === prepared.id)).toBe(true);
  });
});
