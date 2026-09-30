import { cashEffectOf, cashSignOf, isReturnScrapMarker, stockEffectOf, stockSignOf } from "./ledger-effects";

// Pure rules, no database. The contract with the services that really write
// the rows is pinned in finance/integrity/ledger-consistency.spec.ts.

describe("stockEffectOf", () => {
  it.each([
    ["RECEIPT", 5, 5],
    ["SALE_RETURN", 5, 5],
    ["PRODUCTION_OUTPUT", 5, 5],
    ["TRANSFER_IN", 5, 5],
    ["SALE", 5, -5],
    ["WRITE_OFF", 5, -5],
    ["PRODUCTION_CONSUMPTION", 5, -5],
    ["TRANSFER_OUT", 5, -5],
  ])("%s stores a positive quantity and moves stock by its type's direction", (type, quantity, effect) => {
    expect(stockEffectOf({ type, quantity })).toBe(effect);
  });

  it("takes an ADJUSTMENT's direction from the stored sign", () => {
    expect(stockEffectOf({ type: "ADJUSTMENT", quantity: 3 })).toBe(3);
    expect(stockEffectOf({ type: "ADJUSTMENT", quantity: -4.5 })).toBe(-4.5);
  });

  it("gives a write-off attached to a sale return no stock effect at all", () => {
    // The sale already took the goods off the shelf and nothing puts them back,
    // so the row is a record of the bin, not a second removal.
    const marker = { type: "WRITE_OFF", quantity: 2, saleReturnId: "ret-1" };
    expect(isReturnScrapMarker(marker)).toBe(true);
    expect(stockEffectOf(marker)).toBe(0);
    expect(stockSignOf("WRITE_OFF", true)).toBe(0);
  });

  it("still treats an ordinary write-off as a removal", () => {
    expect(isReturnScrapMarker({ type: "WRITE_OFF", saleReturnId: null })).toBe(false);
    expect(stockEffectOf({ type: "WRITE_OFF", quantity: 2, saleReturnId: null })).toBe(-2);
  });

  it("refuses a type it does not know rather than guessing a direction", () => {
    expect(() => stockEffectOf({ type: "SOMETHING_NEW", quantity: 1 })).toThrow("Unknown stock movement type");
  });
});

describe("cashEffectOf", () => {
  it.each([
    ["OPENING_BALANCE", 100, 100],
    ["SALE_RECEIPT", 100, 100],
    ["CUSTOMER_PAYMENT", 100, 100],
    ["TRANSFER_IN", 100, 100],
    ["CASH_DEPOSIT", 100, 100],
    ["OTHER_INCOME", 100, 100],
    ["SALE_REFUND", 100, -100],
    ["SUPPLIER_PAYMENT", 100, -100],
    ["EXPENSE_PAYMENT", 100, -100],
    ["TRANSFER_OUT", 100, -100],
    ["CASH_WITHDRAWAL", 100, -100],
    ["OTHER_EXPENSE", 100, -100],
  ])("%s stores a positive amount and moves cash by its type's direction", (type, amount, effect) => {
    expect(cashEffectOf({ type, amount })).toBe(effect);
  });

  it("takes an ADJUSTMENT's direction from the stored sign", () => {
    expect(cashEffectOf({ type: "ADJUSTMENT", amount: 70 })).toBe(70);
    expect(cashEffectOf({ type: "ADJUSTMENT", amount: -70 })).toBe(-70);
    expect(cashSignOf("ADJUSTMENT")).toBe("SIGNED");
  });
});
