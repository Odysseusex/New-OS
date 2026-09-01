import { toFiscalDateTime, toFiscalMoney, toFiscalPercent, toFiscalQuantity } from "./fiscal-encoding";
import { ReKassaProvider } from "./rekassa.provider";
import { FiscalSaleRequest } from "./fiscal-provider";

// These encodings sit on a legally binding document, and both of them are
// counter-intuitive (money split into tenge/tiyn, quantity in thousandths).
// The assertions below are taken from re:Kassa's own published examples.
describe("fiscal encoding", () => {
  describe("toFiscalMoney", () => {
    it("splits whole tenge from tiyn", () => {
      expect(toFiscalMoney(3000)).toEqual({ bills: "3000", coins: 0 });
      expect(toFiscalMoney(650.5)).toEqual({ bills: "650", coins: 50 });
      expect(toFiscalMoney(0)).toEqual({ bills: "0", coins: 0 });
      expect(toFiscalMoney(0.05)).toEqual({ bills: "0", coins: 5 });
    });

    it("rounds to the nearest tiyn instead of truncating a float", () => {
      // 8.7 * 3 is 26.099999999999998 in binary floating point; truncating
      // would file 9 tiyn instead of 10 on the receipt.
      expect(toFiscalMoney(8.7 * 3)).toEqual({ bills: "26", coins: 10 });
      expect(toFiscalMoney(0.1 + 0.2)).toEqual({ bills: "0", coins: 30 });
    });

    it("refuses values that cannot legitimately appear on a receipt", () => {
      expect(() => toFiscalMoney(-1)).toThrow();
      expect(() => toFiscalMoney(Number.NaN)).toThrow();
    });
  });

  describe("toFiscalQuantity", () => {
    it("encodes thousandths, per the protocol's own example", () => {
      // "1000 == 1,0, 2500 == 2,5"
      expect(toFiscalQuantity(1)).toBe(1000);
      expect(toFiscalQuantity(2.5)).toBe(2500);
      expect(toFiscalQuantity(3)).toBe(3000);
      expect(toFiscalQuantity(0.001)).toBe(1);
    });

    it("refuses a zero or negative quantity", () => {
      expect(() => toFiscalQuantity(0)).toThrow();
      expect(() => toFiscalQuantity(-2)).toThrow();
    });
  });

  it("encodes percentages in thousandths of a percent", () => {
    // "12000 == 12,0%"
    expect(toFiscalPercent(12)).toBe(12000);
    expect(toFiscalPercent(1.5)).toBe(1500);
  });

  describe("toFiscalDateTime", () => {
    it("stamps the till's wall clock, not the server's UTC", () => {
      // 20:30 UTC is already the next day in Almaty (+5).
      const instant = new Date("2026-08-21T20:30:00.000Z");
      expect(toFiscalDateTime(instant, "Asia/Almaty")).toEqual({
        date: { year: 2026, month: 8, day: 22 },
        time: { hour: 1, minute: 30, second: 0 },
      });
    });

    it("reports midnight as hour 0", () => {
      const instant = new Date("2026-08-21T19:00:00.000Z"); // 00:00 Almaty
      expect(toFiscalDateTime(instant, "Asia/Almaty").time.hour).toBe(0);
    });
  });
});

describe("ReKassaProvider.buildTicket", () => {
  const provider = new ReKassaProvider();

  const request: FiscalSaleRequest = {
    externalId: "62e28819-9eb5-4c54-93f4-ae2d1903804e",
    occurredAt: new Date("2026-08-22T05:00:00.000Z"), // 10:00 Almaty
    lines: [
      { name: "Багет французский", quantity: 3, unitPrice: 1000, total: 3000, ntin: "0200052740026", measureUnitCode: "796" },
    ],
    payments: [{ type: "CARD", amount: 3000 }],
    total: 3000,
    taken: 0,
    change: 0,
    latitude: 43.2389,
    longitude: 76.8897,
  };

  it("matches the documented ticket shape", () => {
    const ticket = provider.buildTicket(request) as any;

    expect(ticket.operation).toBe("OPERATION_SELL");
    expect(ticket.items[0].type).toBe("ITEM_TYPE_COMMODITY");
    // 3 units, not 3000 — the single most dangerous mistake here.
    expect(ticket.items[0].commodity.quantity).toBe(3000);
    expect(ticket.items[0].commodity.price).toEqual({ bills: "1000", coins: 0 });
    expect(ticket.items[0].commodity.sum).toEqual({ bills: "3000", coins: 0 });
    expect(ticket.items[0].commodity.ntin).toBe("0200052740026");
    expect(ticket.payments[0].type).toBe("PAYMENT_CARD");
    expect(ticket.amounts.total).toEqual({ bills: "3000", coins: 0 });
    expect(ticket.dateTime.date).toEqual({ year: 2026, month: 8, day: 22 });
    expect(ticket.dateTime.time.hour).toBe(10);
  });

  it("maps every payment type we can charge to its protocol name", () => {
    const build = (type: FiscalSaleRequest["payments"][number]["type"]) =>
      (provider.buildTicket({ ...request, payments: [{ type, amount: 3000 }] }) as any).payments[0].type;

    expect(build("CASH")).toBe("PAYMENT_CASH");
    expect(build("CARD")).toBe("PAYMENT_CARD");
    expect(build("MOBILE")).toBe("PAYMENT_MOBILE");
  });

  it("keeps the line total the sale charged rather than recomputing it", () => {
    // A line whose total was rounded at sale time must reach the receipt as
    // that same figure, otherwise the receipt and the books disagree.
    const ticket = provider.buildTicket({
      ...request,
      lines: [{ ...request.lines[0], quantity: 3, unitPrice: 333.33, total: 999.99 }],
    }) as any;
    expect(ticket.items[0].commodity.sum).toEqual({ bills: "999", coins: 99 });
  });
});

describe("FakeFiscalProvider idempotency", () => {
  it("replays the original receipt when the same externalId is retried", async () => {
    // This is the property the whole retry design rests on: after a timeout
    // we resend with the SAME externalId and must get the original receipt
    // back, never a second one.
    const { FakeFiscalProvider } = await import("./fake-fiscal.provider");
    const provider = new FakeFiscalProvider();

    const request: FiscalSaleRequest = {
      externalId: "same-key",
      occurredAt: new Date("2026-08-22T05:00:00.000Z"),
      lines: [{ name: "Хлеб", quantity: 1, unitPrice: 590, total: 590, ntin: "0200000000001", measureUnitCode: "796" }],
      payments: [{ type: "CASH", amount: 590 }],
      total: 590,
      taken: 590,
      change: 0,
      latitude: 43.2389,
      longitude: 76.8897,
    };

    const first = await provider.registerSale(request);
    const retry = await provider.registerSale(request);
    const different = await provider.registerSale({ ...request, externalId: "other-key" });

    expect(first.kind).toBe("ok");
    expect(retry).toEqual(first);
    expect(different).not.toEqual(first);
  });
});
