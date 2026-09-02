import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { FiscalReceipt, FiscalReceiptStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { FiscalStatusDto } from "@bakery-os/shared";
import {
  FISCAL_PROVIDER,
  FiscalPaymentType,
  FiscalProvider,
  FiscalSaleRequest,
} from "./fiscal-provider";
import { FiscalSettings } from "./fiscal.settings";

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

// Everything needed to punch a receipt, in our own terms. Deliberately NOT a
// Sale row: the receipt is registered before the sale is written, so this has
// to be buildable from the cart alone.
export interface FiscalSaleSource {
  occurredAt: Date;
  paymentMethod: string;
  location: { name: string; lat: number | null; lng: number | null };
  total: number;
  lines: {
    product: { name: string; unit: string; ntin: string | null };
    quantity: number;
    unitPrice: number;
    subtotal: number;
  }[];
}

// The externalId is minted later, by prepare() — it is the one field a caller
// must never choose for itself.
export type FiscalSaleDraft = Omit<FiscalSaleRequest, "externalId">;

// Translates a cart into the provider-neutral request. Refuses, in Russian,
// rather than guessing when something legally required is missing — and does
// so before anything at all has been written or sent.
export function buildFiscalSaleRequest(source: FiscalSaleSource): FiscalSaleDraft {
  const missingNtin = source.lines.filter((l) => !l.product.ntin).map((l) => l.product.name);
  if (missingNtin.length > 0) {
    // A receipt line without an NTIN has been illegal since 01.01.2026, and
    // the operator would reject it anyway. (NTIN — the National Catalogue
    // of Goods code, Kazakhstan's own; not to be confused with ИКПУ, which
    // is the equivalent term in Uzbekistan's tasnif.soliq.uz.)
    throw new BadRequestException(`Не заполнен код NTIN у товаров: ${missingNtin.join(", ")}`);
  }

  if (source.location.lat === null || source.location.lng === null) {
    // Coordinates became mandatory in protocol 2.0.3.
    throw new BadRequestException(`Не указаны координаты точки «${source.location.name}»`);
  }

  const paymentType = PAYMENT_TYPE_BY_METHOD[source.paymentMethod] ?? "CASH";

  return {
    occurredAt: source.occurredAt,
    lines: source.lines.map((line) => ({
      name: line.product.name,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      total: line.subtotal,
      ntin: line.product.ntin as string,
      measureUnitCode: MEASURE_UNIT_CODE_BY_UNIT[line.product.unit] ?? DEFAULT_MEASURE_UNIT_CODE,
    })),
    payments: [{ type: paymentType, amount: source.total }],
    total: source.total,
    // Cash handed over and change are only meaningful for a till that tracks
    // them; the POS settles the exact amount, so they mirror total.
    taken: paymentType === "CASH" ? source.total : 0,
    change: 0,
    latitude: source.location.lat,
    longitude: source.location.lng,
  };
}

@Injectable()
export class FiscalService {
  private readonly logger = new Logger(FiscalService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(FISCAL_PROVIDER) private provider: FiscalProvider,
    private settings: FiscalSettings,
  ) {}

  // Creates the fiscal receipt row for a cart that has not been sold yet.
  //
  // The externalId is minted exactly once here and never regenerated: it is
  // the idempotency key that makes every later retry safe. The request is
  // stored alongside it because a retry must resend byte-identical content,
  // and after a timeout there is no sale row to rebuild it from.
  async prepare(organizationId: string, draft: FiscalSaleDraft): Promise<FiscalReceipt> {
    return this.prisma.fiscalReceipt.create({
      data: {
        organizationId,
        externalId: randomUUID(),
        requestPayload: draft as unknown as Prisma.InputJsonValue,
      },
    });
  }

  // Attaches a registered receipt to the sale it paid for. Called inside the
  // sale's own transaction, so the link either lands with the sale or not at
  // all.
  async linkSale(tx: Prisma.TransactionClient, receiptId: string, saleId: string): Promise<void> {
    await tx.fiscalReceipt.update({ where: { id: receiptId }, data: { saleId } });
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

    const request = this.restoreRequest(receipt);
    if (!request) {
      return this.recordRejected(receiptId, "INVALID_PAYLOAD", "Не сохранён состав чека");
    }

    const claimed = await this.prisma.fiscalReceipt.updateMany({
      where: { id: receiptId, status: { in: retryable } },
      data: { status: FiscalReceiptStatus.SENDING, attempts: { increment: 1 }, lastAttemptAt: new Date() },
    });
    if (claimed.count === 0) {
      return (await this.prisma.fiscalReceipt.findUnique({ where: { id: receiptId } })) ?? receipt;
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

  // Receipts whose fiscal side needs a human: rejected outright, in doubt, or
  // registered without ever reaching a sale (punched, then the sale itself
  // failed to record — the one case the two-phase order can leave behind).
  async needsAttention(organizationId: string): Promise<FiscalReceipt[]> {
    return this.prisma.fiscalReceipt.findMany({
      where: {
        organizationId,
        OR: [
          { status: { in: [FiscalReceiptStatus.FAILED, FiscalReceiptStatus.UNKNOWN] } },
          { status: FiscalReceiptStatus.REGISTERED, saleId: null },
        ],
      },
      orderBy: { createdAt: "desc" },
    });
  }

  // Whether fiscalisation is on, which operator is wired up, and the state of
  // the shift. The shift matters because the operator caps one at 24 hours:
  // closing it from here is not possible yet (their close endpoint wants a
  // cash-register password whose transport is still an open question), so the
  // expiry is shown instead, for a human to act on in the re:Kassa app.
  async status(organizationId: string): Promise<FiscalStatusDto> {
    const enabled = this.settings.isEnabled();
    const [shift, attention] = await Promise.all([
      enabled ? this.provider.getShiftState() : Promise.resolve(null),
      this.needsAttention(organizationId),
    ]);

    return {
      enabled,
      provider: this.provider.name,
      shift: shift
        ? {
            shiftNumber: shift.shiftNumber,
            isOpen: shift.isOpen,
            openedAt: shift.openedAt?.toISOString() ?? null,
            expiresAt: shift.expiresAt?.toISOString() ?? null,
            isExpired: shift.isExpired,
          }
        : null,
      needsAttentionCount: attention.length,
    };
  }

  // Resolves every UNKNOWN receipt for an organization by retrying it —
  // nothing more exotic than that. Verified against re:Kassa's live test
  // server that this is sound: resending the identical requestPayload under
  // the same externalId either returns the original ticket (the timeout
  // happened after they had already registered it) or genuinely tries again
  // (it never reached them at all). Both outcomes are safe because the
  // payload never changes between attempts.
  //
  // Deliberately does NOT touch FAILED — that is a definite "no" for a
  // stated reason (e.g. a missing NTIN), and retrying an unchanged payload
  // against an unchanged reason cannot resolve it; only editing the product
  // or the order can. Also does not touch a REGISTERED receipt with no
  // saleId: the fiscal side already succeeded, so calling the provider again
  // would do nothing — the missing sale needs a human, not a retry.
  async reconcile(organizationId: string): Promise<FiscalReceipt[]> {
    const stuck = await this.prisma.fiscalReceipt.findMany({
      where: { organizationId, status: FiscalReceiptStatus.UNKNOWN },
      orderBy: { createdAt: "asc" },
    });

    const results: FiscalReceipt[] = [];
    for (const receipt of stuck) {
      try {
        results.push(await this.attempt(receipt.id));
      } catch (err) {
        // One receipt must never abort the sweep — the rest still need
        // resolving, and the whole point of this pass is to unstick as many
        // as possible. A row can legitimately vanish between the query above
        // and the attempt (a cancelled sale cascades), which would otherwise
        // take every later receipt down with it.
        this.logger.warn(
          `Reconcile skipped receipt ${receipt.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return results;
  }

  // JSON has no Date, so the timestamp comes back as a string and has to be
  // revived — sending it on as a string would encode the wrong receipt time.
  private restoreRequest(receipt: FiscalReceipt): FiscalSaleRequest | null {
    if (!receipt.requestPayload) return null;
    const draft = receipt.requestPayload as unknown as FiscalSaleDraft;
    return { ...draft, occurredAt: new Date(draft.occurredAt), externalId: receipt.externalId };
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
}
