import { Prisma } from "@prisma/client";
import { exactAmount, fromComputed, LedgerRejectedError, onNormalSide, sum, validateLines } from "./journal-math";

const D = (v: number | string) => new Prisma.Decimal(v);
const line = (debit: number | string, credit: number | string) => ({ debit: D(debit), credit: D(credit) });

describe("journal arithmetic (exact decimals)", () => {
  it("accepts a balanced entry and reports its totals", () => {
    expect(validateLines([line(100, 0), line(0, 60), line(0, 40)])).toEqual({ totalDebit: D(100), totalCredit: D(100) });
  });

  it("is exact where floating point is not: 0.10 + 0.20 balances 0.30", () => {
    expect(0.1 + 0.2).not.toBe(0.3); // the trap
    expect(() => validateLines([line("0.10", 0), line("0.20", 0), line(0, "0.30")])).not.toThrow();
  });

  it("rejects an entry that is a single cent out", () => {
    expect(() => validateLines([line("100.00", 0), line(0, "99.99")])).toThrow(/не сбалансирована/);
  });

  it("rejects negative amounts, two-sided lines, zero lines and one-line entries", () => {
    expect(() => validateLines([line(-5, 0), line(0, -5)])).toThrow(/отрицательная/);
    expect(() => validateLines([line(5, 5), line(0, 10)])).toThrow(/одновременно/);
    expect(() => validateLines([line(0, 0), line(0, 0)])).toThrow(/нулевая/);
    expect(() => validateLines([line(5, 0)])).toThrow(/не менее двух/);
  });

  it("carries the rejection code so callers can tell the cases apart", () => {
    try {
      validateLines([line(1, 0), line(0, 2)]);
      fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(LedgerRejectedError);
      expect((e as LedgerRejectedError).code).toBe("DOES_NOT_BALANCE");
    }
  });

  it("refuses more than two decimals instead of rounding silently", () => {
    expect(exactAmount(10.5).toString()).toBe("10.5");
    expect(() => exactAmount(10.005)).toThrow(/двух знаков/);
    expect(() => exactAmount("abc")).toThrow(/не число/);
    expect(exactAmount(null).isZero()).toBe(true);
  });

  it("snaps computed amounts (float noise) to two decimals", () => {
    expect(fromComputed(100.10000000000001).toFixed(2)).toBe("100.10");
    expect(fromComputed(0.1 + 0.2).toFixed(2)).toBe("0.30");
  });

  it("keeps precision on very large amounts and long sums", () => {
    const big = D("123456789012345.67");
    expect(big.plus("0.01").toFixed(2)).toBe("123456789012345.68");
    expect(sum(Array.from({ length: 1000 }, () => D("0.01"))).toFixed(2)).toBe("10.00");
  });

  it("reads a balance on the account's own side", () => {
    expect(onNormalSide("DEBIT", D(100), D(30)).toNumber()).toBe(70);
    expect(onNormalSide("CREDIT", D(30), D(100)).toNumber()).toBe(70);
  });
});
