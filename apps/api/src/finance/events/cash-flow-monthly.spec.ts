import { CashSection, FinancialEvent, FinancialEventType } from "@bakery-os/shared";
import { monthRanges, startOfZonedMonth } from "../../common/month-ranges";
import { buildCashFlowMonthly, cashFlowOperations } from "./cash-flow-monthly";
import { buildCashFlowFromEvents } from "./cash-flow-statement";

// Almaty is UTC+5: 2026-10-01T00:00 local = 2026-09-30T19:00Z.
const event = (key: string, at: string, amount: number, section: CashSection, label: string, type = FinancialEventType.EXPENSE_PAYMENT): FinancialEvent => ({
  key,
  type,
  occurredAt: at,
  sourceType: "Expense",
  sourceId: key,
  description: `Операция ${key}`,
  cash: [{ accountId: "a1", section, amount }],
  balance: [],
  pnl: [],
  unclassified: false,
  categoryName: label,
});

describe("month ranges", () => {
  it("starts a month at local midnight and stops the current one at now", () => {
    expect(startOfZonedMonth("2026-10").toISOString()).toBe("2026-09-30T19:00:00.000Z");
    const now = new Date("2026-11-02T08:00:00Z");
    const r = monthRanges("2026-09", "2026-11", now);
    expect(r.map((m) => m.key)).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(r[1].to.toISOString()).toBe("2026-10-31T18:59:59.999Z");
    expect(r[2].to).toBe(now);
    expect(r[0].to.getTime() + 1).toBe(r[1].from.getTime());
  });

  it("refuses a future month, a backwards range and a range that is too long", () => {
    const now = new Date("2026-11-02T08:00:00Z");
    expect(() => monthRanges("2026-11", "2026-12", now)).toThrow("будущий месяц");
    expect(() => monthRanges("2026-10", "2026-09", now)).toThrow("позже");
    expect(() => monthRanges("2024-01", "2026-11", now)).toThrow("Не больше 24");
    expect(() => monthRanges("2026-13", "2026-13", now)).toThrow("ГГГГ-ММ");
  });
});

describe("ДДС by month", () => {
  const now = new Date("2026-11-02T08:00:00Z");
  const events: FinancialEvent[] = [
    event("open", "2026-08-15T05:00:00.000Z", 1000, CashSection.OPENING, "Остаток", FinancialEventType.OPENING_BALANCE),
    event("s1", "2026-09-10T05:00:00.000Z", 5000, CashSection.OPERATING, "Выручка", FinancialEventType.CUSTOMER_RECEIPT),
    event("r1", "2026-09-20T05:00:00.000Z", -800, CashSection.OPERATING, "Аренда"),
    event("s2", "2026-10-03T05:00:00.000Z", 7000, CashSection.OPERATING, "Выручка", FinancialEventType.CUSTOMER_RECEIPT),
    event("r2", "2026-10-20T05:00:00.000Z", -800, CashSection.OPERATING, "Аренда"),
    event("eq", "2026-10-25T05:00:00.000Z", -3000, CashSection.INVESTING, "Печь"),
    // Right at the turn of the month in Almaty: 23:30 on 31.10 local = 18:30Z.
    event("edge-in", "2026-10-31T18:30:00.000Z", 100, CashSection.OPERATING, "Выручка", FinancialEventType.CUSTOMER_RECEIPT),
    // 00:30 on 01.11 local = 19:30Z on 31.10: belongs to November.
    event("edge-out", "2026-10-31T19:30:00.000Z", 40, CashSection.OPERATING, "Выручка", FinancialEventType.CUSTOMER_RECEIPT),
    event("s3", "2026-11-01T06:00:00.000Z", 2000, CashSection.OPERATING, "Выручка", FinancialEventType.CUSTOMER_RECEIPT),
  ];
  const report = buildCashFlowMonthly(events, monthRanges("2026-09", "2026-11", now));

  it("chains: a month's closing is the next month's opening, and the first opens from before", () => {
    expect(report.months.map((m) => [m.key, m.openingBalance, m.closingBalance])).toEqual([
      ["2026-09", 1000, 5200],
      ["2026-10", 5200, 8500],
      ["2026-11", 8500, 10540],
    ]);
    expect(report.openingBalance).toBe(1000);
    expect(report.closingBalance).toBe(10540);
  });

  it("shows an opening balance dated inside a month as part of that month's opening, never as an inflow", () => {
    const withLateOpening = [
      event("s0", "2026-09-10T05:00:00.000Z", 500, CashSection.OPERATING, "Выручка", FinancialEventType.CUSTOMER_RECEIPT),
      event("open2", "2026-10-05T05:00:00.000Z", 2000, CashSection.OPENING, "Остаток", FinancialEventType.OPENING_BALANCE),
    ];
    const r = buildCashFlowMonthly(withLateOpening, monthRanges("2026-09", "2026-10", now));
    expect(r.months.map((m) => [m.openingBalance, m.openingDeclared, m.totalInflow, m.closingBalance])).toEqual([
      [0, 0, 500, 500],
      [2500, 2000, 0, 2500],
    ]);
  });

  it("splits at the Almaty midnight, not the UTC one", () => {
    const revenue = report.sections[0].lines.find((l) => l.label === "Выручка")!;
    expect(revenue.months.map((c) => c.inflow)).toEqual([5000, 7100, 2040]);
    expect(revenue.total).toEqual({ inflow: 14140, outflow: 0, count: 5 });
  });

  it("lays the articles out by activity with month and total sums that agree", () => {
    const [operating, investing] = report.sections;
    expect(operating.months.map((m) => m.net)).toEqual([4200, 6300, 2040]);
    expect(operating.total).toEqual({ inflow: 14140, outflow: 1600, net: 12540 });
    expect(investing.lines.map((l) => l.label)).toEqual(["Печь"]);
    expect(investing.months.map((m) => m.outflow)).toEqual([0, 3000, 0]);
    // Everything in the months equals the same statement taken once over the whole range.
    const whole = buildCashFlowFromEvents(events, report.months[0] ? new Date(report.months[0].from) : now, now);
    expect(whole.totalInflow).toBe(report.months.reduce((s, m) => s + m.totalInflow, 0));
    expect(whole.totalOutflow).toBe(report.months.reduce((s, m) => s + m.totalOutflow, 0));
    expect(whole.closingBalance).toBe(report.closingBalance);
  });

  it("lists the movements behind a cell, newest first, within the month", () => {
    const [m] = [monthRanges("2026-10", "2026-10", now)[0]];
    const ops = cashFlowOperations(events, CashSection.OPERATING, "Выручка", m.from, m.to);
    expect(ops.operations.map((o) => o.sourceId)).toEqual(["edge-in", "s2"]);
    expect(ops.total).toBe(7100);
    expect(ops.truncated).toBe(false);
    const all = monthRanges("2026-09", "2026-11", now);
    const whole = cashFlowOperations(events, CashSection.OPERATING, "Выручка", all[0].from, all[all.length - 1].to);
    expect(whole.total).toBe(14140);
  });
});
