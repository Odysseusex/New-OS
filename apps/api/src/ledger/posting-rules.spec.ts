import {
  AccountingEventStatus,
  BalanceLine,
  CashSection,
  FinancialEvent,
  FinancialEventType,
  NotPostedReason,
  PnlLine,
  SystemAccountKey,
} from "@bakery-os/shared";
import { checkEventInvariants } from "../finance/events/invariants";
import { decideEvent, draftFingerprint } from "./posting-rules";
import { validateLines } from "./journal-math";

const kinds = new Map([["till", "CASH"], ["bank", "BANK"]]);
const base = { occurredAt: "2026-10-01T10:00:00.000Z", sourceType: "X", sourceId: "1", description: "x", unclassified: false };
const event = (over: Partial<FinancialEvent>): FinancialEvent => ({ key: "k", type: FinancialEventType.SALE, cash: [], balance: [], pnl: [], ...base, ...over });

const lines = (e: FinancialEvent) => {
  const d = decideEvent(e, kinds);
  if (d.status !== "POST") throw new Error(`not posted: ${d.status}`);
  return d.lines;
};
const side = (e: FinancialEvent) =>
  lines(e).map((l) => `${l.accountKey} ${l.debit.gt(0) ? "Dr" : "Cr"} ${(l.debit.gt(0) ? l.debit : l.credit).toFixed(2)}`).sort();

describe("posting rules: a FinancialEvent becomes a balanced journal", () => {
  it("a sale on credit: Dr receivable, Cr revenue", () => {
    const e = event({ balance: [{ line: BalanceLine.RECEIVABLES, delta: 1500 }], pnl: [{ line: PnlLine.REVENUE, amount: 1500 }] });
    expect(side(e)).toEqual(["RECEIVABLES Dr 1500.00", "SALES_REVENUE Cr 1500.00"]);
  });

  it("a markdown is its own debit, so revenue stays at the full price", () => {
    const e = event({
      balance: [{ line: BalanceLine.RECEIVABLES, delta: 250 }],
      pnl: [{ line: PnlLine.REVENUE, amount: 500 }, { line: PnlLine.DISCOUNTS, amount: -250 }],
    });
    expect(side(e)).toEqual(["RECEIVABLES Dr 250.00", "SALES_DISCOUNTS Dr 250.00", "SALES_REVENUE Cr 500.00"]);
  });

  it("the cost of a sale: Dr cost of goods, Cr inventory", () => {
    const e = event({ type: FinancialEventType.SALE_COST, balance: [{ line: BalanceLine.INVENTORY, delta: -150 }], pnl: [{ line: PnlLine.COGS, amount: -150 }] });
    expect(side(e)).toEqual(["COST_OF_GOODS_SOLD Dr 150.00", "INVENTORY Cr 150.00"]);
  });

  it("cash from a buyer lands on the till or the bank by the account's own type", () => {
    const cash = (accountId: string) =>
      event({
        type: FinancialEventType.CUSTOMER_RECEIPT,
        cash: [{ accountId, section: CashSection.OPERATING, amount: 1000 }],
        balance: [{ line: BalanceLine.CASH_AND_BANK, delta: 1000 }, { line: BalanceLine.RECEIVABLES, delta: -1000 }],
      });
    expect(side(cash("till"))).toEqual(["CASH_ON_HAND Dr 1000.00", "RECEIVABLES Cr 1000.00"]);
    expect(side(cash("bank"))).toEqual(["BANK Dr 1000.00", "RECEIVABLES Cr 1000.00"]);
  });

  it("a transfer between own accounts is Dr one, Cr the other — no equity or result", () => {
    const e = event({
      type: FinancialEventType.INTERNAL_TRANSFER,
      cash: [
        { accountId: "till", section: CashSection.INTERNAL, amount: -300 },
        { accountId: "bank", section: CashSection.INTERNAL, amount: 300 },
      ],
      balance: [{ line: BalanceLine.CASH_AND_BANK, delta: -300 }, { line: BalanceLine.CASH_AND_BANK, delta: 300 }],
    });
    expect(side(e)).toEqual(["BANK Dr 300.00", "CASH_ON_HAND Cr 300.00"]);
  });

  it("a liability grows with a credit and a payment shrinks it with a debit", () => {
    const receipt = event({ balance: [{ line: BalanceLine.INVENTORY, delta: 3000 }, { line: BalanceLine.SUPPLIER_PAYABLES, delta: 3000 }] });
    expect(side(receipt)).toEqual(["INVENTORY Dr 3000.00", "SUPPLIER_PAYABLES Cr 3000.00"]);
    const payment = event({
      cash: [{ accountId: "bank", section: CashSection.OPERATING, amount: -1000 }],
      balance: [{ line: BalanceLine.CASH_AND_BANK, delta: -1000 }, { line: BalanceLine.SUPPLIER_PAYABLES, delta: -1000 }],
    });
    expect(side(payment)).toEqual(["BANK Cr 1000.00", "SUPPLIER_PAYABLES Dr 1000.00"]);
  });

  it("owner withdrawals reduce equity: Dr withdrawals, Cr cash", () => {
    const e = event({
      cash: [{ accountId: "till", section: CashSection.FINANCING, amount: -500 }],
      balance: [{ line: BalanceLine.CASH_AND_BANK, delta: -500 }, { line: BalanceLine.OWNER_WITHDRAWALS, delta: -500 }],
    });
    expect(side(e)).toEqual(["CASH_ON_HAND Cr 500.00", "OWNER_WITHDRAWALS Dr 500.00"]);
  });

  it("an inventory GAIN reverses the loss: Dr inventory, Cr losses", () => {
    const e = event({ balance: [{ line: BalanceLine.INVENTORY, delta: 80 }], pnl: [{ line: PnlLine.INVENTORY_LOSS, amount: 80 }] });
    expect(side(e)).toEqual(["INVENTORY Dr 80.00", "INVENTORY_LOSSES Cr 80.00"]);
  });

  it("every classified event the rules accept balances, whatever its shape (invariant I1 ⇒ Σ debit = Σ credit)", () => {
    const shapes: FinancialEvent[] = [
      event({ balance: [{ line: BalanceLine.RECEIVABLES, delta: 100.1 }], pnl: [{ line: PnlLine.REVENUE, amount: 105.15 }, { line: PnlLine.DISCOUNTS, amount: -5.05 }] }),
      event({ balance: [{ line: BalanceLine.EXPENSE_PAYABLES, delta: 200 }], pnl: [{ line: PnlLine.OPERATING_EXPENSE, amount: -200 }] }),
      event({ balance: [{ line: BalanceLine.FIXED_ASSETS, delta: -1000 }], pnl: [{ line: PnlLine.DEPRECIATION, amount: -1000 }] }),
      event({ balance: [{ line: BalanceLine.FIXED_ASSETS, delta: -400 }], pnl: [{ line: PnlLine.OTHER_EXPENSE, amount: -400 }] }),
      event({ balance: [{ line: BalanceLine.LOANS, delta: -250 }, { line: BalanceLine.EXPENSE_PAYABLES, delta: 250 }] }),
    ];
    for (const e of shapes) {
      expect(checkEventInvariants([e]).violations).toEqual([]);
      const d = decideEvent(e, kinds);
      expect(d.status).toBe("POST");
      if (d.status === "POST") expect(() => validateLines(d.lines)).not.toThrow();
    }
  });

  it("an event whose other side is unknown is NOT posted, and nothing balances it", () => {
    const e = event({ unclassified: true, balance: [{ line: BalanceLine.INVENTORY, delta: 500 }] });
    expect(decideEvent(e, kinds)).toEqual({ status: AccountingEventStatus.NOT_POSTED, reason: NotPostedReason.UNCLASSIFIED });
  });

  it("the declared opening position is never converted by a rule (D3)", () => {
    for (const type of [FinancialEventType.OPENING_BALANCE, FinancialEventType.OPENING_POSITION]) {
      expect(decideEvent(event({ type, balance: [{ line: BalanceLine.INVENTORY, delta: 1 }, { line: BalanceLine.OPENING_EQUITY, delta: 1 }] }), kinds)).toEqual({
        status: AccountingEventStatus.UNAPPROVED,
        reason: NotPostedReason.OPENING_VIA_ENTRY,
      });
    }
  });

  it("a cash leg on an account the ledger does not know is not posted rather than guessed onto the bank", () => {
    const e = event({ cash: [{ accountId: "ghost", section: CashSection.OPERATING, amount: 10 }], balance: [{ line: BalanceLine.CASH_AND_BANK, delta: 10 }, { line: BalanceLine.RECEIVABLES, delta: -10 }] });
    const d = decideEvent(e, kinds);
    expect(d.status).toBe(AccountingEventStatus.NOT_POSTED);
  });

  it("an event with only zero amounts has no ledger effect", () => {
    expect(decideEvent(event({ balance: [{ line: BalanceLine.INVENTORY, delta: 0 }] }), kinds).status).toBe(AccountingEventStatus.NO_GL_EFFECT);
  });

  it("the fingerprint is stable for the same lines and changes when an amount does", () => {
    const a = event({ balance: [{ line: BalanceLine.RECEIVABLES, delta: 100 }], pnl: [{ line: PnlLine.REVENUE, amount: 100 }] });
    const b = event({ balance: [{ line: BalanceLine.RECEIVABLES, delta: 101 }], pnl: [{ line: PnlLine.REVENUE, amount: 101 }] });
    expect(draftFingerprint(a.occurredAt, lines(a))).toBe(draftFingerprint(a.occurredAt, lines(a)));
    expect(draftFingerprint(a.occurredAt, lines(a))).not.toBe(draftFingerprint(b.occurredAt, lines(b)));
  });

  it("uses only the system accounts that exist in the catalogue", () => {
    const e = event({ balance: [{ line: BalanceLine.CONSIGNMENT_PAYABLES, delta: 10 }, { line: BalanceLine.INVENTORY, delta: 10 }] });
    for (const l of lines(e)) expect(Object.values(SystemAccountKey)).toContain(l.accountKey);
  });
});
