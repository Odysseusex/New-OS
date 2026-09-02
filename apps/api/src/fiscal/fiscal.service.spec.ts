import { FiscalReceiptStatus } from "@prisma/client";
import { buildFiscalSaleRequest, FiscalSaleDraft, FiscalService } from "./fiscal.service";
import { FiscalProvider, FiscalSaleOutcome, FiscalSaleRequest, FiscalSaleResult } from "./fiscal-provider";
import { FakeFiscalProvider } from "./fake-fiscal.provider";
import { FiscalSettings } from "./fiscal.settings";
import { PrismaService } from "../prisma/prisma.service";

// Runs against the real local database — the claim logic is a conditional
// UPDATE, and mocking Prisma would test the mock rather than the guarantee.
//
// Shares that database and demo org with sales-fiscal.spec.ts, so the two
// must not run in parallel workers (`maxWorkers: 1` in the API's jest
// config). reconcile() sweeps the whole org, which makes cross-suite
// interference immediate rather than subtle.
const prisma = new PrismaService();

const ORG = "demo-org";
const createdReceiptIds: string[] = [];

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
  async registerReturn(request: FiscalSaleRequest): Promise<FiscalSaleOutcome> {
    return this.registerSale(request);
  }
  async getShiftState() {
    return null;
  }
}

const registered = (ticketNumber: string): FiscalSaleResult => ({
  providerTicketId: "1",
  ticketNumber,
  offlineTicketNumber: null,
  isOffline: false,
  qrCode: null,
  kgdKkmId: null,
  shiftNumber: 1,
  raw: {},
});

const draft = (): FiscalSaleDraft =>
  buildFiscalSaleRequest({
    occurredAt: new Date("2026-08-22T05:00:00.000Z"),
    paymentMethod: "CASH",
    location: { name: "Точка", lat: 43.2389, lng: 76.8897 },
    total: 1180,
    lines: [
      {
        product: { name: "Хлеб", unit: "PCS", ntin: "0200000000001" },
        quantity: 2,
        unitPrice: 590,
        subtotal: 1180,
      },
    ],
  });

// Records every receipt a test creates so the demo database is left as found.
async function prepare(service: FiscalService) {
  const receipt = await service.prepare(ORG, draft());
  createdReceiptIds.push(receipt.id);
  return receipt;
}

beforeAll(() => prisma.$connect());

afterAll(async () => {
  await prisma.fiscalReceipt.deleteMany({ where: { id: { in: createdReceiptIds } } });
  await prisma.$disconnect();
});

describe("buildFiscalSaleRequest", () => {
  it("refuses a cart whose product has no NTIN", () => {
    // Legally required per line since 01.01.2026 — refused here, before any
    // receipt row exists and long before anything is sent.
    expect(() =>
      buildFiscalSaleRequest({
        occurredAt: new Date(),
        paymentMethod: "CASH",
        location: { name: "Точка", lat: 43.2, lng: 76.8 },
        total: 100,
        lines: [
          { product: { name: "Без NTIN", unit: "PCS", ntin: null }, quantity: 1, unitPrice: 100, subtotal: 100 },
        ],
      }),
    ).toThrow("Не заполнен код NTIN у товаров: Без NTIN");
  });

  it("refuses a point of sale with no coordinates", () => {
    // Mandatory since protocol 2.0.3.
    expect(() =>
      buildFiscalSaleRequest({
        occurredAt: new Date(),
        paymentMethod: "CASH",
        location: { name: "Ларёк", lat: null, lng: null },
        total: 100,
        lines: [
          { product: { name: "Хлеб", unit: "PCS", ntin: "0200000000001" }, quantity: 1, unitPrice: 100, subtotal: 100 },
        ],
      }),
    ).toThrow("Не указаны координаты точки «Ларёк»");
  });

  it("reports a bank transfer as a non-cash settlement", () => {
    // TRANSFER is not a till payment type in the protocol.
    const request = buildFiscalSaleRequest({
      occurredAt: new Date(),
      paymentMethod: "TRANSFER",
      location: { name: "Точка", lat: 43.2, lng: 76.8 },
      total: 500,
      lines: [
        { product: { name: "Хлеб", unit: "PCS", ntin: "0200000000001" }, quantity: 1, unitPrice: 500, subtotal: 500 },
      ],
    });
    expect(request.payments[0].type).toBe("CARD");
    // Nothing was handed over in cash, so there is no "taken" amount.
    expect(request.taken).toBe(0);
  });

  it("carries the unit code the classifier expects for weight goods", () => {
    const request = buildFiscalSaleRequest({
      occurredAt: new Date(),
      paymentMethod: "CASH",
      location: { name: "Точка", lat: 43.2, lng: 76.8 },
      total: 900,
      lines: [
        { product: { name: "Мука", unit: "KG", ntin: "0200000000002" }, quantity: 1.5, unitPrice: 600, subtotal: 900 },
      ],
    });
    expect(request.lines[0].measureUnitCode).toBe("166");
  });
});

describe("FiscalService", () => {
  it("mints a fresh external id for every prepared receipt", async () => {
    const service = new FiscalService(prisma, new FakeFiscalProvider(), new FiscalSettings());
    const first = await prepare(service);
    const second = await prepare(service);

    expect(first.externalId).not.toBe(second.externalId);
    expect(first.status).toBe(FiscalReceiptStatus.PENDING);
    expect(first.saleId).toBeNull();
  });

  it("records a registered receipt with its number and QR", async () => {
    const service = new FiscalService(prisma, new FakeFiscalProvider(), new FiscalSettings());
    const result = await service.attempt((await prepare(service)).id);

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
    const service = new FiscalService(prisma, provider, new FiscalSettings());

    const result = await service.attempt((await prepare(service)).id);

    expect(result.status).toBe(FiscalReceiptStatus.UNKNOWN);
    expect(result.errorMessage).toContain("Соединение");
  });

  it("retrying after a timeout resends the identical request under the same id", async () => {
    // If a retry invented a new id, re:Kassa would have no way to recognise
    // it as the same receipt and would punch a second one.
    const provider = new ScriptedProvider();
    provider.outcome = { kind: "unknown", message: "таймаут" };
    const service = new FiscalService(prisma, provider, new FiscalSettings());

    const prepared = await prepare(service);
    await service.attempt(prepared.id);
    provider.outcome = { kind: "ok", result: registered("123") };
    const retried = await service.attempt(prepared.id);

    expect(provider.seen).toHaveLength(2);
    expect(provider.seen[0].externalId).toBe(prepared.externalId);
    expect(provider.seen[1]).toEqual(provider.seen[0]);
    // The timestamp survived the round trip through JSON as a Date, not the
    // string it was stored as.
    expect(provider.seen[1].occurredAt).toBeInstanceOf(Date);
    expect(provider.seen[1].occurredAt.toISOString()).toBe("2026-08-22T05:00:00.000Z");
    expect(retried.status).toBe(FiscalReceiptStatus.REGISTERED);
    expect(retried.attempts).toBe(2);
  });

  it("treats the provider's own duplicate error as 'already sent', not a failure", async () => {
    // DUPLICATE_EXTERNAL_ID means an earlier attempt reached them. Recording
    // it as FAILED would invite punching the sale again.
    const provider = new ScriptedProvider();
    provider.outcome = { kind: "rejected", code: "DUPLICATE_EXTERNAL_ID", message: "" };
    const service = new FiscalService(prisma, provider, new FiscalSettings());

    const result = await service.attempt((await prepare(service)).id);

    expect(result.status).toBe(FiscalReceiptStatus.UNKNOWN);
    expect(result.status).not.toBe(FiscalReceiptStatus.FAILED);
  });

  it("records a genuine rejection as FAILED with the provider's reason", async () => {
    const provider = new ScriptedProvider();
    provider.outcome = { kind: "rejected", code: "PROTOCOL_ERROR", message: "Неверный формат" };
    const service = new FiscalService(prisma, provider, new FiscalSettings());

    const result = await service.attempt((await prepare(service)).id);

    expect(result.status).toBe(FiscalReceiptStatus.FAILED);
    expect(result.errorCode).toBe("PROTOCOL_ERROR");
    expect(result.errorMessage).toBe("Неверный формат");
  });

  it("lets only one of two simultaneous attempts reach the provider", async () => {
    // Two tabs, or a retry racing a background job: the conditional UPDATE is
    // the only thing standing between that and two receipts.
    const provider = new ScriptedProvider();
    provider.outcome = { kind: "ok", result: registered("555") };
    const service = new FiscalService(prisma, provider, new FiscalSettings());
    const prepared = await prepare(service);

    await Promise.all([service.attempt(prepared.id), service.attempt(prepared.id)]);

    expect(provider.seen).toHaveLength(1);
  });

  it("does not re-send a receipt that is already registered", async () => {
    const provider = new ScriptedProvider();
    provider.outcome = { kind: "ok", result: registered("777") };
    const service = new FiscalService(prisma, provider, new FiscalSettings());
    const prepared = await prepare(service);

    await service.attempt(prepared.id);
    const again = await service.attempt(prepared.id);

    expect(provider.seen).toHaveLength(1);
    expect(again.status).toBe(FiscalReceiptStatus.REGISTERED);
  });

  it("lists failed and unresolved receipts as needing attention", async () => {
    const provider = new ScriptedProvider();
    provider.outcome = { kind: "rejected", code: "PROTOCOL_ERROR", message: "плохо" };
    const service = new FiscalService(prisma, provider, new FiscalSettings());

    const prepared = await prepare(service);
    await service.attempt(prepared.id);

    const attention = await service.needsAttention(ORG);
    expect(attention.some((r) => r.id === prepared.id)).toBe(true);
  });

  it("flags a receipt that was punched but never reached a sale", async () => {
    // The one hole the two-phase order can leave: the operator registered the
    // receipt, then writing the sale failed. Money was taken against a fiscal
    // document with nothing behind it, so it must not stay invisible.
    const provider = new ScriptedProvider();
    provider.outcome = { kind: "ok", result: registered("888") };
    const service = new FiscalService(prisma, provider, new FiscalSettings());

    const prepared = await prepare(service);
    await service.attempt(prepared.id);

    const attention = await service.needsAttention(ORG);
    expect(attention.some((r) => r.id === prepared.id)).toBe(true);
  });

  describe("reconcile", () => {
    it("resolves an UNKNOWN receipt once the provider is reachable again", async () => {
      const provider = new ScriptedProvider();
      provider.outcome = { kind: "unknown", message: "оборвалась связь" };
      const service = new FiscalService(prisma, provider, new FiscalSettings());

      const prepared = await prepare(service);
      await service.attempt(prepared.id);
      expect((await service.needsAttention(ORG)).map((r) => r.id)).toContain(prepared.id);

      provider.outcome = { kind: "ok", result: registered("999") };
      // reconcile() sweeps every UNKNOWN receipt for the org, and earlier
      // tests in this file leave some behind — find this test's own receipt
      // in the results rather than assuming it is the only, or the first.
      const results = await service.reconcile(ORG);
      const resolved = results.find((r) => r.id === prepared.id);

      expect(resolved?.status).toBe(FiscalReceiptStatus.REGISTERED);
      expect(resolved?.ticketNumber).toBe("999");
      // A second pass has nothing left to do for THIS receipt specifically.
      const secondPass = await service.reconcile(ORG);
      expect(secondPass.some((r) => r.id === prepared.id)).toBe(false);
    });

    it("leaves FAILED receipts alone — a retry cannot fix a stated rejection", async () => {
      const provider = new ScriptedProvider();
      provider.outcome = { kind: "rejected", code: "PROTOCOL_ERROR", message: "плохо" };
      const service = new FiscalService(prisma, provider, new FiscalSettings());

      const prepared = await prepare(service);
      await service.attempt(prepared.id);
      expect(provider.seen).toHaveLength(1);

      // reconcile() sweeps the whole org, and other spec files run against
      // this same demo org concurrently — so this only checks that OUR
      // receipt is absent from the sweep, not that the sweep found nothing
      // at all.
      const result = await service.reconcile(ORG);

      expect(result.some((r) => r.id === prepared.id)).toBe(false);
      expect(provider.seen).toHaveLength(1); // never called again
      const stillFailed = await prisma.fiscalReceipt.findUnique({ where: { id: prepared.id } });
      expect(stillFailed?.status).toBe(FiscalReceiptStatus.FAILED);
    });

    it("converges: a resolved receipt is not picked up by a second pass", async () => {
      // Other spec files touch UNKNOWN receipts in this same demo org
      // concurrently, so this can only assert about OUR receipt, not that
      // reconcile() finds nothing at all for the whole org.
      const provider = new ScriptedProvider();
      provider.outcome = { kind: "unknown", message: "оборвалась связь" };
      const service = new FiscalService(prisma, provider, new FiscalSettings());

      const prepared = await prepare(service);
      await service.attempt(prepared.id);

      provider.outcome = { kind: "ok", result: registered("convergence") };
      await service.reconcile(ORG);

      const secondPass = await service.reconcile(ORG);
      expect(secondPass.some((r) => r.id === prepared.id)).toBe(false);
    });
  });
});
