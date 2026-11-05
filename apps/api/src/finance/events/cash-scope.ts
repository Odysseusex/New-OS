import { BusinessDirection, FinancialEvent } from "@bakery-os/shared";

// ДДС for one account or one point (ТЗ §6.3 «Фильтры: точка, счёт»).
//   account: only the cash legs on that account — a transfer to another of our
//            accounts then stays as the account's own internal movement, so the
//            account's closing equals its ledger balance.
//   point:   a movement belongs to the point of the document behind it (the sale,
//            the return, the expense, the supplier order), else to the point its
//            account is tied to (a till drawer); a transfer leg by its account.
//   direction: a movement belongs to the direction of the document behind it — a sale
//            or its return by `businessDirectionOf`, an expense by its own `direction`,
//            a customer payment with no sale (advance) is wholesale. Everything else
//            (common expenses, suppliers, transfers, opening balances) has no
//            direction and is left out, so a direction's ДДС has no reconciliation.
export interface CashScope {
  accountId?: string;
  locationId?: string;
  direction?: BusinessDirection;
}

export interface CashScopeIndex {
  // CashMovement id → the point it belongs to (null = none).
  movementLocation: Map<string, string | null>;
  // CashAccount id → the point it is tied to (null = shared).
  accountLocation: Map<string, string | null>;
  // CashMovement id → its business direction (null = common).
  movementDirection?: Map<string, BusinessDirection | null>;
}

export function scopeCashEvents(events: FinancialEvent[], scope: CashScope, index?: CashScopeIndex): FinancialEvent[] {
  if (!scope.accountId && !scope.locationId && !scope.direction) return events;
  const out: FinancialEvent[] = [];
  for (const e of events) {
    const cash = e.cash.filter((leg) => {
      if (scope.accountId && leg.accountId !== scope.accountId) return false;
      if (scope.locationId) {
        const at =
          e.sourceType === "CashMovement"
            ? (index?.movementLocation.get(e.sourceId) ?? null)
            : (index?.accountLocation.get(leg.accountId) ?? null);
        if (at !== scope.locationId) return false;
      }
      if (scope.direction) {
        if (e.sourceType !== "CashMovement") return false;
        if ((index?.movementDirection?.get(e.sourceId) ?? null) !== scope.direction) return false;
      }
      return true;
    });
    if (cash.length > 0) out.push(cash.length === e.cash.length ? e : { ...e, cash });
  }
  return out;
}
