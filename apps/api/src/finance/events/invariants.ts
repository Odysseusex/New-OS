import {
  BALANCE_LINE_SIDE,
  BalanceLine,
  CashSection,
  EventInvariantReport,
  EventInvariantViolation,
  FinancialEvent,
} from "@bakery-os/shared";
import { round2 } from "../../common/money";

const EPS = 0.005;

// Checks the invariants that must hold for ANY set of events, whatever the
// data: I1 each classified event balances by itself, I2 cash legs equal the
// cash balance movement, I3 keys are unique, I4 transfers net to zero. I5
// (replay determinism) is a property of the projector, tested by running it twice.
export function checkEventInvariants(events: FinancialEvent[]): EventInvariantReport {
  const violations: EventInvariantViolation[] = [];
  const seen = new Set<string>();
  let incomplete = 0;

  for (const e of events) {
    if (seen.has(e.key)) violations.push({ invariant: "I3", key: e.key, detail: "Ключ события повторяется" });
    seen.add(e.key);

    const cashLegs = round2(e.cash.reduce((s, c) => s + c.amount, 0));
    const cashBalance = round2(
      e.balance.filter((b) => b.line === BalanceLine.CASH_AND_BANK).reduce((s, b) => s + b.delta, 0),
    );
    if (Math.abs(cashLegs - cashBalance) > EPS) {
      violations.push({ invariant: "I2", key: e.key, detail: `Денежные ноги ${cashLegs} ≠ изменение денежных средств ${cashBalance}` });
    }

    if (e.cash.length > 0 && e.cash.every((c) => c.section === CashSection.INTERNAL)) {
      const net = round2(e.cash.reduce((s, c) => s + c.amount, 0));
      if (Math.abs(net) > EPS) violations.push({ invariant: "I4", key: e.key, detail: `Внутренний перевод не в ноль: ${net}` });
    }

    if (e.unclassified) {
      incomplete += 1;
      continue;
    }
    let assets = 0;
    let liabilities = 0;
    let equity = 0;
    for (const b of e.balance) {
      const side = BALANCE_LINE_SIDE[b.line];
      if (side === "ASSET") assets += b.delta;
      else if (side === "LIABILITY") liabilities += b.delta;
      else equity += b.delta;
    }
    const result = e.pnl.reduce((s, p) => s + p.amount, 0);
    const gap = round2(assets - liabilities - equity - result);
    if (Math.abs(gap) > EPS) {
      violations.push({ invariant: "I1", key: e.key, detail: `Активы − Обязательства − Капитал − Результат = ${gap}` });
    }
  }
  return { eventCount: events.length, incompleteEvents: incomplete, violations };
}
