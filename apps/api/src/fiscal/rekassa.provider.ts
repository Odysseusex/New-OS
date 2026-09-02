import { Injectable, Logger } from "@nestjs/common";
import {
  FiscalPaymentType,
  FiscalProvider,
  FiscalSaleOutcome,
  FiscalReturnRequest,
  FiscalSaleRequest,
  FiscalShiftState,
} from "./fiscal-provider";
import { toFiscalDateTime, toFiscalMoney, toFiscalQuantity } from "./fiscal-encoding";

// Wall-clock zone the receipts are stamped in. Same constant meaning as
// SalesService.REPORTING_TIME_ZONE — a receipt must show the till's day.
const RECEIPT_TIME_ZONE = "Asia/Almaty";

// Their JWT is short-lived (the documented example is 15 minutes), so it is
// cached and re-fetched with a margin rather than requested per receipt.
const TOKEN_TTL_MS = 12 * 60 * 1000;

// A fiscal call must not hang a cashier indefinitely; past this we treat the
// outcome as UNKNOWN and resolve it separately, never by blind retry.
const REQUEST_TIMEOUT_MS = 20_000;

const PAYMENT_TYPE_MAP: Record<FiscalPaymentType, string> = {
  CASH: "PAYMENT_CASH",
  CARD: "PAYMENT_CARD",
  MOBILE: "PAYMENT_MOBILE",
};

interface LoginResponse {
  id: number;
  serialNumber: string;
  token: string;
  timeOffset: string;
  localDateTime: string;
}

@Injectable()
export class ReKassaProvider implements FiscalProvider {
  readonly name = "rekassa";
  private readonly logger = new Logger(ReKassaProvider.name);

  private token: string | null = null;
  private tokenExpiresAt = 0;
  private cashRegisterId: number | null = null;
  // The KGD's own id for this cash register (their `registrationNumber`).
  // Constant per till and required on every return receipt, so it is fetched
  // once and kept rather than stored on each receipt — it describes the
  // machine, not the sale.
  private kgdKkmId: string | null = null;

  // All four come from the environment, never from code: moving from their
  // test server to the live one is then a config change, not a release.
  private readonly baseUrl = process.env.REKASSA_BASE_URL ?? "";
  private readonly apiKey = process.env.REKASSA_API_KEY ?? "";
  private readonly serialNumber = process.env.REKASSA_CASH_REGISTER_NUMBER ?? "";
  private readonly password = process.env.REKASSA_CASH_REGISTER_PASSWORD ?? "";

  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.apiKey && this.serialNumber && this.password);
  }

  async registerSale(request: FiscalSaleRequest): Promise<FiscalSaleOutcome> {
    return this.submit(request, (r) => this.buildTicket(r as FiscalSaleRequest));
  }

  // A return quotes the sale it reverses. Established against their sandbox:
  // an empty parentTicket made them list the required fields by name, and
  // `taken` must be 0 — nothing is handed over by a buyer being refunded.
  async registerReturn(request: FiscalReturnRequest): Promise<FiscalSaleOutcome> {
    return this.submit(request, (r) => this.buildReturnTicket(r as FiscalReturnRequest));
  }

  // The shared half of both operations: authenticate, POST the ticket, and
  // map the answer onto our three outcomes. Only the body differs.
  private async submit(
    request: FiscalSaleRequest,
    buildBody: (request: FiscalSaleRequest) => Record<string, unknown>,
  ): Promise<FiscalSaleOutcome> {
    if (!this.isConfigured()) {
      return { kind: "rejected", code: "NOT_CONFIGURED", message: "Фискализация не настроена" };
    }

    let auth: { token: string; cashRegisterId: number };
    try {
      auth = await this.authenticate();
    } catch (err) {
      // Failing to log in means nothing was submitted, so this is a clean
      // rejection rather than an unknown outcome.
      const message = err instanceof Error ? err.message : "Не удалось авторизоваться в re:Kassa";
      return { kind: "rejected", code: "AUTH_FAILED", message };
    }

    // Needed only by returns, but fetched here so the body builder stays a
    // pure function of the request.
    await this.ensureKgdKkmId(auth);

    let body: Record<string, unknown>;
    try {
      body = buildBody(request);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось собрать чек";
      return { kind: "rejected", code: "INVALID_PAYLOAD", message };
    }

    const url = `${this.baseUrl}/api/crs/${auth.cashRegisterId}/tickets`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
          // The idempotency key. Reused verbatim on every retry of this sale,
          // which is what stops a timeout from punching a second receipt.
          "X-Request-ID": request.externalId,
          // Mandatory since 2.0.3.
          "X-Geo-Latitude": String(request.latitude),
          "X-Geo-Longitude": String(request.longitude),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // Timeout or transport failure: the receipt may or may not exist on
      // their side. Deliberately NOT reported as a rejection.
      const message = err instanceof Error ? err.message : "Нет связи с re:Kassa";
      this.logger.warn(`Fiscal call outcome unknown for ${request.externalId}: ${message}`);
      return { kind: "unknown", message };
    }

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const code = (payload as { code?: string } | null)?.code ?? `HTTP_${response.status}`;
      const message = (payload as { message?: string } | null)?.message ?? "Ошибка фискализации";
      return { kind: "rejected", code, message };
    }

    const ticket = payload as Record<string, unknown> | null;
    if (!ticket || typeof ticket.id === "undefined") {
      return { kind: "rejected", code: "MALFORMED_RESPONSE", message: "Неожиданный ответ re:Kassa" };
    }

    // A 200 whose body reports an error status is still a rejection: the call
    // succeeded, the receipt did not.
    const status = typeof ticket.status === "string" ? ticket.status : null;
    if (status === "ERROR") {
      const errorType = typeof ticket.errorType === "string" ? ticket.errorType : "ERROR";
      return { kind: "rejected", code: errorType, message: "re:Kassa отклонила чек" };
    }

    return {
      kind: "ok",
      result: {
        providerTicketId: String(ticket.id),
        ticketNumber: asStringOrNull(ticket.ticketNumber),
        offlineTicketNumber: asStringOrNull(ticket.offlineTicketNumber),
        isOffline: ticket.offline === true,
        qrCode: asStringOrNull(ticket.qrCode),
        kgdKkmId: asStringOrNull(ticket.kgdKkmId),
        shiftNumber: typeof ticket.shiftNumber === "number" ? ticket.shiftNumber : null,
        raw: ticket,
      },
    };
  }

  // Their cash-register endpoint carries the whole shift state, so this is
  // one plain GET rather than anything clever. Verified against the sandbox:
  // shiftExpireTime is exactly shiftOpenTime + 24h.
  async getShiftState(): Promise<FiscalShiftState | null> {
    if (!this.isConfigured()) return null;

    try {
      const auth = await this.authenticate();
      const response = await fetch(`${this.baseUrl}/api/crs/${auth.cashRegisterId}`, {
        headers: { Authorization: `Bearer ${auth.token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) return null;

      const cr = (await response.json()) as {
        shiftNumber?: number;
        shiftOpen?: boolean;
        shiftOpenTime?: string | null;
        shiftExpireTime?: string | null;
        shiftExpired?: boolean;
      };

      return {
        shiftNumber: typeof cr.shiftNumber === "number" ? cr.shiftNumber : null,
        isOpen: cr.shiftOpen === true,
        openedAt: cr.shiftOpenTime ? new Date(cr.shiftOpenTime) : null,
        expiresAt: cr.shiftExpireTime ? new Date(cr.shiftExpireTime) : null,
        isExpired: cr.shiftExpired === true,
      };
    } catch (err) {
      this.logger.warn(`Could not read shift state: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  private async ensureKgdKkmId(auth: { token: string; cashRegisterId: number }): Promise<void> {
    if (this.kgdKkmId) return;
    try {
      const response = await fetch(`${this.baseUrl}/api/crs/${auth.cashRegisterId}`, {
        headers: { Authorization: `Bearer ${auth.token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) return;
      const cr = (await response.json()) as { registrationNumber?: string };
      this.kgdKkmId = cr.registrationNumber ?? null;
    } catch {
      // A sale does not need it; a return will refuse to build without it,
      // which is the right place for that failure to surface.
    }
  }

  private async authenticate(): Promise<{ token: string; cashRegisterId: number }> {
    if (this.token && this.cashRegisterId !== null && Date.now() < this.tokenExpiresAt) {
      return { token: this.token, cashRegisterId: this.cashRegisterId };
    }

    const url = `${this.baseUrl}/api/auth/login?apiKey=${encodeURIComponent(this.apiKey)}&format=json`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ number: this.serialNumber, password: this.password }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const code = (payload as { code?: string } | null)?.code ?? `HTTP_${response.status}`;
      throw new Error(`re:Kassa login failed: ${code}`);
    }

    const login = payload as LoginResponse;
    this.token = login.token;
    this.cashRegisterId = login.id;
    this.tokenExpiresAt = Date.now() + TOKEN_TTL_MS;
    return { token: login.token, cashRegisterId: login.id };
  }

  // Shaped per the documented TicketRequest. Kept as one pure function so it
  // can be asserted against their own published example in a test.
  buildTicket(request: FiscalSaleRequest): Record<string, unknown> {
    return {
      operation: "OPERATION_SELL",
      dateTime: toFiscalDateTime(request.occurredAt, RECEIPT_TIME_ZONE),
      domain: { type: "DOMAIN_SERVICES" },
      items: request.lines.map((line) => ({
        type: "ITEM_TYPE_COMMODITY",
        commodity: {
          name: line.name,
          sectionCode: "1",
          quantity: toFiscalQuantity(line.quantity),
          price: toFiscalMoney(line.unitPrice),
          sum: toFiscalMoney(line.total),
          ntin: line.ntin,
          measureUnitCode: line.measureUnitCode,
        },
      })),
      payments: request.payments.map((payment) => ({
        type: PAYMENT_TYPE_MAP[payment.type],
        sum: toFiscalMoney(payment.amount),
      })),
      amounts: {
        total: toFiscalMoney(request.total),
        taken: toFiscalMoney(request.taken),
        change: toFiscalMoney(request.change),
      },
    };
  }

  // The return reuses the sale's whole body and adds the parentTicket block,
  // then forces `taken` to zero: their server rejects a return that claims
  // money was handed over ("amounts taken must be 0").
  //
  // Field names are theirs, including `parentTicketDataTime` — that is not a
  // typo on our side, it is how the field is spelled in their protocol, and
  // renaming it to something sensible makes the request fail.
  buildReturnTicket(request: FiscalReturnRequest): Record<string, unknown> {
    if (!this.kgdKkmId) {
      throw new Error("Не известен регистрационный номер кассы для возвратного чека");
    }

    return {
      ...this.buildTicket(request),
      operation: "OPERATION_SELL_RETURN",
      amounts: {
        total: toFiscalMoney(request.total),
        taken: toFiscalMoney(0),
        change: toFiscalMoney(0),
      },
      parentTicket: {
        parentTicketNumber: request.parent.ticketNumber,
        parentTicketDataTime: toFiscalDateTime(request.parent.occurredAt, RECEIPT_TIME_ZONE),
        kgdKkmId: this.kgdKkmId,
        parentTicketTotal: toFiscalMoney(request.parent.total),
        parentTicketIsOffline: request.parent.isOffline,
      },
    };
  }
}

function asStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}
