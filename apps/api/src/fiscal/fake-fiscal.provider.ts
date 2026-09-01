import { Injectable, Logger } from "@nestjs/common";
import { FiscalProvider, FiscalSaleOutcome, FiscalSaleRequest } from "./fiscal-provider";

// Stand-in used whenever re:Kassa credentials are absent — which is the case
// on every developer machine and, for now, in production too.
//
// It is not a toy: it reproduces the one behaviour the rest of the system
// depends on being right, namely that repeating a request with the same
// externalId returns the ORIGINAL receipt instead of creating a second one.
// That lets the retry logic be exercised locally, long before anyone can
// punch a real test receipt.
@Injectable()
export class FakeFiscalProvider implements FiscalProvider {
  readonly name = "fake";
  private readonly logger = new Logger(FakeFiscalProvider.name);
  private readonly issued = new Map<string, FiscalSaleOutcome>();
  private counter = 0;

  isConfigured(): boolean {
    return true;
  }

  async registerSale(request: FiscalSaleRequest): Promise<FiscalSaleOutcome> {
    const seen = this.issued.get(request.externalId);
    if (seen) {
      this.logger.log(`Replaying receipt for ${request.externalId} (idempotent)`);
      return seen;
    }

    this.counter += 1;
    const ticketNumber = String(900000000000 + this.counter);
    const outcome: FiscalSaleOutcome = {
      kind: "ok",
      result: {
        providerTicketId: `fake-${this.counter}`,
        ticketNumber,
        offlineTicketNumber: null,
        isOffline: false,
        qrCode: `https://example.invalid/receipt/${ticketNumber}`,
        kgdKkmId: "000000000000",
        shiftNumber: 1,
        raw: { fake: true, externalId: request.externalId, total: request.total },
      },
    };
    this.issued.set(request.externalId, outcome);
    return outcome;
  }
}
