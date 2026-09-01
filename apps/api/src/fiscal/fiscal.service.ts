import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { FiscalReceipt, FiscalReceiptStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  FISCAL_PROVIDER,
  FiscalPaymentType,
  FiscalProvider,
  FiscalSaleRequest,
} from "./fiscal-provider";

// Unit codes from the fiscal classifier. 796 = штука; weight/volume goods use
// their own codes. Kept minimal on purpose — extend it when a product that
// actually needs another code appears, not speculatively.
const MEASURE_UNIT_CODE_BY_UNIT: Record<string, string> = {
  PCS: "796",
  KG: "166",
  G: "163",
  L: "112",
  ML: "111",
};
const DEFAULT_MEASURE_UNIT_CODE = "796";

const PAYMENT_TYPE_BY_METHOD: Record<string, FiscalPaymentType> = {
  CASH: "CASH",
  CARD: "CARD",
  // A bank transfer is not a till payment type in the protocol; it is
  // reported as a card (non-cash) settlement.
  TRANSFER: "CARD",
};

@Injectable()
export class FiscalService {
  private readonly logger = new Logger(FiscalService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(FISCAL_PROVIDER) private provider: FiscalProvider,
  ) {}

  // Creates (or returns) the fiscal receipt row for a sale. The externalId is
  // minted exactly once here and never regenerated: it is the idempotency key
  // that makes every later retry safe.
  async prepare(saleId: string, organizationId: string): Promise<FiscalReceipt> {
    const existing = await this.prisma.fiscalReceipt.findUnique({ where: { saleId } });
    if (existing) return existing;

    return this.prisma.fiscalReceipt.create({
      data: { saleId, organizationId, externalId: randomUUID() },
    });
  }

  // Tries to register the receipt with the fiscal operator.
  //
  // Only one caller can be in flight for a given receipt: the conditional
  // UPDATE below is the same mechanism TelegramPendingAction uses, and it is
  // the only real guarantee here — two simultaneous attempts would otherwise
  // both call the provider.
  async attempt(receiptId: string): Promise<FiscalReceipt> {
    const receipt = await this.prisma.fiscalReceipt.findUnique({ where: { id: receiptId } });
    if (!receipt) throw new NotFoundException("Фискальный чек не найден");
    if (receipt.status === FiscalReceiptStatus.REGISTERED) return receipt;

    // Retryable states only. UNKNOWN is deliberately included: re:Kassa treats
    // a repeat of the same X-Request-ID within a shift as the same request, so
    // resending is how an unknown outcome gets resolved — it either returns
    // the original receipt or reports it as a duplicate, and both mean "it
    // already exists". What is never done is sending a NEW externalId.
    const retryable: FiscalReceiptStatus[] = [
      FiscalReceiptStatus.PENDING,
      FiscalReceiptStatus.FAILED,
      FiscalReceiptStatus.UNKNOWN,
    ];
    if (!retryable.includes(receipt.status)) {
      // SENDING — another attempt owns it right now.
      return receipt;
    }

    const claimed = await this.prisma.fiscalReceipt.updateMany({
      where: { id: receiptId, status: { in: retryable } },
      data: { status: FiscalReceiptStatus.SENDING, attempts: { increment: 1 }, lastAttemptAt: new Date() },
    });
    if (claimed.count === 0) {
      return (await this.prisma.fiscalReceipt.findUnique({ where: { id: receiptId } })) ?? receipt;
    }

    let request: FiscalSaleRequest;
    try {
      request = await this.buildRequest(receipt);
    } catch (err) {
      // A payload we cannot even build (missing ИКПУ, missing coordinates) is
      // a rejection before anything left the building — nothing is in doubt.
      const message = err instanceof Error ? err.message : "Не удалось собрать чек";
      return this.recordRejected(receiptId, "INVALID_PAYLOAD", message);
    }

    const outcome = await this.provider.registerSale(request);

    if (outcome.kind === "ok") {
      return this.prisma.fiscalReceipt.update({
        where: { id: receiptId },
        data: {
          status: FiscalReceiptStatus.REGISTERED,
          providerTicketId: outcome.result.providerTicketId,
          ticketNumber: outcome.result.ticketNumber,
          offlineTicketNumber: outcome.result.offlineTicketNumber,
          isOffline: outcome.result.isOffline,
          qrCode: outcome.result.qrCode,
          kgdKkmId: outcome.result.kgdKkmId,
          shiftNumber: outcome.result.shiftNumber,
          registeredAt: new Date(),
          providerResponse: outcome.result.raw as Prisma.InputJsonValue,
          errorCode: null,
          errorMessage: null,
        },
      });
    }

    if (outcome.kind === "rejected") {
      // Their own duplicate-detection firing means the receipt already exists
      // on their side under this externalId. That is emphatically NOT a
      // failure — it is the idempotency guarantee doing its job after an
      // earlier attempt whose answer we never saw. Left as UNKNOWN rather
      // than invented as REGISTERED: we still have no receipt number, so a
      // human (or a lookup, once implemented) must resolve it.
      if (outcome.code === "DUPLICATE_EXTERNAL_ID") {
        this.logger.warn(
          `Receipt ${receiptId} reported as duplicate — an earlier attempt likely succeeded; needs resolving`,
        );
        return this.recordUnknown(receiptId, "Чек уже был отправлен ранее — требуется сверка с re:Kassa");
      }
      return this.recordRejected(receiptId, outcome.code, outcome.message);
    }

    return this.recordUnknown(receiptId, outcome.message);
  }

  // Sales whose fiscal side needs a human: rejected outright, or in doubt.
  async needsAttention(organizationId: string): Promise<FiscalReceipt[]> {
    return this.prisma.fiscalReceipt.findMany({
      where: {
        organizationId,
        status: { in: [FiscalReceiptStatus.FAILED, FiscalReceiptStatus.UNKNOWN] },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  private async recordRejected(receiptId: string, code: string, message: string): Promise<FiscalReceipt> {
    return this.prisma.fiscalReceipt.update({
      where: { id: receiptId },
      data: { status: FiscalReceiptStatus.FAILED, errorCode: code, errorMessage: message },
    });
  }

  private async recordUnknown(receiptId: string, message: string): Promise<FiscalReceipt> {
    return this.prisma.fiscalReceipt.update({
      where: { id: receiptId },
      data: { status: FiscalReceiptStatus.UNKNOWN, errorCode: "UNKNOWN", errorMessage: message },
    });
  }

  // Translates our own sale into the provider-neutral request. Throws rather
  // than guessing when something legally required is missing.
  private async buildRequest(receipt: FiscalReceipt): Promise<FiscalSaleRequest> {
    const sale = await this.prisma.sale.findUnique({
      where: { id: receipt.saleId },
      include: { items: { include: { product: true } }, location: true },
    });
    if (!sale) throw new Error("Продажа не найдена");

    const missingNtin = sale.items.filter((item) => !item.product.ntin).map((item) => item.product.name);
    if (missingNtin.length > 0) {
      // Refused before any call: a receipt line without an ИКПУ has been
      // illegal since 01.01.2026, and the operator would reject it anyway.
      throw new Error(`Не заполнен код ИКПУ у товаров: ${missingNtin.join(", ")}`);
    }

    if (sale.location.lat === null || sale.location.lng === null) {
      // Coordinates became mandatory in protocol 2.0.3.
      throw new Error(`Не указаны координаты точки «${sale.location.name}»`);
    }

    const total = sale.totalAmount.toNumber();
    const paymentType = PAYMENT_TYPE_BY_METHOD[sale.paymentMethod] ?? "CASH";

    return {
      externalId: receipt.externalId,
      occurredAt: sale.soldAt,
      lines: sale.items.map((item) => ({
        name: item.product.name,
        quantity: item.quantity.toNumber(),
        unitPrice: item.unitPrice.toNumber(),
        total: item.subtotal.toNumber(),
        ntin: item.product.ntin as string,
        measureUnitCode: MEASURE_UNIT_CODE_BY_UNIT[item.product.unit] ?? DEFAULT_MEASURE_UNIT_CODE,
      })),
      payments: [{ type: paymentType, amount: total }],
      total,
      // Cash handed over and change are only meaningful for a cash till that
      // tracks them; the POS settles the exact amount, so they mirror total.
      taken: paymentType === "CASH" ? total : 0,
      change: 0,
      latitude: sale.location.lat,
      longitude: sale.location.lng,
    };
  }
}
