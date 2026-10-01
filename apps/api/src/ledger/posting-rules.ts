import {
  AccountingEventStatus,
  BALANCE_LINE_ACCOUNT_KEY,
  BALANCE_LINE_SIDE,
  BalanceLine,
  FinancialEvent,
  FinancialEventType,
  NotPostedReason,
  PNL_LINE_ACCOUNT_KEY,
  SystemAccountKey,
} from "@bakery-os/shared";
import { Dec, fromComputed, ZERO } from "./journal-math";

// The posting rules, in one pure function: what a FinancialEvent does to the
// ledger. The event layer is where the accounting MEANING of every business
// fact already lives (and where each event is proven to balance by itself), so
// the ledger reads that meaning instead of restating it — one set of rules, not
// a second accounting system beside it.
//
// An event only ever becomes a journal when its rules know BOTH sides. When they
// do not (no classification, an unexplained stock receipt…) it stays out of the
// ledger with a stated reason: nothing is guessed and no suspense account takes
// the other side.

export interface DraftLine {
  accountKey: SystemAccountKey;
  debit: Dec;
  credit: Dec;
  cashAccountId?: string;
  cashSection?: string;
}

export type PostingDecision =
  | { status: "POST"; lines: DraftLine[] }
  | { status: AccountingEventStatus.NO_GL_EFFECT; reason: string }
  | { status: AccountingEventStatus.UNAPPROVED; reason: NotPostedReason }
  | { status: AccountingEventStatus.NOT_POSTED; reason: NotPostedReason; detail?: string };

// Cash legs post to Касса or Банк according to the account's own type.
export type CashAccountKinds = ReadonlyMap<string, string>;

export function decideEvent(event: FinancialEvent, cashAccountKinds: CashAccountKinds): PostingDecision {
  // The declared opening position is never converted by a rule: whether it is
  // complete is exactly the open question (D3), so it enters only through an
  // explicit opening-balance entry that a person reviews and submits.
  if (event.type === FinancialEventType.OPENING_BALANCE || event.type === FinancialEventType.OPENING_POSITION) {
    return { status: AccountingEventStatus.UNAPPROVED, reason: NotPostedReason.OPENING_VIA_ENTRY };
  }
  if (event.unclassified) {
    return { status: AccountingEventStatus.NOT_POSTED, reason: NotPostedReason.UNCLASSIFIED };
  }

  const drafts: DraftLine[] = [];
  const push = (line: DraftLine) => drafts.push(line);

  // Cash legs: money in is a debit of the till/bank, money out a credit.
  for (const leg of event.cash) {
    const amount = fromComputed(Math.abs(leg.amount));
    if (amount.isZero()) continue;
    const kind = cashAccountKinds.get(leg.accountId);
    const accountKey = kind === "CASH" ? SystemAccountKey.CASH_ON_HAND : SystemAccountKey.BANK;
    if (kind === undefined) {
      return { status: AccountingEventStatus.NOT_POSTED, reason: NotPostedReason.ACCOUNT_NOT_MAPPED, detail: `cash:${leg.accountId}` };
    }
    push({
      accountKey,
      debit: leg.amount > 0 ? amount : ZERO,
      credit: leg.amount < 0 ? amount : ZERO,
      cashAccountId: leg.accountId,
      cashSection: leg.section,
    });
  }

  // Balance legs. CASH_AND_BANK is already covered by the cash legs above
  // (invariant I2: they are the same money, one per account).
  for (const leg of event.balance) {
    if (leg.line === BalanceLine.CASH_AND_BANK) continue;
    const accountKey = BALANCE_LINE_ACCOUNT_KEY[leg.line];
    if (!accountKey) {
      return { status: AccountingEventStatus.NOT_POSTED, reason: NotPostedReason.ACCOUNT_NOT_MAPPED, detail: leg.line };
    }
    const amount = fromComputed(Math.abs(leg.delta));
    if (amount.isZero()) continue;
    // An asset grows with a debit; a liability or equity line grows with a credit.
    const growsOnDebit = BALANCE_LINE_SIDE[leg.line] === "ASSET";
    const increases = leg.delta > 0;
    const debit = growsOnDebit === increases;
    push({ accountKey, debit: debit ? amount : ZERO, credit: debit ? ZERO : amount });
  }

  // Result legs: income is a credit, expense a debit.
  for (const leg of event.pnl) {
    const amount = fromComputed(Math.abs(leg.amount));
    if (amount.isZero()) continue;
    const income = leg.amount > 0;
    push({
      accountKey: PNL_LINE_ACCOUNT_KEY[leg.line],
      debit: income ? ZERO : amount,
      credit: income ? amount : ZERO,
    });
  }

  if (drafts.length === 0) {
    return { status: AccountingEventStatus.NO_GL_EFFECT, reason: "Все суммы операции равны нулю" };
  }
  return { status: "POST", lines: mergeDrafts(drafts) };
}

// Same account, same side, same cash account → one line. Keeps an entry short
// (a sale with several cost classes) without ever netting a debit against a
// credit: what was recorded on each side stays visible.
function mergeDrafts(lines: DraftLine[]): DraftLine[] {
  const merged = new Map<string, DraftLine>();
  for (const l of lines) {
    const side = l.debit.gt(0) ? "D" : "C";
    const key = `${l.accountKey}|${side}|${l.cashAccountId ?? ""}|${l.cashSection ?? ""}`;
    const existing = merged.get(key);
    if (existing) {
      existing.debit = existing.debit.plus(l.debit);
      existing.credit = existing.credit.plus(l.credit);
    } else {
      merged.set(key, { ...l });
    }
  }
  return [...merged.values()];
}

// A stable fingerprint of what the rules produced, so a later difference
// (the source changed after posting) can be reported instead of rewritten.
export function draftFingerprint(date: string, lines: DraftLine[]): string {
  const canonical = lines
    .map((l) => `${l.accountKey}:${l.debit.toFixed(2)}:${l.credit.toFixed(2)}:${l.cashAccountId ?? ""}`)
    .sort()
    .join("|");
  return `${date}#${canonical}`;
}
