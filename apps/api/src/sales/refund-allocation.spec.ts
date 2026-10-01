import { allocateRefund, validateRefundOverride } from "./refund-allocation";

// D8: a refund follows the original tender allocation proportionally.
describe("refund allocation across tenders", () => {
  it("6 000 cash + 4 000 card, refund 5 000 → 3 000 cash + 2 000 card", () => {
    expect(allocateRefund(5000, [{ method: "CASH", amount: 6000 }, { method: "CARD", amount: 4000 }])).toEqual([
      { method: "CASH", amount: 3000 },
      { method: "CARD", amount: 2000 },
    ]);
  });

  it("always adds up to the refund exactly, to the tiyn", () => {
    const tenders = [
      { method: "CASH", amount: 333.33 },
      { method: "CARD", amount: 333.33 },
      { method: "TRANSFER", amount: 333.34 },
    ];
    for (const refund of [0.01, 0.02, 1, 100.01, 333.33, 500, 999.99, 1000]) {
      const parts = allocateRefund(refund, tenders);
      const cents = parts.reduce((s, p) => s + Math.round(p.amount * 100), 0);
      expect(cents).toBe(Math.round(refund * 100));
    }
  });

  it("gives the leftover tiyn to the largest remainder, not to whoever came last", () => {
    // 1.00 over 1/3 + 2/3 → 0.33 + 0.67 (not 0.34 + 0.66).
    expect(allocateRefund(1, [{ method: "CASH", amount: 100 }, { method: "CARD", amount: 200 }])).toEqual([
      { method: "CASH", amount: 0.33 },
      { method: "CARD", amount: 0.67 },
    ]);
  });

  it("does not depend on the order the tenders arrive in", () => {
    const a = allocateRefund(777.77, [{ method: "CASH", amount: 123.45 }, { method: "CARD", amount: 876.55 }]);
    const b = allocateRefund(777.77, [{ method: "CARD", amount: 876.55 }, { method: "CASH", amount: 123.45 }]);
    const byMethod = (parts: { method: string; amount: number }[]) => Object.fromEntries(parts.map((p) => [p.method, p.amount]));
    expect(byMethod(a)).toEqual(byMethod(b));
  });

  it("refunds a full sale back to exactly what each tender paid", () => {
    expect(allocateRefund(10000, [{ method: "CASH", amount: 6000 }, { method: "CARD", amount: 4000 }])).toEqual([
      { method: "CASH", amount: 6000 },
      { method: "CARD", amount: 4000 },
    ]);
  });

  it("drops a tender that would be refunded nothing", () => {
    expect(allocateRefund(0.01, [{ method: "CASH", amount: 9999 }, { method: "CARD", amount: 1 }])).toEqual([{ method: "CASH", amount: 0.01 }]);
  });

  it("refuses to refund more than was paid, or from a sale with no payments", () => {
    expect(() => allocateRefund(100.01, [{ method: "CASH", amount: 100 }])).toThrow(/больше/);
    expect(() => allocateRefund(5, [])).toThrow(/нет оплаты/);
  });

  describe("explicit override", () => {
    const tenders = [{ method: "CASH", amount: 6000 }, { method: "CARD", amount: 4000 }];
    it("is accepted when it hands back exactly the refund and stays within each tender", () => {
      expect(validateRefundOverride(5000, [{ method: "CARD", amount: 4000 }, { method: "CASH", amount: 1000 }], tenders)).toEqual([
        { method: "CARD", amount: 4000 },
        { method: "CASH", amount: 1000 },
      ]);
    });
    it("is refused when it does not add up, or asks a tender for more than it paid", () => {
      expect(() => validateRefundOverride(5000, [{ method: "CASH", amount: 4000 }], tenders)).toThrow(/не равна/);
      expect(() => validateRefundOverride(5000, [{ method: "CARD", amount: 5000 }], tenders)).toThrow(/больше/);
      expect(() => validateRefundOverride(5000, [{ method: "CASH", amount: -1 }, { method: "CARD", amount: 5001 }], tenders)).toThrow();
    });
  });
});
